import { fetchHistoryPages } from "./api";
import type { CaptureMetadata, HistoryPage } from "./api";
import type { FrameBuffer, HistoryWindowRequest } from "./Spectrum/core/FrameBuffer";

const SETTLE_MS = 140;
const PREFETCH_PAGES = 1;
const MAX_BATCH_PAGES = 8;

/**
 * Converts history-window requests from SpectrumCore into settled, aligned
 * page fetches. Requests are cancelled and replaced while the user scrolls, so
 * a scrollbar drag fetches only where it lands.
 */
export class HistoryPager {
  private readonly frameBuffer: FrameBuffer;
  private readonly capture: CaptureMetadata;
  private readonly onError: (error: unknown) => void;
  private readonly fetchPages: typeof fetchHistoryPages;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private requestKey = "";
  private generation = 0;

  constructor(
    frameBuffer: FrameBuffer,
    capture: CaptureMetadata,
    onError: (error: unknown) => void,
    fetchPages: typeof fetchHistoryPages = fetchHistoryPages,
  ) {
    this.frameBuffer = frameBuffer;
    this.capture = capture;
    this.onError = onError;
    this.fetchPages = fetchPages;
    frameBuffer.onHistoryWindowRequest = this.request;
  }

  dispose() {
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.controller?.abort();
    this.frameBuffer.onHistoryWindowRequest = null;
    this.frameBuffer.setHistoryLoading(false);
  }

  private request = (window: HistoryWindowRequest) => {
    if (window.interacting) {
      this.cancelPending();
      this.requestKey = "";
      this.frameBuffer.setHistoryLoading(false);
      return;
    }

    const pageRows = this.capture.pageRows;
    const seqEnd = this.frameBuffer.spectrum.totalWritten;
    const completePageEnd = Math.floor(seqEnd / pageRows);
    const visibleBottom = Math.max(this.capture.seqStart, window.anchorRow - window.displayRows + 1);
    if (window.following && visibleBottom >= this.frameBuffer.spectrum.residentOldestAbs()) {
      this.cancelPending();
      this.requestKey = "live";
      this.frameBuffer.setHistoryLoading(false);
      return;
    }
    const visibleFirst = Math.floor(visibleBottom / pageRows);
    const visibleLast = Math.min(completePageEnd - 1, Math.floor(window.anchorRow / pageRows));
    const first = Math.max(Math.ceil(this.capture.seqStart / pageRows), visibleFirst - PREFETCH_PAGES);
    const last = Math.min(completePageEnd - 1, visibleLast + PREFETCH_PAGES);
    // Pin completed pages in the page cache even when they are still readable
    // from the live ring. Otherwise a paused page disappears the instant the
    // rolling ring overwrites its first row and has to be fetched reactively.
    const missing = this.uncachedPages(first, last);
    // The range alone is not a sufficient dedupe key. A page near the live
    // boundary can age out of the rolling ring while the paused window stays
    // fixed; its index then becomes missing without `first:last` changing.
    const key = `${first}:${last}|${missing.join(",")}`;
    const visibleMissing = this.missingPages(visibleFirst, visibleLast).length > 0;
    this.frameBuffer.setHistoryLoading(visibleMissing);
    if (key === this.requestKey) return;
    this.requestKey = key;
    this.cancelPending();

    if (missing.length === 0) {
      this.frameBuffer.setHistoryLoading(false);
      return;
    }
    const generation = ++this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.fetchMissing(missing, generation);
    }, SETTLE_MS);
  };

  private async fetchMissing(missing: number[], generation: number) {
    const controller = new AbortController();
    this.controller = controller;
    const loadedPages: HistoryPage[] = [];
    try {
      for (const batch of contiguousBatches(missing)) {
        const pages = await this.fetchPages(
          this.capture,
          batch.from,
          batch.count,
          controller.signal,
        );
        if (generation !== this.generation) return;
        loadedPages.push(...pages);
      }
      if (generation === this.generation) {
        this.frameBuffer.loadHistoryPages(loadedPages);
        this.frameBuffer.setHistoryLoading(false);
      }
    } catch (error) {
      if (controller.signal.aborted || generation !== this.generation) return;
      this.requestKey = "";
      this.frameBuffer.setHistoryLoading(false);
      this.onError(error);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  private missingPages(first: number, last: number): number[] {
    if (last < first) return [];
    const result: number[] = [];
    for (let page = first; page <= last; page++) {
      if (!this.frameBuffer.hasHistoryPage(page)) result.push(page);
    }
    return result;
  }

  private uncachedPages(first: number, last: number): number[] {
    if (last < first) return [];
    const result: number[] = [];
    for (let page = first; page <= last; page++) {
      if (!this.frameBuffer.hasCachedHistoryPage(page)) result.push(page);
    }
    return result;
  }

  private cancelPending() {
    this.generation++;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.controller?.abort();
    this.controller = null;
  }
}

const contiguousBatches = (pages: number[]): { from: number; count: number }[] => {
  const batches: { from: number; count: number }[] = [];
  for (const page of pages) {
    const current = batches[batches.length - 1];
    if (current && page === current.from + current.count && current.count < MAX_BATCH_PAGES) {
      current.count++;
    } else {
      batches.push({ from: page, count: 1 });
    }
  }
  return batches;
};
