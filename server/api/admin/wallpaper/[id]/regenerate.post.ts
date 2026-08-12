import imageThemes from "../../../../../app/assets/data/imageThemes.json";

type UnsplashPhoto = {
  id: string;
  description: string | null;
  alt_description: string | null;
  urls: {
    raw: string;
  };
  links: {
    html: string;
  };
  user: {
    username: string;
    name: string;
    portfolio_url: string | null;
  };
  blur_hash: string | null;
};

const fetchUnsplashPhotoDetails = async (
  photoId: string,
  accessKey: string,
) => {
  const detailsRes = await fetch(`https://api.unsplash.com/photos/${photoId}`, {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
    },
  });

  if (!detailsRes.ok) {
    throw createError({
      statusCode: detailsRes.status,
      message: `Failed to fetch image details from Unsplash (${detailsRes.statusText})`,
    });
  }

  return detailsRes.json() as Promise<{
    location?: {
      city?: string | null;
      country?: string | null;
    };
  }>;
};

const selectTheme = async (ignoreId: string): Promise<string> => {
  const allImages = await prisma.background.findMany({
    where: {
      id: {
        not: ignoreId,
      },
    },
    orderBy: { date: "desc" },
    select: { theme: true, date: true },
  });

  const usedThemeSet = new Set(allImages.map((img) => img.theme));
  const neverUsed = imageThemes.filter(
    (theme: string) => !usedThemeSet.has(theme),
  );

  if (neverUsed.length > 0) {
    return neverUsed[Math.floor(Math.random() * neverUsed.length)] ?? "";
  }

  const lastUsed = new Map<string, string>();
  for (const image of allImages) {
    if (!lastUsed.has(image.theme)) {
      lastUsed.set(image.theme, image.date);
    }
  }

  const sortedThemes = imageThemes
    .map((theme: string) => ({
      theme,
      date: lastUsed.get(theme) ?? "0000-00-00",
    }))
    .sort((a: { date: string }, b: { date: string }) =>
      a.date.localeCompare(b.date),
    );

  return sortedThemes[0]?.theme ?? "";
};

const findReplacementPhoto = async (
  currentWallpaperId: string,
  currentImageId: string,
  accessKey: string,
  theme: string,
) => {
  const response = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(theme)}&orientation=landscape&order_by=latest&per_page=30`,
    {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
      },
    },
  );

  if (!response.ok) {
    throw createError({
      statusCode: response.status,
      message: `Unsplash search failed (${response.statusText})`,
    });
  }

  const payload = (await response.json()) as { results?: UnsplashPhoto[] };
  const results = payload.results ?? [];

  for (const photo of results) {
    if (photo.id === currentImageId) {
      continue;
    }

    const duplicate = await prisma.background.findFirst({
      where: {
        imageID: photo.id,
        id: {
          not: currentWallpaperId,
        },
      },
      select: { id: true },
    });

    if (duplicate) {
      continue;
    }

    return photo;
  }

  return null;
};

export default defineEventHandler(async (event) => {
  await isAdmin(event);

  const { id } = event.context.params as { id: string };

  if (!id) {
    throw createError({ statusCode: 400, message: "Invalid wallpaper id" });
  }

  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    throw createError({
      statusCode: 500,
      message: "UNSPLASH_ACCESS_KEY is not configured",
    });
  }

  const currentWallpaper = await prisma.background.findUnique({
    where: { id },
    select: {
      id: true,
      date: true,
      imageID: true,
      addTextStroke: true,
    },
  });

  if (!currentWallpaper) {
    throw createError({ statusCode: 404, message: "Wallpaper not found" });
  }

  const theme = await selectTheme(currentWallpaper.id);
  const replacementPhoto = await findReplacementPhoto(
    currentWallpaper.id,
    currentWallpaper.imageID,
    accessKey,
    theme,
  );

  if (!replacementPhoto) {
    throw createError({
      statusCode: 409,
      message: "Could not find a new image to replace this wallpaper",
    });
  }

  const details = await fetchUnsplashPhotoDetails(
    replacementPhoto.id,
    accessKey,
  );
  const description =
    replacementPhoto.description ||
    replacementPhoto.alt_description ||
    "None provided";
  const {
    username,
    name: authorName,
    portfolio_url: portfolioFromUnsplash,
  } = replacementPhoto.user;
  const portfolioUrl =
    portfolioFromUnsplash || `https://unsplash.com/@${username}`;

  return prisma.background.update({
    where: { id: currentWallpaper.id },
    data: {
      imageID: replacementPhoto.id,
      theme,
      url: `${replacementPhoto.urls.raw}&auto=format`,
      unsplashUrl: replacementPhoto.links.html,
      description,
      username,
      authorName,
      portfolioUrl,
      city: details.location?.city || "Unknown",
      country: details.location?.country || "Unknown",
      blurhash: replacementPhoto.blur_hash ?? "",
      addTextStroke: currentWallpaper.addTextStroke,
    },
    select: {
      id: true,
      date: true,
      url: true,
      description: true,
      authorName: true,
      username: true,
      unsplashUrl: true,
      portfolioUrl: true,
      city: true,
      country: true,
      addTextStroke: true,
      createdAt: true,
    },
  });
});
