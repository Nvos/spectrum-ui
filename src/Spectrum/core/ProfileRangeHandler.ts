import type { NormalizedRange } from "./ProfileTypes";
import type { Viewport } from "./Viewport";

const HANDLE_HIT_PX = 8;
const BODY_HIT_H = 14;

type DragState =
  | { type: "edge"; id: string; edge: "start" | "end"; otherEdge: number }
  | { type: "body"; id: string; span: number; anchorNorm: number; anchorStart: number };

export class ProfileRangeHandler {
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
        best = { type: "edge", id: r.id, edge: "start", otherEdge: r.end };
      }
      if (dEnd < bestDist) {
        bestDist = dEnd;
        best = { type: "edge", id: r.id, edge: "end", otherEdge: r.start };
      }
    }

    return best;
  }

  private findBody(clientX: number, clientY: number): DragState | null {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    if (mouseY < 0 || mouseY > BODY_HIT_H) return null;

    const { start, end } = this.viewport;
    const span = end - start;

    for (const r of this.ranges) {
      const xL = ((r.start - start) / span) * rect.width;
      const xR = ((r.end - start) / span) * rect.width;
      if (mouseX >= xL + HANDLE_HIT_PX && mouseX <= xR - HANDLE_HIT_PX) {
        return {
          type: "body",
          id: r.id,
          span: r.end - r.start,
          anchorNorm: this.normFromClientX(clientX),
          anchorStart: r.start,
        };
      }
    }

    return null;
  }

  private onMouseMove = (e: MouseEvent) => {
    if (this.drag) return;
    const edge = this.findEdge(e.clientX);
    if (edge) {
      this.canvas.style.cursor = "ew-resize";
      return;
    }
    this.canvas.style.cursor = this.findBody(e.clientX, e.clientY) ? "grab" : "";
  };

  private onMouseDown = (e: MouseEvent) => {
    const hit = this.findEdge(e.clientX) ?? this.findBody(e.clientX, e.clientY);
    if (!hit) return;
    e.stopImmediatePropagation();
    this.drag = hit;
  };

  private onWindowMouseMove = (e: MouseEvent) => {
    if (!this.drag) return;

    if (this.drag.type === "edge") {
      const { id, edge, otherEdge } = this.drag;
      const norm = Math.max(0, Math.min(1, this.normFromClientX(e.clientX)));
      const newStart = edge === "start" ? Math.min(norm, otherEdge) : otherEdge;
      const newEnd = edge === "end" ? Math.max(norm, otherEdge) : otherEdge;
      this.onRangeChange(id, newStart, newEnd);
    } else {
      const { id, span, anchorNorm, anchorStart } = this.drag;
      const delta = this.normFromClientX(e.clientX) - anchorNorm;
      let newStart = anchorStart + delta;
      let newEnd = newStart + span;
      if (newStart < 0) { newStart = 0; newEnd = span; }
      if (newEnd > 1) { newEnd = 1; newStart = 1 - span; }
      this.onRangeChange(id, newStart, newEnd);
    }
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
