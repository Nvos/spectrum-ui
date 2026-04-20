import type { NormalizedRange } from "./ProfileTypes";
import type { Viewport } from "./Viewport";

const HANDLE_HIT_PX = 8;

type DragState = { id: string; edge: "start" | "end"; otherEdge: number };

export class ProfileDragHandler {
  private canvas: HTMLCanvasElement;
  private viewport: Viewport;
  private ranges: NormalizedRange[] = [];
  private onRangeChange: (id: string, start: number, end: number) => void;
  private drag: DragState | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    viewport: Viewport,
    onRangeChange: (id: string, start: number, end: number) => void,
  ) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.onRangeChange = onRangeChange;
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onWindowMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
  }

  setRanges(ranges: NormalizedRange[]) {
    this.ranges = ranges;
  }

  private normFromClientX(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const t = (clientX - rect.left) / rect.width;
    const { start, end } = this.viewport;
    return start + t * (end - start);
  }

  private findEdge(clientX: number): DragState | null {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const { start, end } = this.viewport;
    const span = end - start;

    let best: DragState | null = null;
    let bestDist = HANDLE_HIT_PX + 1;

    for (const r of this.ranges) {
      const startX = ((r.start - start) / span) * rect.width;
      const endX = ((r.end - start) / span) * rect.width;

      const dStart = Math.abs(mouseX - startX);
      const dEnd = Math.abs(mouseX - endX);

      if (dStart < bestDist) {
        bestDist = dStart;
        best = { id: r.id, edge: "start", otherEdge: r.end };
      }
      if (dEnd < bestDist) {
        bestDist = dEnd;
        best = { id: r.id, edge: "end", otherEdge: r.start };
      }
    }

    return best;
  }

  private onMouseMove = (e: MouseEvent) => {
    if (this.drag) return;
    this.canvas.style.cursor = this.findEdge(e.clientX) ? "ew-resize" : "";
  };

  private onMouseDown = (e: MouseEvent) => {
    const hit = this.findEdge(e.clientX);
    if (!hit) return;
    e.stopImmediatePropagation();
    this.drag = hit;
  };

  private onWindowMouseMove = (e: MouseEvent) => {
    if (!this.drag) return;
    const { id, edge, otherEdge } = this.drag;
    const norm = Math.max(0, Math.min(1, this.normFromClientX(e.clientX)));
    const newStart = edge === "start" ? Math.min(norm, otherEdge) : otherEdge;
    const newEnd = edge === "end" ? Math.max(norm, otherEdge) : otherEdge;
    this.onRangeChange(id, newStart, newEnd);
  };

  private onMouseUp = () => {
    if (!this.drag) return;
    this.drag = null;
    this.canvas.style.cursor = "";
  };

  destroy() {
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onWindowMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
  }
}
