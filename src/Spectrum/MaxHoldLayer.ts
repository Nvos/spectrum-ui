import { POWER_NO_READING } from "./constants";
import type { RingBuffer } from "./RingBuffer";

export class MaxHoldLayer {
  readonly data: Int8Array;
  private unsubscribe: () => void;

  constructor(binCount: number, buffer: RingBuffer, initial?: Int8Array) {
    this.data = new Int8Array(binCount).fill(POWER_NO_READING);
    if (initial && initial.length > 0) this.data.set(initial);
    this.unsubscribe = buffer.subscribe((writtenRow) => {
      const offset = writtenRow * binCount;
      for (let b = 0; b < binCount; b++) {
        if (buffer.data[offset + b] > this.data[b]) {
          this.data[b] = buffer.data[offset + b];
        }
      }
    });
  }

  reset() {
    this.data.fill(POWER_NO_READING);
  }

  destroy() {
    this.unsubscribe();
  }
}
