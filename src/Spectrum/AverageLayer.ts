import type { RingBuffer } from "./RingBuffer";
import { avgTauAtom, type SpectrumStore } from "./store";

export class AverageLayer {
  readonly data: Float32Array;
  tau: number;
  private initialized = false;
  private lastUpdateMs: number | null = null;
  private unsubscribeBuffer: () => void;
  private unsubscribeStore: () => void;

  constructor(binCount: number, buffer: RingBuffer, store: SpectrumStore) {
    this.tau = store.get(avgTauAtom);
    this.data = new Float32Array(binCount);

    // Warm up EMA from any pre-filled historical rows (oldest → newest).
    // Iterating from writeRow wraps correctly for both full and partial buffers.
    const { rowCount, writeRow } = buffer;
    for (let di = 0; di < rowCount; di++) {
      const rowIdx = (writeRow + di) % rowCount;
      if (buffer.timestamps[rowIdx] === 0) {
        this.initialized = false; // gap resets the seed
        continue;
      }
      const offset = rowIdx * binCount;
      if (!this.initialized) {
        for (let b = 0; b < binCount; b++) this.data[b] = buffer.data[offset + b];
        this.initialized = true;
        continue;
      }
      const prevRowIdx = (rowIdx - 1 + rowCount) % rowCount;
      const dt = (buffer.timestamps[rowIdx] - buffer.timestamps[prevRowIdx]) * 1000; // s → ms
      if (dt <= 0) continue;
      const alpha = 1 - Math.exp(-dt / this.tau);
      for (let b = 0; b < binCount; b++) {
        this.data[b] = alpha * buffer.data[offset + b] + (1 - alpha) * this.data[b];
      }
    }

    // Anchor the live-path timer to now so the first live frame gets a
    // realistic dt (~one tick interval) rather than a huge initial step.
    if (this.initialized) this.lastUpdateMs = Date.now();

    this.unsubscribeBuffer = buffer.subscribe((writtenRow) => {
      const now = Date.now();
      const offset = writtenRow * binCount;
      if (!this.initialized) {
        for (let b = 0; b < binCount; b++) this.data[b] = buffer.data[offset + b];
        this.initialized = true;
        this.lastUpdateMs = now;
        return;
      }
      // Use wall-clock ms for per-frame precision — buffer timestamps are
      // integer seconds which would cause the EMA to jump once per second.
      const dt = this.lastUpdateMs !== null ? now - this.lastUpdateMs : 60;
      this.lastUpdateMs = now;
      const alpha = 1 - Math.exp(-dt / this.tau);
      for (let b = 0; b < binCount; b++) {
        this.data[b] = alpha * buffer.data[offset + b] + (1 - alpha) * this.data[b];
      }
    });

    this.unsubscribeStore = store.sub(avgTauAtom, () => {
      this.tau = store.get(avgTauAtom);
    });
  }

  reset() {
    this.initialized = false;
    this.lastUpdateMs = null;
  }

  destroy() {
    this.unsubscribeBuffer();
    this.unsubscribeStore();
  }
}
