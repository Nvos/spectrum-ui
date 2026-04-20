import { POWER_NO_READING } from "./constants";

export class MaxHoldLayer {
  readonly data: Int8Array;
  private readonly binCount: number;

  constructor(binCount: number, initial?: Int8Array) {
    this.binCount = binCount;
    this.data = new Int8Array(binCount).fill(POWER_NO_READING);
    if (initial && initial.length > 0) this.data.set(initial);
  }

  push(row: Int8Array) {
    for (let b = 0; b < this.binCount; b++) {
      if (row[b] > this.data[b]) this.data[b] = row[b];
    }
  }

  reset() {
    this.data.fill(POWER_NO_READING);
  }
}
