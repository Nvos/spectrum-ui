import * as styles from "./styles.css";
import type { RingBuffer } from "./RingBuffer";
import type { TimeCursor } from "./TimeCursor";

/**
 * Spacing band the chosen interval aims for, in CSS pixels. Labels are 10px
 * text, so ~32px is about three line-heights — dense enough to read a time off
 * any part of the gutter, loose enough not to crowd.
 *
 * The band (rather than a single minimum) provides hysteresis: an interval that
 * still lands inside it is kept, so the ladder cannot flip back and forth while
 * the view scrolls across small variations in row rate.
 */
const MIN_LABEL_SPACING_PX = 32;
const MAX_LABEL_SPACING_PX = 96;

/** Half a label's line box. Boundaries closer than this to a pane edge are
 *  dropped rather than rendered clipped by the gutter's `overflow: hidden`. */
const LABEL_HALF_HEIGHT_PX = 7;

/** Hard cap on pooled DOM nodes. */
const MAX_POOL = 40;

/**
 * Wall-clock boundaries a label may land on, in seconds.
 *
 * Intermediate steps matter: a bare 1/5/10/30/60 ladder jumps 5x at the bottom,
 * so a window that wants ~2s spacing gets 5s and leaves most of a short pane
 * empty.
 */
const INTERVALS_SEC = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

type PooledLabel = {
  el: HTMLDivElement;
  textEl: HTMLSpanElement;
  lastText: string;
  lastTop: string;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const formatClock = (ms: number): string => {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

/**
 * Absolute wall-clock labels for the visible waterfall window.
 *
 * Declarative: every frame walks the rows currently on screen and emits a label
 * wherever the clock crosses an interval boundary. The previous design created
 * a label every `rowInterval` pushes and moved it by age, which structurally
 * could not render a frozen or scrolled window.
 *
 * DOM nodes are pooled — a long session creates at most `MAX_POOL` of them.
 */
export class TimeLabelsController {
  private buffer: RingBuffer;
  private timeCursor: TimeCursor;
  private pool: PooledLabel[] = [];
  private container: HTMLElement | null = null;
  private lastInterval = 0;

  constructor(buffer: RingBuffer, timeCursor: TimeCursor) {
    this.buffer = buffer;
    this.timeCursor = timeCursor;
  }

  mount(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  private acquire(index: number): PooledLabel {
    let label = this.pool[index];
    if (!label) {
      const el = document.createElement("div");
      el.className = styles.timeLabelRow;
      const textEl = document.createElement("span");
      textEl.className = styles.timeLabelText;
      const tick = document.createElement("div");
      tick.className = styles.timeLabelTick;
      el.append(textEl, tick);
      this.container!.append(el);
      label = { el, textEl, lastText: "", lastTop: "" };
      this.pool[index] = label;
    }
    return label;
  }

  /**
   * Pick a boundary interval from how much wall-clock time one pixel covers.
   *
   * Deliberately a function of the *local row period and the pane* only — never
   * of the window's absolute extent or its position in history. Two windows of
   * the same pane over the same feed therefore get the same interval, so the
   * labels do not re-space as the user scrolls.
   */
  private chooseInterval(secPerPx: number): number {
    if (this.lastInterval > 0) {
      const spacing = this.lastInterval / secPerPx;
      if (spacing >= MIN_LABEL_SPACING_PX && spacing <= MAX_LABEL_SPACING_PX) {
        return this.lastInterval;
      }
    }
    const wanted = secPerPx * MIN_LABEL_SPACING_PX;
    const next = INTERVALS_SEC.find((i) => i >= wanted) ?? INTERVALS_SEC[INTERVALS_SEC.length - 1];
    this.lastInterval = next;
    return next;
  }

  render = () => {
    const container = this.container;
    if (!container) return;

    const { buffer, timeCursor } = this;
    const D = timeCursor.displayRows;
    const anchor = timeCursor.anchorRow;
    const oldest = buffer.oldestAbs();

    if (!buffer.hasAbs(anchor)) {
      this.hideFrom(0);
      return;
    }

    const bottom = Math.max(oldest, anchor - D + 1);
    const rows = anchor - bottom;
    const height = container.clientHeight || 1;
    const spanSec = (buffer.timestampAtAbs(anchor) - buffer.timestampAtAbs(bottom)) / 1000;

    // Fewer than two rows, or no elapsed time between them: there is no time
    // axis to draw yet.
    if (rows <= 0 || !(spanSec > 0)) {
      this.hideFrom(0);
      return;
    }

    const pxPerRow = height / D;
    const secPerPx = spanSec / rows / pxPerRow;
    const interval = this.chooseInterval(secPerPx);
    const bucketOf = (absRow: number) =>
      Math.floor(buffer.timestampAtAbs(absRow) / 1000 / interval);

    const maxLabels = Math.min(MAX_POOL, Math.ceil(height / MIN_LABEL_SPACING_PX) + 2);

    let used = 0;
    // Newest → oldest, so that if the cap is ever reached it is the oldest
    // labels (bottom of the pane) that are dropped, not the ones by the live
    // edge where the user is looking.
    for (let abs = anchor; abs > bottom && used < maxLabels; abs--) {
      // `abs` opens a new bucket iff the row below it belongs to an older one.
      if (bucketOf(abs - 1) === bucketOf(abs)) continue;
      if (buffer.timestampAtAbs(abs) <= 0) continue;

      const yPx = ((anchor - abs) / D) * height;
      if (yPx < LABEL_HALF_HEIGHT_PX || yPx > height - LABEL_HALF_HEIGHT_PX) continue;

      const label = this.acquire(used);
      const top = `${((anchor - abs) / D) * 100}%`;
      // Label the boundary itself, not the row's exact timestamp, so the text
      // reads as a clean tick on the clock.
      const text = formatClock(bucketOf(abs) * interval * 1000);
      if (label.lastTop !== top) {
        label.el.style.top = top;
        label.lastTop = top;
      }
      if (label.lastText !== text) {
        label.textEl.textContent = text;
        label.lastText = text;
      }
      if (label.el.style.display === "none") label.el.style.display = "";
      used++;
    }

    this.hideFrom(used);
  };

  private hideFrom(index: number) {
    for (let i = index; i < this.pool.length; i++) {
      const el = this.pool[i].el;
      if (el.style.display !== "none") el.style.display = "none";
    }
  }

  destroy() {
    for (const label of this.pool) label.el.remove();
    this.pool = [];
    this.container = null;
    this.lastInterval = 0;
  }
}
