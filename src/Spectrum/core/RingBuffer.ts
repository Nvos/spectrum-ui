export type InitialRows = {
  rows: Int8Array;
  count: number;
  timestamps: number[];
};

export class RingBuffer {
  rowCount: number;
  binCount: number;
  data: Int8Array;
  timestamps: Float64Array;
  writeRow: number = 0;
  totalWritten: number = 0;

  constructor(rowCount: number, binCount: number, initial?: InitialRows, emptyFill = 0) {
    this.rowCount = rowCount;
    this.binCount = binCount;
    this.data = new Int8Array(rowCount * binCount).fill(emptyFill);
    this.timestamps = new Float64Array(rowCount);

    if (initial && initial.count > 0) {
      const count = Math.min(initial.count, rowCount);
      this.data.set(initial.rows.subarray(0, count * binCount));
      for (let i = 0; i < count; i++) {
        this.timestamps[i] = initial.timestamps[i];
      }
      this.writeRow = count % rowCount;
      this.totalWritten = count;
    }
  }

  push(row: Int8Array, timestampMs: number) {
    this.data.set(row, this.writeRow * this.binCount);
    this.timestamps[this.writeRow] = timestampMs;
    this.writeRow = (this.writeRow + 1) % this.rowCount;
    this.totalWritten++;
  }

  rowView(row: number): Int8Array {
    return this.data.subarray(row * this.binCount, (row + 1) * this.binCount);
  }
}
