<template>
  <time
    class="text-[120px] font-black leading-[150px] text-slate-100 drop-shadow-lg md:text-[140px]"
  >
    {{ currentTime }}
  </time>
</template>

<script setup lang="ts">
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { useClockStore } from "~/stores/clock";

// eslint-disable-next-line import/no-named-as-default-member
dayjs.extend(utc);
// eslint-disable-next-line import/no-named-as-default-member
dayjs.extend(timezone);

const clockStore = useClockStore();

const currentTime = ref("");
const mounted = ref(true);

const timerInterval = ref<NodeJS.Timeout | null>(null);

const display24Hours = computed(() => clockStore.display24Hours);
const timeZone = computed(
  () => clockStore.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
);

const getCurrentTime = () => {
  const timeFormat = display24Hours.value ? "H:mm" : "h:mm";

  currentTime.value = dayjs().tz(timeZone.value).format(timeFormat);
};

onMounted(() => {
  getCurrentTime();
  timerInterval.value = setInterval(getCurrentTime, 100);

  mounted.value = true;
});

// destroy timer on unmount
onUnmounted(() => {
  mounted.value = false;

  if (timerInterval.value) {
    clearInterval(timerInterval.value);
  }
});
</script>
