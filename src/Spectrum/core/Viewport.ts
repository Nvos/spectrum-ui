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

  // When minSpan exceeds the valid range (subview too narrow relative to canvas),
  // clamp it to allow interaction rather than locking the viewport solid.
  private effectiveMinSpan(): number {
    const minS = this.minSpan();
    const maxS = this.resetEnd - this.resetStart;
    if (minS <= maxS) return minS;
    // Allow ~10x zoom-in from full subview view, floored at 1 bin width.
    return Math.max(1 / this.binCount, maxS / 10);
  }

  zoomAt(focusNorm: number, factor: number) {
    const span = this.end - this.start;
    const maxSpan = this.resetEnd - this.resetStart;
    const newSpan = Math.min(maxSpan, Math.max(this.effectiveMinSpan(), span * factor));
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
    const min = this.effectiveMinSpan();
    const span = this.end - this.start;

    if (span < min) {
      const c = (this.start + this.end) / 2;
      this.start = c - min / 2;
      this.end = c + min / 2;
    }

    if (this.start < this.resetStart) {
      this.end += this.resetStart - this.start;
      this.start = this.resetStart;
    }
    if (this.end > this.resetEnd) {
      this.start -= this.end - this.resetEnd;
      this.end = this.resetEnd;
    }
    this.start = Math.max(this.resetStart, this.start);
    this.end = Math.min(this.resetEnd, this.end);
  }
}
