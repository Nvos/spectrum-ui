import { useCallback, useEffect, useRef } from "react";
import * as styles from "./useFrequencyAxis.css";

interface FrequencyAxisOptions {
  freqMin: number;
  freqMax: number;
}

// Worst-case label: "1000.000" — 9 chars (5 integer + dot + 3 decimal) at 10px mono (~6 px/ch) + gap
const TICK_SLOT_PX = 9 * 6 + 10;

const niceInterval = (range: number, maxTicks: number): number => {
  const rough = range / maxTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  for (const s of [1, 2, 5, 10]) {
    if (s * magnitude >= rough) return s * magnitude;
  }
  return 10 * magnitude;
}

const formatFreq = (mhz: number): string => {
  return mhz.toFixed(3);
}

type Tick = { freq: number; pct: number };

const computeTicks = (
  freqMin: number,
  freqMax: number,
  maxTicks: number,
  start: number,
  end: number,
): Tick[] => {
  const visibleMin = freqMin + start * (freqMax - freqMin);
  const visibleMax = freqMin + end * (freqMax - freqMin);
  const visibleRange = visibleMax - visibleMin;

  const interval = niceInterval(visibleRange, maxTicks);
  const firstTick = Math.ceil(visibleMin / interval) * interval;

  const ticks: Tick[] = [];
  for (let f = firstTick; f <= visibleMax; f += interval) {
    const pct = ((f - visibleMin) / visibleRange) * 100;
    ticks.push({ freq: f, pct });
  }
  return ticks;
}

const createTickElement = (container: HTMLElement): HTMLElement => {
  const el = document.createElement("div");
  el.className = styles.tick;
  const topMark = document.createElement("div");
  topMark.className = styles.tickMark;
  const label = document.createElement("span");
  label.className = styles.tickLabel;
  const bottomMark = document.createElement("div");
  bottomMark.className = styles.tickMark;
  el.append(topMark, label, bottomMark);
  container.append(el);
  return el;
}

export const useFrequencyAxis = ({ freqMin, freqMax }: FrequencyAxisOptions) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const tickPoolRef = useRef<HTMLElement[]>([]);

  const update = useCallback(
    (start: number, end: number) => {
      const container = containerRef.current;
      if (!container) return;

      const maxTicks = Math.max(2, Math.floor(container.clientWidth / TICK_SLOT_PX));
      const ticks = computeTicks(freqMin, freqMax, maxTicks, start, end);

      while (tickPoolRef.current.length < ticks.length) {
        tickPoolRef.current.push(createTickElement(container));
      }

      ticks.forEach(({ freq, pct }, i) => {
        const el = tickPoolRef.current[i];
        el.style.left = `${pct}%`;
        el.style.display = "flex";
        el.style.transform = "translateX(-50%)";
        el.style.alignItems = "center";
        (el.children[1] as HTMLElement).textContent = formatFreq(freq);
      });

      for (let i = ticks.length; i < tickPoolRef.current.length; i++) {
        tickPoolRef.current[i].style.display = "none";
      }
    },
    [freqMin, freqMax],
  );

  // Render initial state
  useEffect(() => {
    update(0, 1);
  }, [update]);

  return { containerRef, update };
}
