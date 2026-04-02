import { POWER_NO_READING } from "./constants";
import { RingBuffer } from "./RingBuffer";
import type { InitialRows } from "./RingBuffer";

export class FrameBuffer {
  readonly spectrum: RingBuffer;
  readonly annotations: RingBuffer;

  constructor(
    rowCount: number,
    binCount: number,
    initialSpectrum?: InitialRows,
    initialAnnotations?: InitialRows,
  ) {
    this.spectrum = new RingBuffer(rowCount, binCount, initialSpectrum, POWER_NO_READING);
    this.annotations = new RingBuffer(rowCount, binCount, initialAnnotations, POWER_NO_READING);
  }

  push(specRow: Int8Array, annRow: Int8Array, timestampMs: number) {
    this.spectrum.push(specRow, timestampMs);
    this.annotations.push(annRow, timestampMs);
  }
}
