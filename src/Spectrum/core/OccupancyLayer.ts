import type { RingBuffer } from "./RingBuffer";

export class OccupancyLayer {
  readonly data: Float32Array;
  threshold: number;
  private counts: Uint32Array;
  private total = 0;
  private readonly binCount: number;
  private unsubscribeBuffer: () => void;

  constructor(
    binCount: number,
    buffer: RingBuffer,
    threshold: number,
    initial?: { counts: Uint32Array; total: number },
  ) {
    this.binCount = binCount;
    this.threshold = threshold;
    this.data = new Float32Array(binCount);
    this.counts = new Uint32Array(binCount);
    if (initial && initial.total > 0) {
      this.total = initial.total;
      this.counts.set(initial.counts);
      for (let b = 0; b < binCount; b++) {
        this.data[b] = this.counts[b] / this.total;
      }
    }
    this.unsubscribeBuffer = buffer.subscribe((writtenRow) => {
      const offset = writtenRow * this.binCount;
      this.total++;
      for (let b = 0; b < this.binCount; b++) {
        if (buffer.data[offset + b] > this.threshold) this.counts[b]++;
        this.data[b] = this.counts[b] / this.total;
      }
    });

  }

  setThreshold(threshold: number) {
    this.threshold = threshold;
    this.reset();
  }

  reset() {
    this.counts.fill(0);
    this.total = 0;
    this.data.fill(0);
  }

  destroy() {
    this.unsubscribeBuffer();
  }
}
