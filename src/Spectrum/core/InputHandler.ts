import type { TimeCursor } from "./TimeCursor";
import type { Viewport } from "./Viewport";
import { applyHistoryKey, wheelScrollStep } from "./historyInput";

export class InputHandler {
  private canvas: HTMLCanvasElement;
  private viewport: Viewport;
  private readonly onUpdate: () => void;
  private readonly timeCursor: TimeCursor | null;
  private panStart: { x: number; viewStart: number; viewEnd: number } | null =
    null;

  /**
   * @param timeCursor when supplied, this surface also handles history
   *        scrolling: `shift`+wheel, `PageUp`/`PageDown`, `Home`/`End`.
   */
  constructor(
    canvas: HTMLCanvasElement,
    viewport: Viewport,
    onUpdate: () => void,
    timeCursor?: TimeCursor,
  ) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.onUpdate = onUpdate;
    this.timeCursor = timeCursor ?? null;

    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("dblclick", this.onDblClick);

    if (this.timeCursor) {
      // Keyboard reachability for the scroll gesture. Canvases are not
      // focusable by default.
      if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;
      canvas.addEventListener("keydown", this.onKeyDown);
    }
  }

  private toNorm(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    return (clientX - rect.left) / rect.width;
  }

  private canvasNormToViewNorm(canvasNorm: number): number {
    return (
      this.viewport.start +
      canvasNorm * (this.viewport.end - this.viewport.start)
    );
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();

    // shift+wheel scrolls time. Plain wheel stays frequency zoom — that is the
    // primary interaction and must not regress. shift is preferred over ctrl
    // (browser page zoom, macOS trackpad pinch synthesises ctrl+wheel) and over
    // alt (claimed by some Linux window managers). preventDefault above already
    // suppresses shift+wheel's default horizontal scroll.
    if (this.timeCursor && e.shiftKey) {
      const step = wheelScrollStep(this.timeCursor);
      // Wheel down reveals older rows, which live below the anchor.
      this.timeCursor.scrollByRows(e.deltaY > 0 ? -step : step);
      // A wheel gesture does not focus anything, so Home/PageUp would be dead
      // right after the gesture that put the user into history. Take focus on
      // the time-scroll path only, leaving plain frequency zoom alone.
      this.canvas.focus({ preventScroll: true });
      this.onUpdate();
      return;
    }

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

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.timeCursor || !applyHistoryKey(this.timeCursor, e)) return;
    e.preventDefault();
    this.onUpdate();
  };

  private onMouseDown = (e: MouseEvent) => {
    this.panStart = {
      x: e.clientX,
      viewStart: this.viewport.start,
      viewEnd: this.viewport.end,
    };
  };

  // Deliberately reads clientX only. Vertical drag is NOT bound to time scroll:
  // an imprecise horizontal pan would drift vertically and silently drop the
  // view out of follow mode, which reads as "the display froze".
  private onMouseMove = (e: MouseEvent) => {
    if (!this.panStart) return;
    const rect = this.canvas.getBoundingClientRect();
    const span = this.panStart.viewEnd - this.panStart.viewStart;
    const deltaNorm = -((e.clientX - this.panStart.x) / rect.width) * span;
    this.viewport.panTo(
      this.panStart.viewStart + deltaNorm,
      this.panStart.viewEnd + deltaNorm,
    );
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
    this.canvas.removeEventListener("keydown", this.onKeyDown);
  }
}
