import type { Viewport } from "./Viewport";

export class InputHandler {
  private canvas: HTMLCanvasElement;
  private viewport: Viewport;
  private readonly onUpdate: () => void;
  private panStart: { x: number; viewStart: number; viewEnd: number } | null = null;

  constructor(canvas: HTMLCanvasElement, viewport: Viewport, onUpdate: () => void) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.onUpdate = onUpdate;

    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("dblclick", this.onDblClick);
  }

  private toNorm(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    return (clientX - rect.left) / rect.width;
  }

  private canvasNormToViewNorm(canvasNorm: number): number {
    return this.viewport.start + canvasNorm * (this.viewport.end - this.viewport.start);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // if dragging, update panStart to current state so delta stays coherent
    if (this.panStart) {
      this.panStart = {
        x: this.panStart.x,
        viewStart: this.viewport.start,
        viewEnd: this.viewport.end,
      };
    }
    const focusNorm = this.canvasNormToViewNorm(this.toNorm(e.clientX));
    this.viewport.zoomAt(focusNorm, e.deltaY > 0 ? 1.15 : 0.87);
    this.onUpdate();
  };

  private onMouseDown = (e: MouseEvent) => {
    this.panStart = {
      x: e.clientX,
      viewStart: this.viewport.start,
      viewEnd: this.viewport.end,
    };
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.panStart) return;
    const rect = this.canvas.getBoundingClientRect();
    const span = this.panStart.viewEnd - this.panStart.viewStart;
    const deltaNorm = -((e.clientX - this.panStart.x) / rect.width) * span;
    this.viewport.panTo(this.panStart.viewStart + deltaNorm, this.panStart.viewEnd + deltaNorm);
    this.onUpdate();
  };

  private onMouseUp = () => {
    this.panStart = null;
  };

  private onDblClick = () => {
    this.viewport.reset();
    this.onUpdate();
  };

  destroy() {
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("dblclick", this.onDblClick);
  }
}
