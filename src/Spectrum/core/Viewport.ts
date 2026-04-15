export class Viewport {
  start: number = 0;
  end: number = 1;

  private readonly binCount: number;
  private canvas: HTMLCanvasElement;
  private readonly minBinWidthPx: number;
  private readonly resetStart: number;
  private readonly resetEnd: number;

  constructor(binCount: number, canvas: HTMLCanvasElement, minBinWidthPx = 12, resetStart = 0, resetEnd = 1) {
    this.binCount = binCount;
    this.canvas = canvas;
    this.minBinWidthPx = minBinWidthPx;
    this.resetStart = resetStart;
    this.resetEnd = resetEnd;
  }

  private minSpan(): number {
    return this.canvas.width / this.minBinWidthPx / this.binCount;
  }

  zoomAt(focusNorm: number, factor: number) {
    const span = this.end - this.start;
    const newSpan = Math.max(this.minSpan(), span * factor);
    const ratio = (focusNorm - this.start) / span;
    this.start = focusNorm - ratio * newSpan;
    this.end = this.start + newSpan;
    this.clamp();
  }

  panTo(start: number, end: number) {
    this.start = start;
    this.end = end;
    this.clamp();
  }

  reset() {
    this.start = this.resetStart;
    this.end = this.resetEnd;
    this.clamp();
  }

  private clamp() {
    const min = this.minSpan();
    const span = this.end - this.start;

    if (span < min) {
      const c = (this.start + this.end) / 2;
      this.start = c - min / 2;
      this.end = c + min / 2;
    }

    if (this.start < 0) {
      this.end -= this.start;
      this.start = 0;
    }
    if (this.end > 1) {
      this.start -= this.end - 1;
      this.end = 1;
    }
    this.start = Math.max(0, this.start);
    this.end = Math.min(1, this.end);
  }
}
