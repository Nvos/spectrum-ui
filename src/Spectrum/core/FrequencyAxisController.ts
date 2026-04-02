import * as styles from "./styles.css";

const TICK_SLOT_PX = 9 * 6 + 10;

const niceInterval = (range: number, maxTicks: number): number => {
  const rough = range / maxTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  for (const s of [1, 2, 5, 10]) {
    if (s * magnitude >= rough) return s * magnitude;
  }
  return 10 * magnitude;
};

const formatFreq = (mhz: number): string => mhz.toFixed(3);

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
    ticks.push({ freq: f, pct: ((f - visibleMin) / visibleRange) * 100 });
  }
  return ticks;
};

const createTickElement = (container: HTMLElement): HTMLElement => {
  const el = document.createElement("div");
  el.className = styles.freqAxisTick;
  const topMark = document.createElement("div");
  topMark.className = styles.freqAxisTickMark;
  const label = document.createElement("span");
  label.className = styles.freqAxisTickLabel;
  const bottomMark = document.createElement("div");
  bottomMark.className = styles.freqAxisTickMark;
  el.append(topMark, label, bottomMark);
  container.append(el);
  return el;
};

export class FrequencyAxisController {
  private freqMin: number;
  private freqMax: number;
  private container: HTMLElement | null = null;
  private tickPool: HTMLElement[] = [];

  constructor(freqMin: number, freqMax: number) {
    this.freqMin = freqMin;
    this.freqMax = freqMax;
  }

  mount(container: HTMLElement) {
    this.container = container;
    this.update(0, 1);
  }

  update(start: number, end: number) {
    const container = this.container;
    if (!container) return;

    const maxTicks = Math.max(2, Math.floor(container.clientWidth / TICK_SLOT_PX));
    const ticks = computeTicks(this.freqMin, this.freqMax, maxTicks, start, end);

    while (this.tickPool.length < ticks.length) {
      this.tickPool.push(createTickElement(container));
    }

    ticks.forEach(({ freq, pct }, i) => {
      const el = this.tickPool[i];
      el.style.left = `${pct}%`;
      el.style.display = "";
      (el.children[1] as HTMLElement).textContent = formatFreq(freq);
    });

    for (let i = ticks.length; i < this.tickPool.length; i++) {
      this.tickPool[i].style.display = "none";
    }
  }

  destroy() {
    for (const el of this.tickPool) el.remove();
    this.tickPool = [];
    this.container = null;
  }
}
