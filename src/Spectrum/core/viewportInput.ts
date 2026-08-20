import type { Viewport } from "./Viewport";

/**
 * Pan step as a fraction of the *visible* span, so a keypress moves the same
 * apparent distance at every zoom level rather than the same absolute
 * frequency. At ~30/s key repeat the normal step crosses a screen in about
 * three quarters of a second, which is controllable rather than twitchy.
 */
const PAN_FRACTION = 0.05;
const PAN_FRACTION_FAST = 0.25;

/**
 * Matches the wheel's notch (`1.15` / `0.87` in `InputHandler`) so the keyboard
 * and the wheel feel like the same control.
 *
 * There is deliberately no fast zoom. On a US layout `+` *is* `shift`+`=`, so a
 * shift-for-faster modifier would collide with the zoom-in key itself — and
 * zoom is already geometric, so holding the key accelerates on its own.
 */
const ZOOM_IN = 0.87;
const ZOOM_OUT = 1.15;

/**
 * Frequency traversal keys, shared by every pane that owns a `Viewport`.
 *
 * Bindings follow the two conventions users are most likely to arrive with:
 *
 * - **Arrows + `+`/`-`/`0`** — the plotting and mapping convention. Left/Right
 *   are free here because the vertical arrows already drive time
 *   (`applyHistoryKey`), so the axes split cleanly across the two pairs.
 * - **`WASD`** — the flamegraph/timeline convention (Chrome DevTools, Firefox
 *   profiler, speedscope) for exactly this kind of pan-and-zoom surface. Worth
 *   keeping for field use: it drives the whole view one-handed, without
 *   reaching for the arrow cluster. Delete the four cases to drop it.
 *
 * `shift` is the faster-movement modifier on pan. Returns true if handled.
 */
export const applyViewportKey = (viewport: Viewport, e: KeyboardEvent): boolean => {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;

  const span = viewport.end - viewport.start;
  const center = (viewport.start + viewport.end) / 2;
  const step = span * (e.shiftKey ? PAN_FRACTION_FAST : PAN_FRACTION);
  const pan = (delta: number) => viewport.panTo(viewport.start + delta, viewport.end + delta);

  switch (e.key) {
    case "ArrowLeft":
    case "a":
    case "A":
      pan(-step);
      return true;
    case "ArrowRight":
    case "d":
    case "D":
      pan(step);
      return true;
    case "+":
    case "=":
    case "w":
    case "W":
      viewport.zoomAt(center, ZOOM_IN);
      return true;
    case "-":
    case "_":
    case "s":
    case "S":
      viewport.zoomAt(center, ZOOM_OUT);
      return true;
    case "0":
      viewport.reset();
      return true;
    default:
      return false;
  }
};
