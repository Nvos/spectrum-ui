import type { RingBuffer } from "./RingBuffer";

export class AverageLayer {
  readonly data: Float32Array;
  tau: number;
  private initialized = false;
  private lastUpdateMs: number | null = null;
  private unsubscribeBuffer: () => void;

  constructor(binCount: number, buffer: RingBuffer, tau: number) {
    this.tau = tau;
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
      const dt = buffer.timestamps[rowIdx] - buffer.timestamps[prevRowIdx];
      if (dt <= 0) continue;
      const alpha = 1 - Math.exp(-dt / this.tau);
      for (let b = 0; b < binCount; b++) {
        this.data[b] = alpha * buffer.data[offset + b] + (1 - alpha) * this.data[b];
      }
    }

    if (this.initialized) this.lastUpdateMs = buffer.timestamps[(writeRow - 1 + rowCount) % rowCount];

    this.unsubscribeBuffer = buffer.subscribe((writtenRow) => {
      const offset = writtenRow * binCount;
      if (!this.initialized) {
        for (let b = 0; b < binCount; b++) this.data[b] = buffer.data[offset + b];
        this.initialized = true;
        this.lastUpdateMs = buffer.timestamps[writtenRow];
        return;
      }
      const dt = this.lastUpdateMs !== null ? buffer.timestamps[writtenRow] - this.lastUpdateMs : 60;
      this.lastUpdateMs = buffer.timestamps[writtenRow];
      const alpha = 1 - Math.exp(-dt / this.tau);
      for (let b = 0; b < binCount; b++) {
        this.data[b] = alpha * buffer.data[offset + b] + (1 - alpha) * this.data[b];
      }
    });

  }

  setTau(tau: number) {
    this.tau = tau;
  }

  reset() {
    this.initialized = false;
    this.lastUpdateMs = null;
  }

  destroy() {
    this.unsubscribeBuffer();
  }
}
