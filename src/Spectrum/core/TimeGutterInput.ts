import type { TimeCursor } from "./TimeCursor";
import {
  applyHistoryKey,
  DRAG_DEAD_ZONE_PX,
  DRAG_ROWS_PER_PX,
  wheelScrollStep,
} from "./historyInput";

type GestureHooks = {
  onUpdate: () => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
};

/**
 * History scrolling on the time gutter.
 *
 * The gutter is the whole left column — full pane height and the full gutter
 * width — so there is no small control to acquire. That is the point: a 10px
 * scrollbar with a thumb only a few pixels tall is a hostile target on a
 * touchpad, and worse on handheld field hardware. Here any pixel of the column
 * works, and the column is the timeline the user is already reading.
 *
 * Three equivalent paths, no modifier keys on any of them:
 *
 * - **Wheel** — plain, because the gutter is not the frequency-zoom surface.
 *   Two-finger scroll over the time column just scrolls time. The waterfall
 *   canvas keeps plain wheel for frequency zoom, untouched.
 * - **Drag** — 1 row per pixel, matching the waterfall exactly, so the content
 *   moves with the pointer.
 * - **Keyboard** — arrows / page / Home / End via the shared map in
 *   {@link applyHistoryKey}.
 */
export class TimeGutterInput {
  private el: HTMLElement;
  private timeCursor: TimeCursor;
  private hooks: GestureHooks;

  private pointerId: number | null = null;
  private lastY = 0;
  /** Drag distance accumulated while still inside the dead zone. */
  private pending = 0;
  private armed = false;
  /**
   * Sub-row remainder carried between moves.
   *
   * Touchpads report fractional `clientY`, so a slow drag can deliver 0.4px per
   * event. Rounding each event independently would floor every one of those to
   * zero and the drag would simply not move — the failure would look like the
   * control ignoring small gestures, which is the opposite of the point here.
   */
  private residual = 0;

  constructor(el: HTMLElement, timeCursor: TimeCursor, hooks: GestureHooks) {
    this.el = el;
    this.timeCursor = timeCursor;
    this.hooks = hooks;

    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
    el.addEventListener("keydown", this.onKeyDown);

    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    el.setAttribute("role", "slider");
    el.setAttribute("aria-label", "History position");
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", "100");
  }

  /**
   * Mirror the published history position onto the gutter's ARIA state.
   *
   * The gutter is the slider now, so the values have to follow it rather than
   * the scrollbar, which no longer takes input.
   */
  setAriaPosition(valueNow: number, valueText: string) {
    this.el.setAttribute("aria-valuenow", String(valueNow));
    this.el.setAttribute("aria-valuetext", valueText);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const step = wheelScrollStep(this.timeCursor);
    // Wheel down reveals older rows, which live below the anchor.
    this.timeCursor.scrollByRows(e.deltaY > 0 ? -step : step);
    // A wheel gesture focuses nothing, so Home would be dead right after the
    // gesture that put the user into history.
    this.el.focus({ preventScroll: true });
    this.hooks.onUpdate();
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.lastY = e.clientY;
    this.pending = 0;
    this.residual = 0;
    this.armed = false;
    this.el.setPointerCapture(e.pointerId);
    this.el.focus({ preventScroll: true });
    this.hooks.onGestureStart?.();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.pointerId !== e.pointerId) return;
    const dy = e.clientY - this.lastY;
    this.lastY = e.clientY;

    if (!this.armed) {
      this.pending += dy;
      if (Math.abs(this.pending) < DRAG_DEAD_ZONE_PX) return;
      // Arm on the whole accumulated distance so the view does not jump: the
      // dead zone suppresses the gesture, it does not discard it.
      this.armed = true;
      this.residual = this.pending * DRAG_ROWS_PER_PX;
      this.pending = 0;
    } else {
      this.residual += dy * DRAG_ROWS_PER_PX;
    }

    // Content follows the pointer: dragging down carries the visible rows down,
    // which walks the anchor toward newer data, and dragging up reveals the
    // older rows sitting below the window.
    const rows = Math.trunc(this.residual);
    if (rows === 0) return;
    this.residual -= rows;
    this.timeCursor.scrollByRows(rows);
    this.hooks.onUpdate();
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.pointerId !== e.pointerId) return;
    if (this.el.hasPointerCapture(e.pointerId)) {
      this.el.releasePointerCapture(e.pointerId);
    }
    this.pointerId = null;
    this.armed = false;
    this.pending = 0;
    this.hooks.onGestureEnd?.();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!applyHistoryKey(this.timeCursor, e)) return;
    e.preventDefault();
    this.hooks.onUpdate();
  };

  destroy() {
    this.el.removeEventListener("wheel", this.onWheel);
    this.el.removeEventListener("pointerdown", this.onPointerDown);
    this.el.removeEventListener("pointermove", this.onPointerMove);
    this.el.removeEventListener("pointerup", this.onPointerUp);
    this.el.removeEventListener("pointercancel", this.onPointerUp);
    this.el.removeEventListener("keydown", this.onKeyDown);
  }
}
