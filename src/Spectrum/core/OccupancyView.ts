import { resizeCanvasToDisplaySize } from "twgl.js";
import { SCROLLED_OVERLAY_ALPHA } from "./overlayDimming";
import type { TimeCursor } from "./TimeCursor";
import type { Viewport } from "./Viewport";

export class OccupancyView {
  private readonly data: Float32Array;
  private readonly binCount: number;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private viewport: Viewport | null = null;
  private timeCursor: TimeCursor | null = null;

  constructor(data: Float32Array, binCount: number) {
    this.data = data;
    this.binCount = binCount;
  }

  mount(canvas: HTMLCanvasElement, viewport: Viewport, timeCursor: TimeCursor) {
    this.timeCursor = timeCursor;
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context not available");
    this.ctx = ctx;
    this.viewport = viewport;
  }

  render() {
    const { canvas, ctx, viewport, data, binCount } = this;
    if (!canvas || !ctx || !viewport) return;

    resizeCanvasToDisplaySize(canvas, window.devicePixelRatio || 1);
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const { start, end } = viewport;
    const visibleSpan = end - start;
    const binStart = Math.floor(start * binCount);
    const binEnd = Math.ceil(end * binCount);
    const binWidth = Math.max(1, width / (binCount * visibleSpan));

    ctx.globalAlpha = this.timeCursor?.follow === false ? SCROLLED_OVERLAY_ALPHA : 1;

    for (let b = binStart; b <= binEnd; b++) {
      const occ = data[Math.min(b, binCount - 1)];
      if (occ <= 0) continue;
      const x = ((b / binCount - start) / visibleSpan) * width;
      ctx.fillStyle = `rgba(74, 222, 128, ${occ.toFixed(3)})`;
      ctx.fillRect(x, 0, binWidth + 0.5, height);
    }
    ctx.globalAlpha = 1;
  }

  destroy() {
    this.canvas = null;
    this.ctx = null;
    this.viewport = null;
    this.timeCursor = null;
  }
}
