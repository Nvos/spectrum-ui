import type { RingBuffer } from "./RingBuffer";

export class AverageLayer {
  readonly data: Float32Array;
  tau: number;
  private readonly binCount: number;
  private initialized = false;
  private lastUpdateMs: number | null = null;

  constructor(binCount: number, buffer: RingBuffer, tau: number) {
    this.binCount = binCount;
    this.tau = tau;
    this.data = new Float32Array(binCount);

    // Warm up EMA from any pre-filled historical rows (oldest → newest).
    const { rowCount, writeRow } = buffer;
    for (let di = 0; di < rowCount; di++) {
      const rowIdx = (writeRow + di) % rowCount;
      if (buffer.timestamps[rowIdx] === 0) {
        this.initialized = false;
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
  }

  push(row: Int8Array, timestampMs: number) {
    if (!this.initialized) {
      for (let b = 0; b < this.binCount; b++) this.data[b] = row[b];
      this.initialized = true;
      this.lastUpdateMs = timestampMs;
      return;
    }
    const dt = this.lastUpdateMs !== null ? timestampMs - this.lastUpdateMs : 60;
    this.lastUpdateMs = timestampMs;
    const alpha = 1 - Math.exp(-dt / this.tau);
    for (let b = 0; b < this.binCount; b++) {
      this.data[b] = alpha * row[b] + (1 - alpha) * this.data[b];
    }
  }

  setTau(tau: number) {
    this.tau = tau;
  }

  reset() {
    this.initialized = false;
    this.lastUpdateMs = null;
  }
}
