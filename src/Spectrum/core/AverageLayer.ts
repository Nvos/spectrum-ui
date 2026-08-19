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
    const newest = buffer.totalWritten - 1;
    for (let abs = buffer.oldestAbs(); abs <= newest; abs++) {
      const ts = buffer.timestampAtAbs(abs);
      if (ts === 0) {
        this.initialized = false;
        continue;
      }
      const row = buffer.rowViewAbs(abs);
      if (!this.initialized) {
        for (let b = 0; b < binCount; b++) this.data[b] = row[b];
        this.initialized = true;
        continue;
      }
      const dt = ts - buffer.timestampAtAbs(abs - 1);
      if (dt <= 0) continue;
      const alpha = 1 - Math.exp(-dt / this.tau);
      for (let b = 0; b < binCount; b++) {
        this.data[b] = alpha * row[b] + (1 - alpha) * this.data[b];
      }
    }

    if (this.initialized) this.lastUpdateMs = buffer.timestampAtAbs(newest);
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
