/**
 * Shared mutable time axis — the vertical counterpart to {@link Viewport}.
 *
 * Constructed once in `SpectrumCore.mount()` and handed to every renderer,
 * which reads it fresh on each `render()`. Nothing subscribes; nothing diffs.
 *
 * The anchor is an **absolute** row index (`totalWritten` space, never wraps).
 * That is what keeps a paused view frozen as new rows arrive: an offset-from-
 * newest anchor would slide backwards on every push.
 *
 * With local-only storage the oldest bound advances as the rolling ring wraps.
 * With backend paging it is the capture's stable `seqStart`, so a parked
 * historical window remains frozen for the lifetime of the session.
 */
export class TimeCursor {
  /** Stick to the newest row. Cleared by any scroll, restored by `scrollToLive()`. */
  follow = true;

  /** ABSOLUTE index of the newest visible row (top edge of the waterfall). */
  anchorRow = 0;

  /** `D` — displayed rows, i.e. waterfall canvas height in CSS pixels. */
  displayRows = 1;

  /** True while the anchor is pinned against the oldest available window. */
  atOldest = false;

  scrollByRows(n: number) {
    if (n === 0) return;
    this.follow = false;
    this.anchorRow += n;
  }

  scrollToAbs(absRow: number) {
    this.follow = false;
    this.anchorRow = absRow;
  }

  scrollToLive() {
    this.follow = true;
  }

  /** Park at the oldest retained row; clamp() resolves the exact index. */
  scrollToOldest() {
    this.follow = false;
    this.anchorRow = Number.MIN_SAFE_INTEGER;
  }

  setDisplayRows(d: number) {
    this.displayRows = Math.max(1, Math.round(d));
  }

  /**
   * Bound the anchor to `[oldestAbs + D - 1, totalWritten - 1]`, allowing blank
   * fill when fewer than `D` rows exist yet. Called at the top of every frame.
   */
  clamp(totalWritten: number, oldestAbs: number) {
    const newest = totalWritten - 1;

    if (!this.follow) {
      // Lower bound. When fewer than D rows exist the floor IS the newest row,
      // so the view fills from the top with blanks below rather than being
      // forced negative.
      const floor = Math.min(newest, oldestAbs + this.displayRows - 1);
      if (this.anchorRow <= floor) {
        this.anchorRow = floor;
        this.atOldest = floor < newest;
      } else {
        this.atOldest = false;
      }
    }

    // Following, or sitting at/past the write head — resume live.
    //
    // The second case also covers cold start: with fewer than D rows retained
    // the floor above equals `newest`, so there is nothing behind us to hold on
    // to. Staying "paused" there would drift at the ingest rate while claiming
    // to be frozen, which is the one state this must never present.
    if (this.follow || this.anchorRow >= newest) {
      this.follow = true;
      this.anchorRow = newest;
      this.atOldest = false;
    }
  }

  /** Rows between the current window and the oldest available window. */
  freezeBudget(oldestAbs: number): number {
    return Math.max(0, this.anchorRow - (oldestAbs + this.displayRows - 1));
  }
}
