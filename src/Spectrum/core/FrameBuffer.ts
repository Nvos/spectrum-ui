import { HISTORY_ROWS, POWER_NO_READING } from "./constants";
import { RingBuffer } from "./RingBuffer";
import type { InitialRows } from "./RingBuffer";

export class FrameBuffer {
  readonly spectrum: RingBuffer;
  readonly annotations: RingBuffer;
  onPush: (() => void) | null = null;

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
}
