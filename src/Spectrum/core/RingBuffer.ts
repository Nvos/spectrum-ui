export type InitialRows = {
  rows: Int8Array;
  count: number;
  timestamps: number[];
  /** Backend-assigned sequence of the first row. Defaults to zero for local data. */
  seqStart?: number;
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
  private validStart: number = 0;
  private readonly emptyFill: number;

  constructor(rowCount: number, binCount: number, initial?: InitialRows, emptyFill = 0) {
    this.rowCount = rowCount;
    this.binCount = binCount;
    this.data = new Int8Array(rowCount * binCount).fill(emptyFill);
    this.timestamps = new Float64Array(rowCount);
    this.emptyFill = emptyFill;

    if (initial) {
      const count = Math.min(initial.count, rowCount);
      const sourceOffsetRows = initial.count - count;
      const seqStart = (initial.seqStart ?? 0) + sourceOffsetRows;
      this.validStart = seqStart;
      for (let i = 0; i < count; i++) {
        const seq = seqStart + i;
        const slot = seq % rowCount;
        const sourceStart = (sourceOffsetRows + i) * binCount;
        this.data.set(initial.rows.subarray(sourceStart, sourceStart + binCount), slot * binCount);
        this.timestamps[slot] = initial.timestamps[sourceOffsetRows + i];
      }
      this.totalWritten = seqStart + count;
      this.writeRow = this.totalWritten % rowCount;
    }
  }

  push(row: Int8Array, timestampMs: number) {
    this.pushAt(this.totalWritten, row, timestampMs);
  }

  /** Writes a backend-addressed row. Duplicate/late rows are ignored. */
  pushAt(absRow: number, row: Int8Array, timestampMs: number): boolean {
    if (absRow < this.totalWritten) return false;
    if (absRow > this.totalWritten) this.fillGap(this.totalWritten, absRow);
    const slot = absRow % this.rowCount;
    this.data.set(row, slot * this.binCount);
    this.timestamps[slot] = timestampMs;
    this.totalWritten = absRow + 1;
    this.writeRow = this.totalWritten % this.rowCount;
    return true;
  }

  /** Absolute index of the oldest row still retained. Rises with every push once the ring is full. */
  oldestAbs(): number {
    return Math.max(this.validStart, this.totalWritten - this.rowCount);
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

  private fillGap(from: number, to: number) {
    const first = Math.max(from, to - this.rowCount);
    for (let abs = first; abs < to; abs++) {
      const slot = abs % this.rowCount;
      this.data.fill(this.emptyFill, slot * this.binCount, (slot + 1) * this.binCount);
      this.timestamps[slot] = 0;
    }
  }
}
