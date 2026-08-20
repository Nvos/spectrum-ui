import type { TimeCursor } from "./TimeCursor";

/** Fraction of a screen moved per wheel notch when time-scrolling. */
export const WHEEL_SCROLL_FRACTION = 0.15;

/** Rows moved per CSS pixel of drag. 1:1 with the waterfall's own row/px
 *  mapping, so history tracks the pointer exactly and there is no gain factor
 *  to reason about. */
export const DRAG_ROWS_PER_PX = 1;

/**
 * Pixels of slop before a drag leaves follow mode.
 *
 * Field hardware is handheld: vibration or a gloved touchpad turns an intended
 * click into a 2px drag. Without a dead zone that silently drops the view out
 * of live, which reads as "the display froze" — the exact failure mode that got
 * waterfall drag rejected in the first place.
 */
export const DRAG_DEAD_ZONE_PX = 4;

/** One wheel notch of time scroll, sized to the current window. */
export const wheelScrollStep = (tc: TimeCursor): number =>
  Math.max(1, Math.round(tc.displayRows * WHEEL_SCROLL_FRACTION));

/**
 * The single history key map, shared by every surface that accepts one.
 *
 * Newest rows are at the top of the waterfall, so every "up" key moves toward
 * newer and every "down" key toward older. Returns true if the key was handled,
 * in which case the caller preventDefaults and re-renders.
 *
 * This lives in one place deliberately: the canvas and the gutter previously
 * carried separate copies and had drifted into disagreeing about PageUp /
 * PageDown, so the same key scrolled opposite directions depending on which
 * element happened to hold focus.
 */
export const applyHistoryKey = (tc: TimeCursor, e: KeyboardEvent): boolean => {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const page = Math.max(1, tc.displayRows - 1);
  switch (e.key) {
    case "ArrowUp":
      tc.scrollByRows(1);
      return true;
    case "ArrowDown":
      tc.scrollByRows(-1);
      return true;
    case "PageUp":
      tc.scrollByRows(page);
      return true;
    case "PageDown":
      tc.scrollByRows(-page);
      return true;
    case "Home":
      tc.scrollToLive();
      return true;
    case "End":
      tc.scrollToOldest();
      return true;
    default:
      return false;
  }
};
