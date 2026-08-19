import * as styles from "./styles.css";
import type { RingBuffer } from "./RingBuffer";
import type { TimeCursor } from "./TimeCursor";

const MIN_LABEL_SPACING_PX = 44;
const MAX_LABELS = 12;

/** Wall-clock boundaries a label may land on, in seconds. */
const INTERVALS_SEC = [1, 5, 10, 30, 60, 300, 600, 1800, 3600];

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
 * DOM nodes are pooled — a long session creates at most `MAX_LABELS` of them.
 */
export class TimeLabelsController {
  private buffer: RingBuffer;
  private timeCursor: TimeCursor;
  private pool: PooledLabel[] = [];
  private container: HTMLElement | null = null;

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

  render = () => {
    const container = this.container;
    if (!container) return;

    const { buffer, timeCursor } = this;
    const D = timeCursor.displayRows;
    const anchor = timeCursor.anchorRow;
    const oldest = buffer.oldestAbs();

    if (anchor < oldest || !buffer.hasAbs(anchor)) {
      this.hideFrom(0);
      return;
    }

    const bottom = Math.max(oldest, anchor - D + 1);
    const height = container.clientHeight || 1;
    const maxLabels = Math.max(
      1,
      Math.min(MAX_LABELS, Math.floor(height / MIN_LABEL_SPACING_PX)),
    );

    // Interval comes from the span the window actually covers, so labels
    // re-space sensibly on resize and at any ingest rate.
    const spanSec = Math.max(0, (buffer.timestampAtAbs(anchor) - buffer.timestampAtAbs(bottom)) / 1000);
    const interval =
      INTERVALS_SEC.find((s) => spanSec / s <= maxLabels) ?? INTERVALS_SEC[INTERVALS_SEC.length - 1];

    const bucketOf = (absRow: number) => Math.floor(buffer.timestampAtAbs(absRow) / 1000 / interval);

    let used = 0;
    let prevBucket = bucketOf(bottom);
    for (let abs = bottom + 1; abs <= anchor && used < maxLabels + 1; abs++) {
      const bucket = bucketOf(abs);
      if (bucket === prevBucket) continue;
      prevBucket = bucket;
      if (buffer.timestampAtAbs(abs) <= 0) continue;

      const label = this.acquire(used);
      const top = `${((anchor - abs) / D) * 100}%`;
      // Label the boundary itself, not the row's exact timestamp, so the text
      // reads as a clean tick on the clock.
      const text = formatClock(bucket * interval * 1000);
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
  }
}
