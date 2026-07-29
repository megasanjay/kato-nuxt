import "dotenv/config";
import dayjs from "dayjs";
import { PrismaClient } from "../shared/generated/client";
import { PrismaPg } from "@prisma/adapter-pg";

import imageThemes from "../app/assets/data/imageThemes.json";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

const now = dayjs();

// Returns a theme not used in previous days. If all themes have been used,
// returns the one used least recently so themes cycle fairly over time.
const selectTheme = async (): Promise<string> => {
  const allImages = await prisma.background.findMany({
    orderBy: { date: "desc" },
    select: { theme: true, date: true },
  });

  const usedThemeSet = new Set(allImages.map((img) => img.theme));
  const neverUsed = imageThemes.filter((t) => !usedThemeSet.has(t));

  if (neverUsed.length > 0) {
    return neverUsed[Math.floor(Math.random() * neverUsed.length)];
  }

  // All themes have been used at least once - find the oldest.
  // allImages is ordered date desc so the first occurrence of each theme = most recent use.
  const lastUsed = new Map<string, string>();
  for (const img of allImages) {
    if (!lastUsed.has(img.theme)) {
      lastUsed.set(img.theme, img.date);
    }
  }

  const sorted = imageThemes
    .map((t) => ({ theme: t, date: lastUsed.get(t) ?? "0000-00-00" }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return sorted[0].theme;
};

const generateImage = async (searchDate: string) => {
  const existing = await prisma.background.findFirst({
    where: { date: searchDate },
  });

  if (existing) {
    console.log(`Already have an image for ${searchDate}`);

    return;
  }

  const theme = await selectTheme();

  console.log(`Using theme "${theme}" for ${searchDate}`);

  const response = await fetch(
    `https://api.unsplash.com/search/photos?query=${theme}&orientation=landscape&order_by=latest&per_page=30`,
    {
      headers: {
        Authorization: `Client-ID ${ACCESS_KEY}`,
      },
    },
  );

  if (!response.ok) {
    console.error(
      `Unsplash API error: ${response.status} ${response.statusText}`,
    );

    return;
  }

  const { results } = await response.json();

  for (const photo of results) {
    const duplicate = await prisma.background.findFirst({
      where: { imageID: photo.id },
    });

    if (duplicate) {
      console.log(`Image ${photo.id} already exists, skipping`);
      continue;
    }

    const detailsRes = await fetch(
      `https://api.unsplash.com/photos/${photo.id}`,
      {
        headers: {
          Authorization: `Client-ID ${ACCESS_KEY}`,
        },
      },
    );

    if (!detailsRes.ok) {
      console.error(
        `Failed to fetch details for ${photo.id}: ${detailsRes.status} ${detailsRes.statusText}`,
      );

      return;
    }

    const details = await detailsRes.json();
    const { city, country } = details.location;

    let { description } = photo;
    if (!description) {
      description = photo.alt_description || "None provided";
    }

    const { username } = photo.user;
    const authorName = photo.user.name;
    const portfolioUrl =
      photo.user.portfolio_url || `https://unsplash.com/@${username}`;

    await prisma.background.create({
      data: {
        username,
        authorName,
        portfolioUrl,
        city: city || "Unknown",
        country: country || "Unknown",
        date: searchDate,
        description,
        imageID: photo.id,
        theme,
        url: `${photo.urls.raw}&auto=format`,
        unsplashUrl: photo.links.html,
        blurhash: photo.blur_hash ?? "",
      },
    });

    console.log(`Saved image ${photo.id} for ${searchDate}`);
    break;
  }
};

const main = async () => {
  const today = now.format("YYYY-MM-DD");
  const tomorrow = now.add(1, "day").format("YYYY-MM-DD");
  const dayAfterTomorrow = now.add(2, "day").format("YYYY-MM-DD");
  const dayAfterThat = now.add(3, "day").format("YYYY-MM-DD");

  await generateImage(today);
  await generateImage(tomorrow);
  await generateImage(dayAfterTomorrow);
  await generateImage(dayAfterThat);

  console.log("Deleting old images");

  const thirtyDaysAgo = now.subtract(30, "day").format("YYYY-MM-DD");

  await prisma.background.deleteMany({
    where: {
      date: { lt: thirtyDaysAgo },
    },
  });

  console.log("Done");

  process.exit(0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
