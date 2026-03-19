import { type RefObject, useEffect, useRef } from "react";
import type { RingBuffer } from "./RingBuffer";

const INTERVALS_S = [1, 2, 5, 10, 30, 60];
const TARGET_TICKS = 5;

const pickInterval = (visibleSpanS: number): number => {
  const rough = visibleSpanS / TARGET_TICKS;
  return (
    INTERVALS_S.find((i) => i >= rough) ??
    // oxlint-disable-next-line unicorn/prefer-at
    INTERVALS_S[INTERVALS_S.length - 1]
  );
}

type ActiveLabel = {
  createdAt: number;
  createdTs: number;
  lastAgeSec: number;
  el: HTMLDivElement;
  textEl: HTMLSpanElement;
};

const createLabel = (container: HTMLElement, ts: number, totalPushed: number): ActiveLabel => {
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
  tick.style.cssText = "width:6px;height:1px;flex-shrink:0;background:rgba(255,255,255,0.25);";
  el.append(textEl, tick);
  container.append(el);
  return { createdAt: totalPushed, createdTs: ts, lastAgeSec: 0, el, textEl };
}

export const useTimeLabels = (
  containerRef: RefObject<HTMLDivElement | null>,
  buffer: RingBuffer,
  rowCount: number,
) => {
  const labelsRef = useRef<ActiveLabel[]>([]);

  // oxlint-disable-next-line max-lines-per-function
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const labels = labelsRef.current;
    let totalPushed = 0;

    // Replay pre-populated rows (oldest → newest) to seed initial labels.
    // Uses a fixed interval derived from the full buffer span so all labels
    // are spaced consistently, regardless of which row is being processed.
    const oldestTs = buffer.timestamps[buffer.writeRow % rowCount];
    const newestTsExisting = buffer.timestamps[(buffer.writeRow - 1 + rowCount) % rowCount];
    const replaySpan =
      oldestTs > 0 && newestTsExisting > oldestTs ? newestTsExisting - oldestTs : rowCount * 0.1;
    const replayInterval = pickInterval(replaySpan);

    let replayPrevTs = 0;
    for (let di = 0; di < rowCount; di++) {
      const rowIdx = (buffer.writeRow + di) % rowCount;
      const ts = buffer.timestamps[rowIdx];
      if (ts === 0) {
        replayPrevTs = 0;
        continue;
      }
      if (
        replayPrevTs > 0 &&
        Math.floor(ts / replayInterval) !== Math.floor(replayPrevTs / replayInterval)
      ) {
        labels.push(createLabel(container, ts, totalPushed));
      }
      replayPrevTs = ts;
      totalPushed++;
    }

    // Set initial positions for replayed labels.
    for (let i = labels.length - 1; i >= 0; i--) {
      const label = labels[i];
      const age = totalPushed - 1 - label.createdAt;
      const pct = (age / (rowCount - 1)) * 100;
      if (pct > 100) {
        label.el.remove();
        labels.splice(i, 1);
      } else {
        label.el.style.top = `${pct}%`;
        const ageSec = newestTsExisting - label.createdTs;
        label.lastAgeSec = ageSec;
        label.textEl.textContent = `-${ageSec}s`;
      }
    }

    const unsubscribe = buffer.subscribe((writtenRow) => {
      const writeRow = buffer.writeRow;
      const newestTs = buffer.timestamps[writtenRow];
      const oldestTs = buffer.timestamps[writeRow % rowCount];
      const visibleSpan = oldestTs > 0 ? newestTs - oldestTs : rowCount * 0.1;
      const interval = pickInterval(visibleSpan);

      const prevRow = (writtenRow - 1 + rowCount) % rowCount;
      const prevTs = buffer.timestamps[prevRow];
      if (prevTs > 0 && Math.floor(newestTs / interval) !== Math.floor(prevTs / interval)) {
        labels.push(createLabel(container, newestTs, totalPushed));
      }

      totalPushed++;

      for (let i = labels.length - 1; i >= 0; i--) {
        const label = labels[i];
        const age = totalPushed - 1 - label.createdAt;
        const pct = (age / (rowCount - 1)) * 100;
        if (pct > 100) {
          label.el.remove();
          labels.splice(i, 1);
        } else {
          label.el.style.top = `${pct}%`;
          const ageSec = newestTs - label.createdTs;
          if (ageSec !== label.lastAgeSec) {
            label.lastAgeSec = ageSec;
            label.textEl.textContent = `-${ageSec}s`;
          }
        }
      }
    });

    return () => {
      unsubscribe();
      for (const label of labels) label.el.remove();
      labels.length = 0;
    };
  }, [buffer, rowCount, containerRef]);
}
