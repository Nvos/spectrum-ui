import { HISTORY_ROWS, POWER_NO_READING } from "./constants";
import { RingBuffer } from "./RingBuffer";
import type { InitialRows } from "./RingBuffer";

export type HistoryPageData = {
  header: { seqStart: number; rows: number; binCount: number };
  timestamps: number[];
  spectrum: Int8Array;
  annotations: Int8Array;
};

export type HistoryWindowRequest = {
  anchorRow: number;
  displayRows: number;
  following: boolean;
  interacting: boolean;
};

export class FrameBuffer {
  readonly spectrum: RingBuffer;
  readonly annotations: RingBuffer;
  onPush: (() => void) | null = null;
  onHistoryLoad: (() => void) | null = null;
  onHistoryWindowRequest: ((request: HistoryWindowRequest) => void) | null = null;
  historyLoading = false;
  historyGestureActive = false;

  /**
   * @param historyRows retained depth `N` — independent of how many rows the
   *        waterfall displays. Defaults to {@link HISTORY_ROWS}.
   */
  constructor(
    historyRows: number = HISTORY_ROWS,
    binCount: number = 0,
    initialSpectrum?: InitialRows,
    initialAnnotations?: InitialRows,
  ) {
    this.spectrum = new RingBuffer(historyRows, binCount, initialSpectrum, POWER_NO_READING);
    this.annotations = new RingBuffer(historyRows, binCount, initialAnnotations, POWER_NO_READING);
  }

  push(specRow: Int8Array, annRow: Int8Array, timestampMs: number) {
    this.spectrum.push(specRow, timestampMs);
    this.annotations.push(annRow, timestampMs);
    this.onPush?.();
  }

  /** Pushes a row in the backend's absolute sequence space. */
  pushAt(seq: number, specRow: Int8Array, annRow: Int8Array, timestampMs: number): boolean {
    const accepted = this.spectrum.pushAt(seq, specRow, timestampMs);
    this.annotations.pushAt(seq, annRow, timestampMs);
    if (accepted) this.onPush?.();
    return accepted;
  }

  configurePaging(pageRows: number, historyStart: number) {
    this.spectrum.configurePaging(pageRows, historyStart);
    this.annotations.configurePaging(pageRows, historyStart);
  }

  hasHistoryPage(pageIndex: number): boolean {
    return this.spectrum.hasPage(pageIndex) && this.annotations.hasPage(pageIndex);
  }

  hasCachedHistoryPage(pageIndex: number): boolean {
    return this.spectrum.hasCachedPage(pageIndex) && this.annotations.hasCachedPage(pageIndex);
  }

  loadHistoryPages(pages: HistoryPageData[]) {
    for (const page of pages) {
      if (page.header.binCount !== this.spectrum.binCount) {
        throw new Error("History page bin count does not match the active capture");
      }
      const common = {
        seqStart: page.header.seqStart,
        count: page.header.rows,
        timestamps: page.timestamps,
      };
      this.spectrum.loadPage({ ...common, rows: page.spectrum });
      this.annotations.loadPage({ ...common, rows: page.annotations });
    }
    this.onHistoryLoad?.();
  }

  requestHistoryWindow(request: HistoryWindowRequest) {
    this.onHistoryWindowRequest?.(request);
  }

  setHistoryLoading(loading: boolean) {
    if (this.historyLoading === loading) return;
    this.historyLoading = loading;
    this.onHistoryLoad?.();
  }

  setHistoryGestureActive(active: boolean) {
    this.historyGestureActive = active;
    this.onHistoryLoad?.();
  }
}
