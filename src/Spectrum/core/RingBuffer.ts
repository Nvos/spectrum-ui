export type InitialRows = {
  rows: Int8Array;
  count: number;
  timestamps: number[];
};

/**
 * Fixed-depth ring of rows, addressed by **absolute row index** — a monotonic
 * counter in `totalWritten` space that never wraps.
 *
 * All consumers read through the `*Abs` accessors; the ring slot arithmetic is
 * an implementation detail. That is what lets phase 2 swap this out for a
 * page-indexed store without touching a renderer.
 */
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

  /** Absolute index of the oldest row still retained. Rises with every push once the ring is full. */
  oldestAbs(): number {
    return Math.max(0, this.totalWritten - this.rowCount);
  }

  /**
   * The single predicate answering "is row R available?".
   * Phase 1: `R >= T - N`. Phase 2 replaces the body with a page-map lookup —
   * keep call sites on this, never an inline comparison.
   */
  hasAbs(absRow: number): boolean {
    return absRow >= this.oldestAbs() && absRow < this.totalWritten;
  }

  /** Ring slot backing an absolute row. Only storage-aware code should need this. */
  slotOf(absRow: number): number {
    return absRow % this.rowCount;
  }

  rowViewAbs(absRow: number): Int8Array {
    const start = (absRow % this.rowCount) * this.binCount;
    return this.data.subarray(start, start + this.binCount);
  }

  /** Single-bin read, avoiding a subarray allocation on hover paths. */
  sampleAbs(absRow: number, bin: number): number {
    return this.data[(absRow % this.rowCount) * this.binCount + bin];
  }

  timestampAtAbs(absRow: number): number {
    return this.timestamps[absRow % this.rowCount];
  }
}
