import type { RingBuffer } from "./RingBuffer";
import { occupancyThresholdAtom, type SpectrumStore } from "./store";

export class OccupancyLayer {
  readonly data: Float32Array;
  threshold: number;
  private counts: Uint32Array;
  private total = 0;
  private readonly binCount: number;
  private unsubscribeBuffer: () => void;
  private unsubscribeStore: () => void;

  constructor(
    binCount: number,
    buffer: RingBuffer,
    store: SpectrumStore,
    initial?: { values: Float32Array; total: number },
  ) {
    this.binCount = binCount;
    this.threshold = store.get(occupancyThresholdAtom);
    this.data = new Float32Array(binCount);
    this.counts = new Uint32Array(binCount);
    if (initial && initial.total > 0) {
      this.total = initial.total;
      this.data.set(initial.values);
      for (let b = 0; b < binCount; b++) {
        this.counts[b] = Math.round(initial.values[b] * initial.total);
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

    this.unsubscribeStore = store.sub(occupancyThresholdAtom, () => {
      this.threshold = store.get(occupancyThresholdAtom);
      this.reset();
    });
  }

  reset() {
    this.counts.fill(0);
    this.total = 0;
    this.data.fill(0);
  }

  destroy() {
    this.unsubscribeBuffer();
    this.unsubscribeStore();
  }
}
