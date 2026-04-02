import type { RingBuffer } from "./RingBuffer";

const MIN_LABEL_SPACING_PX = 80;
const MAX_LABELS = 8;

type ActiveLabel = {
  createdAt: number;
  createdTs: number;
  lastAgeSec: number;
  el: HTMLDivElement;
  textEl: HTMLSpanElement;
};

const createLabel = (
  container: HTMLElement,
  ts: number,
  totalPushed: number,
): ActiveLabel => {
  const el = document.createElement("div");
  el.style.cssText =
    "position:absolute;left:0;right:0;display:flex;align-items:center;" +
    "transform:translateY(-50%);top:0%;pointer-events:none;";
  const textEl = document.createElement("span");
  textEl.style.cssText =
    "flex:1;text-align:right;font-size:10px;font-family:ui-monospace,monospace;" +
    "color:rgba(255,255,255,0.65);line-height:1;padding-right:2px;" +
    "text-shadow:0 1px 2px rgba(0,0,0,0.95),0 -1px 2px rgba(0,0,0,0.95);";
  textEl.textContent = "-0s";
  const tick = document.createElement("div");
  tick.style.cssText =
    "width:6px;height:1px;flex-shrink:0;background:rgba(255,255,255,0.25);";
  el.append(textEl, tick);
  container.append(el);
  return { createdAt: totalPushed, createdTs: ts, lastAgeSec: 0, el, textEl };
};

const calcRowInterval = (containerHeight: number, rowCount: number): number => {
  const labelCount = Math.min(
    MAX_LABELS,
    Math.max(1, Math.floor(containerHeight / MIN_LABEL_SPACING_PX)),
  );
  return Math.max(1, Math.floor(rowCount / labelCount));
};

export class TimeLabelsController {
  private buffer: RingBuffer;
  private rowCount: number;
  private labels: ActiveLabel[] = [];
  private totalPushed = 0;
  private rowInterval = 1;
  private container: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private ro: ResizeObserver | null = null;

  constructor(buffer: RingBuffer, rowCount: number) {
    this.buffer = buffer;
    this.rowCount = rowCount;
  }

  mount(container: HTMLElement) {
    this.container = container;
    this.rowInterval = calcRowInterval(container.clientHeight, this.rowCount);

    this.replayLabels();

    this.unsubscribe = this.buffer.subscribe((writtenRow) => {
      const newestTs = this.buffer.timestamps[writtenRow];

      if (this.totalPushed > 0 && this.totalPushed % this.rowInterval === 0) {
        this.labels.push(createLabel(container, newestTs, this.totalPushed));
      }

      this.totalPushed++;
      this.updatePositions(newestTs);
    });

    this.ro = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? container.clientHeight;
      const newInterval = calcRowInterval(height, this.rowCount);
      if (newInterval !== this.rowInterval) {
        this.rowInterval = newInterval;
        this.replayLabels();
      }
    });
    this.ro.observe(container);
  }

  private updatePositions(newestTs: number) {
    const { labels, rowCount, totalPushed } = this;
    for (let i = labels.length - 1; i >= 0; i--) {
      const label = labels[i];
      const age = totalPushed - 1 - label.createdAt;
      const pct = (age / (rowCount - 1)) * 100;
      if (pct > 100) {
        label.el.remove();
        labels.splice(i, 1);
      } else {
        label.el.style.top = `${pct}%`;
        const ageSec = Math.round((newestTs - label.createdTs) / 1000);
        if (ageSec !== label.lastAgeSec) {
          label.lastAgeSec = ageSec;
          label.textEl.textContent = `${ageSec}s`;
        }
      }
    }
  }

  private replayLabels() {
    const container = this.container;
    if (!container) return;

    for (const label of this.labels) label.el.remove();
    this.labels = [];
    this.totalPushed = 0;

    const { buffer, rowCount, rowInterval } = this;
    for (let di = 0; di < rowCount; di++) {
      const rowIdx = (buffer.writeRow + di) % rowCount;
      const ts = buffer.timestamps[rowIdx];
      if (ts === 0) continue;

      if (this.totalPushed > 0 && this.totalPushed % rowInterval === 0) {
        this.labels.push(createLabel(container, ts, this.totalPushed));
      }
      this.totalPushed++;
    }

    if (this.labels.length > 0) {
      const newestIdx = (buffer.writeRow - 1 + rowCount) % rowCount;
      const newestTs = buffer.timestamps[newestIdx];
      this.updatePositions(newestTs);
    }
  }

  destroy() {
    this.unsubscribe?.();
    this.ro?.disconnect();
    for (const label of this.labels) label.el.remove();
    this.labels = [];
    this.totalPushed = 0;
    this.container = null;
  }
}
