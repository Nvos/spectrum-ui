import { computeTicks } from "./FrequencyAxisController";

const TICK_SLOT_PX = 9 * 6 + 10;

export class GridLineController {
  private freqMin: number;
  private freqMax: number;
  private container: HTMLElement | null = null;
  private pool: HTMLDivElement[] = [];

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

    while (this.pool.length < ticks.length) {
      const el = document.createElement("div");
      el.style.cssText = [
        "position:absolute",
        "top:0",
        "bottom:0",
        "width:1px",
        "transform:translateX(-50%)",
        "background:rgba(255,255,255,0.07)",
        "pointer-events:none",
      ].join(";");
      container.append(el);
      this.pool.push(el);
    }

    ticks.forEach(({ pct }, i) => {
      const el = this.pool[i];
      el.style.left = `${pct}%`;
      el.style.display = "";
    });

    for (let i = ticks.length; i < this.pool.length; i++) {
      this.pool[i].style.display = "none";
    }
  }

  destroy() {
    for (const el of this.pool) el.remove();
    this.pool = [];
    this.container = null;
  }
}
