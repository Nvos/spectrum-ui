export type InitialRows = {
  rows: Int8Array;
  count: number;
  timestamps: number[];
  /** Backend-assigned sequence of the first row. Defaults to zero for local data. */
  seqStart?: number;
};

export type CachedPage = {
  seqStart: number;
  count: number;
  rows: Int8Array;
  timestamps: number[];
};

type PageEntry = {
  seqStart: number;
  count: number;
  rows: Int8Array;
  timestamps: Float64Array;
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
  private readonly blankRow: Int8Array;
  private pageRows = 0;
  private historyStart: number | null = null;
  private maxCachedPages = 0;
  private pages = new Map<number, PageEntry>();
  historyVersion = 0;

  constructor(rowCount: number, binCount: number, initial?: InitialRows, emptyFill = 0) {
    this.rowCount = rowCount;
    this.binCount = binCount;
    this.data = new Int8Array(rowCount * binCount).fill(emptyFill);
    this.timestamps = new Float64Array(rowCount);
    this.emptyFill = emptyFill;
    this.blankRow = new Int8Array(binCount).fill(emptyFill);

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
    if (this.historyStart !== null) return this.historyStart;
    return Math.max(this.validStart, this.totalWritten - this.rowCount);
  }

  /** Oldest row present in the live rolling ring, excluding fetched pages. */
  residentOldestAbs(totalWritten = this.totalWritten): number {
    return Math.max(this.validStart, totalWritten - this.rowCount);
  }

  isResidentAbs(absRow: number): boolean {
    return absRow >= this.residentOldestAbs() && absRow < this.totalWritten;
  }

  /**
   * The single predicate answering "is row R available?".
   * Phase 1: `R >= T - N`. Phase 2 replaces the body with a page-map lookup —
   * keep call sites on this, never an inline comparison.
   */
  hasAbs(absRow: number): boolean {
    if (absRow < this.oldestAbs() || absRow >= this.totalWritten) return false;
    return this.isResidentAbs(absRow) || this.pageAt(absRow) !== undefined;
  }

  /** Ring slot backing an absolute row. Only storage-aware code should need this. */
  slotOf(absRow: number): number {
    return absRow % this.rowCount;
  }

  rowViewAbs(absRow: number): Int8Array {
    if (!this.isResidentAbs(absRow)) {
      const page = this.pageAt(absRow);
      if (!page) return this.blankRow;
      const row = absRow - page.seqStart;
      return page.rows.subarray(row * this.binCount, (row + 1) * this.binCount);
    }
    const start = (absRow % this.rowCount) * this.binCount;
    return this.data.subarray(start, start + this.binCount);
  }

  /** Single-bin read, avoiding a subarray allocation on hover paths. */
  sampleAbs(absRow: number, bin: number): number {
    return this.rowViewAbs(absRow)[bin];
  }

  timestampAtAbs(absRow: number): number {
    if (!this.isResidentAbs(absRow)) {
      const page = this.pageAt(absRow);
      return page?.timestamps[absRow - page.seqStart] ?? 0;
    }
    return this.timestamps[absRow % this.rowCount];
  }

  configurePaging(pageRows: number, historyStart: number) {
    this.pageRows = pageRows;
    this.historyStart = historyStart;
    this.maxCachedPages = Math.max(16, Math.ceil(this.rowCount / pageRows));
    this.pages.clear();
    this.historyVersion++;
  }

  hasPage(pageIndex: number): boolean {
    if (this.pageRows <= 0) return false;
    const start = pageIndex * this.pageRows;
    const end = start + this.pageRows;
    if (start >= this.residentOldestAbs() && end <= this.totalWritten) return true;
    return this.pages.has(pageIndex);
  }

  hasCachedPage(pageIndex: number): boolean {
    return this.pages.has(pageIndex);
  }

  loadPage(page: CachedPage) {
    if (this.pageRows <= 0 || page.count !== this.pageRows) {
      throw new Error("History page shape does not match the configured page size");
    }
    const pageIndex = Math.floor(page.seqStart / this.pageRows);
    if (page.seqStart !== pageIndex * this.pageRows) {
      throw new Error("History page is not sequence-aligned");
    }
    this.pages.delete(pageIndex);
    this.pages.set(pageIndex, {
      seqStart: page.seqStart,
      count: page.count,
      rows: page.rows,
      timestamps: Float64Array.from(page.timestamps),
    });
    while (this.pages.size > this.maxCachedPages) {
      const oldestKey = this.pages.keys().next().value as number | undefined;
      if (oldestKey === undefined) break;
      this.pages.delete(oldestKey);
    }
    this.historyVersion++;
  }

  private fillGap(from: number, to: number) {
    const first = Math.max(from, to - this.rowCount);
    for (let abs = first; abs < to; abs++) {
      const slot = abs % this.rowCount;
      this.data.fill(this.emptyFill, slot * this.binCount, (slot + 1) * this.binCount);
      this.timestamps[slot] = 0;
    }
  }

  private pageAt(absRow: number): PageEntry | undefined {
    if (this.pageRows <= 0) return undefined;
    return this.pages.get(Math.floor(absRow / this.pageRows));
  }
}
