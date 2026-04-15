export type HighlightRange = {
  normalizedStart: number;
  normalizedEnd: number;
  color: string;
};

export class SubviewHighlightController {
  private container: HTMLElement | null = null;
  private pool: HTMLElement[] = [];
  private ranges: HighlightRange[] = [];

  mount(container: HTMLElement) {
    this.container = container;
  }

  setRanges(ranges: HighlightRange[]) {
    this.ranges = ranges;
  }

  update(viewStart: number, viewEnd: number) {
    const container = this.container;
    if (!container) return;
    const { ranges, pool } = this;

    while (pool.length < ranges.length) {
      const el = document.createElement("div");
      el.style.cssText = "position:absolute;top:0;bottom:0;pointer-events:none;";
      container.append(el);
      pool.push(el);
    }

    const viewSpan = viewEnd - viewStart;

    ranges.forEach(({ normalizedStart, normalizedEnd, color }, i) => {
      const el = pool[i];
      const leftNorm = (normalizedStart - viewStart) / viewSpan;
      const rightNorm = (normalizedEnd - viewStart) / viewSpan;

      if (rightNorm <= 0 || leftNorm >= 1) {
        el.style.display = "none";
        return;
      }

      const leftPct = Math.max(0, leftNorm) * 100;
      const rightPct = Math.min(1, rightNorm) * 100;
      el.style.display = "";
      el.style.left = `${leftPct}%`;
      el.style.width = `${rightPct - leftPct}%`;
      el.style.background = color;
    });

    for (let i = ranges.length; i < pool.length; i++) {
      pool[i].style.display = "none";
    }
  }

  destroy() {
    for (const el of this.pool) el.remove();
    this.pool = [];
    this.container = null;
  }
}
