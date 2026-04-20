import { resizeCanvasToDisplaySize } from "twgl.js";
import type { Viewport } from "./Viewport";

export class OccupancyRenderer {
  readonly data: Float32Array;
  threshold: number;
  private counts: Uint32Array;
  private total = 0;
  private readonly binCount: number;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private viewport!: Viewport;

  constructor(
    binCount: number,
    threshold: number,
    initial?: { counts: Uint32Array; total: number; threshold: number },
  ) {
    this.binCount = binCount;
    this.threshold = threshold;
    this.data = new Float32Array(binCount);
    this.counts = new Uint32Array(binCount);
    if (initial && initial.total > 0 && initial.threshold === threshold) {
      this.total = initial.total;
      this.counts.set(initial.counts);
      for (let b = 0; b < binCount; b++) {
        this.data[b] = this.counts[b] / this.total;
      }
    }
  }

  push(row: Int8Array) {
    this.total++;
    for (let b = 0; b < this.binCount; b++) {
      if (row[b] > this.threshold) this.counts[b]++;
      this.data[b] = this.counts[b] / this.total;
    }
  }

  mount(canvas: HTMLCanvasElement, viewport: Viewport) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context not available");
    this.ctx = ctx;
    this.viewport = viewport;
  }

  render = () => {
    const { canvas, ctx, viewport, data, binCount } = this;
    if (!canvas) return;

    resizeCanvasToDisplaySize(canvas, window.devicePixelRatio || 1);
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const { start, end } = viewport;
    const visibleSpan = end - start;
    const binStart = Math.floor(start * binCount);
    const binEnd = Math.ceil(end * binCount);
    const binWidth = Math.max(1, width / (binCount * visibleSpan));

    for (let b = binStart; b <= binEnd; b++) {
      const occ = data[Math.min(b, binCount - 1)];
      if (occ <= 0) continue;
      const x = ((b / binCount - start) / visibleSpan) * width;
      ctx.fillStyle = `rgba(74, 222, 128, ${occ.toFixed(3)})`;
      ctx.fillRect(x, 0, binWidth + 0.5, height);
    }
  };

  setThreshold(threshold: number) {
    this.threshold = threshold;
    this.reset();
  }

  reset() {
    this.counts.fill(0);
    this.total = 0;
    this.data.fill(0);
  }
}
