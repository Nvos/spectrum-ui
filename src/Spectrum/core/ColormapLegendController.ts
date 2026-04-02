import * as styles from "./styles.css";
import { COLORMAPS } from "./colormaps";
import { POWER_CEILING, POWER_FLOOR } from "./constants";
import { computePowerTicks } from "./powerAxisUtils";

const TOTAL_RANGE = POWER_CEILING - POWER_FLOOR;

const buildCSSGradient = (colorMap: number): string => {
  const fn = COLORMAPS[colorMap];
  const N = 64;
  const stops: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = 1 - i / N;
    const [r, g, b] = fn(t);
    stops.push(
      `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) ${((i / N) * 100).toFixed(2)}%`,
    );
  }
  return `linear-gradient(to bottom, ${stops.join(",")})`;
};

const dbmToPct = (dbm: number): number => ((POWER_CEILING - dbm) / TOTAL_RANGE) * 100;

const lockCursor = (cursor: string): () => void => {
  const el = document.createElement("style");
  el.textContent = `* { cursor: ${cursor} !important; }`;
  document.head.appendChild(el);
  return () => document.head.removeChild(el);
};

type Callbacks = {
  onChangeRange: (min: number, max: number) => void;
};

export class ColormapLegendController {
  private container: HTMLElement | null = null;
  private gradientEl: HTMLDivElement | null = null;
  private maxHandleEl: HTMLDivElement | null = null;
  private maxBadgeTextEl: HTMLSpanElement | null = null;
  private minHandleEl: HTMLDivElement | null = null;
  private minBadgeTextEl: HTMLSpanElement | null = null;

  private displayMin: number;
  private displayMax: number;
  private colormap: number;
  private callbacks: Callbacks;

  private maxDragging = false;
  private minDragging = false;
  private gradientDrag: { startY: number; startMin: number; startMax: number } | null = null;
  private unlockCursor: (() => void) | null = null;

  constructor(displayMin: number, displayMax: number, colormap: number, callbacks: Callbacks) {
    this.displayMin = displayMin;
    this.displayMax = displayMax;
    this.colormap = colormap;
    this.callbacks = callbacks;
  }

  mount(container: HTMLElement) {
    this.container = container;
    container.className = styles.colormapContainer;

    const gradientEl = document.createElement("div");
    gradientEl.className = styles.colormapGradientArea;

    const ticks = computePowerTicks(POWER_FLOOR, POWER_CEILING);
    const tickEls = ticks.map(({ dbm, pct }) => {
      const row = document.createElement("div");
      row.className = styles.colormapTickRow;
      row.style.top = `${pct}%`;
      const text = document.createElement("span");
      text.className = styles.colormapTickText;
      text.textContent = String(dbm);
      row.append(text);
      return row;
    });

    const maxHandle = this.makeHandle();
    const minHandle = this.makeHandle();
    maxHandle.el.setAttribute("aria-valuemin", String(POWER_FLOOR));
    maxHandle.el.setAttribute("aria-valuemax", String(POWER_CEILING));
    minHandle.el.setAttribute("aria-valuemin", String(POWER_FLOOR));
    minHandle.el.setAttribute("aria-valuemax", String(POWER_CEILING));

    container.append(gradientEl, ...tickEls, maxHandle.el, minHandle.el);

    this.gradientEl = gradientEl;
    this.maxHandleEl = maxHandle.el;
    this.maxBadgeTextEl = maxHandle.textEl;
    this.minHandleEl = minHandle.el;
    this.minBadgeTextEl = minHandle.textEl;

    maxHandle.el.addEventListener("mousedown", this.onMaxMouseDown);
    minHandle.el.addEventListener("mousedown", this.onMinMouseDown);
    gradientEl.addEventListener("mousedown", this.onGradientMouseDown);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);

    this.render();
  }

  private makeHandle(): { el: HTMLDivElement; textEl: HTMLSpanElement } {
    const el = document.createElement("div");
    el.className = styles.colormapHandle;
    el.setAttribute("role", "slider");
    const badge = document.createElement("div");
    badge.className = styles.colormapHandleBadge;
    const textEl = document.createElement("span");
    textEl.className = styles.colormapHandleBadgeText;
    badge.append(textEl);
    el.append(badge);
    return { el, textEl };
  }

  update(displayMin: number, displayMax: number, colormap: number) {
    this.displayMin = displayMin;
    this.displayMax = displayMax;
    this.colormap = colormap;
    this.render();
  }

  private render() {
    const { displayMin, displayMax, colormap } = this;
    const maxPct = dbmToPct(displayMax);
    const minPct = dbmToPct(displayMin);

    if (this.gradientEl) {
      this.gradientEl.style.top = `${maxPct}%`;
      this.gradientEl.style.height = `${minPct - maxPct}%`;
      this.gradientEl.style.background = buildCSSGradient(colormap);
    }
    if (this.maxHandleEl) {
      this.maxHandleEl.style.bottom = `${100 - maxPct}%`;
      this.maxHandleEl.setAttribute("aria-valuenow", String(displayMax));
    }
    if (this.maxBadgeTextEl) this.maxBadgeTextEl.textContent = String(displayMax);
    if (this.minHandleEl) {
      this.minHandleEl.style.top = `${minPct}%`;
      this.minHandleEl.setAttribute("aria-valuenow", String(displayMin));
    }
    if (this.minBadgeTextEl) this.minBadgeTextEl.textContent = String(displayMin);
  }

  private onMaxMouseDown = (e: MouseEvent) => {
    this.maxDragging = true;
    this.unlockCursor = lockCursor("ns-resize");
    e.preventDefault();
  };

  private onMinMouseDown = (e: MouseEvent) => {
    this.minDragging = true;
    this.unlockCursor = lockCursor("ns-resize");
    e.preventDefault();
  };

  private onGradientMouseDown = (e: MouseEvent) => {
    this.gradientDrag = { startY: e.clientY, startMin: this.displayMin, startMax: this.displayMax };
    this.unlockCursor = lockCursor("grabbing");
    e.preventDefault();
  };

  private onMouseMove = (e: MouseEvent) => {
    const container = this.container;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    if (this.maxDragging) {
      const pct = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const value = Math.round(POWER_CEILING - pct * TOTAL_RANGE);
      const newMax = Math.max(this.displayMin + 1, Math.min(POWER_CEILING, value));
      this.callbacks.onChangeRange(this.displayMin, newMax);
    } else if (this.minDragging) {
      const pct = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const value = Math.round(POWER_CEILING - pct * TOTAL_RANGE);
      const newMin = Math.max(POWER_FLOOR, Math.min(this.displayMax - 1, value));
      this.callbacks.onChangeRange(newMin, this.displayMax);
    } else if (this.gradientDrag) {
      const drag = this.gradientDrag;
      const dbmDelta = -((e.clientY - drag.startY) / rect.height) * TOTAL_RANGE;
      const range = drag.startMax - drag.startMin;
      const newMax = Math.round(
        Math.max(POWER_FLOOR + range, Math.min(POWER_CEILING, drag.startMax + dbmDelta)),
      );
      this.callbacks.onChangeRange(newMax - range, newMax);
    }
  };

  private onMouseUp = () => {
    this.maxDragging = false;
    this.minDragging = false;
    this.gradientDrag = null;
    this.unlockCursor?.();
    this.unlockCursor = null;
  };

  destroy() {
    this.maxHandleEl?.removeEventListener("mousedown", this.onMaxMouseDown);
    this.minHandleEl?.removeEventListener("mousedown", this.onMinMouseDown);
    this.gradientEl?.removeEventListener("mousedown", this.onGradientMouseDown);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseup", this.onMouseUp);
    this.unlockCursor?.();
    if (this.container) this.container.textContent = "";
    this.container = null;
    this.gradientEl = null;
    this.maxHandleEl = null;
    this.maxBadgeTextEl = null;
    this.minHandleEl = null;
    this.minBadgeTextEl = null;
  }
}
