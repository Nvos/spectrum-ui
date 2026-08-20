import { style } from "@vanilla-extract/css";
import { gutterWidthVar } from "../core/styles.css";
import { font } from "../tokens";

// `HH:MM:SS` at 10px mono is ~48px, plus a 6px tick and 2px of padding — 56px
// of content with nothing to spare. A little over that keeps the label off the
// edge and keeps the waterfall gutter a comfortable drag target, since it is
// the primary history control and is aimed at a touchpad in the field rather
// than a mouse at a desk. Shared by every left gutter so the panes stay
// aligned, so width taken here is width taken from every pane.
const GUTTER = "4rem";

export const layout = style({
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  padding: "2rem",
});

/**
 * Total width the lane strip occupies, set from React on `layoutInner`.
 *
 * Lanes live in the waterfall row, but every row above it reserves the same
 * width on its right so the live trace, occupancy strip and frequency axis keep
 * lining up with the main waterfall as lanes narrow it. Lanes spend the
 * waterfall's width; they never desynchronise the frequency axis.
 */
export const laneTotalWidthProperty = "--lane-total-width";

export const layoutInner = style({
  height: "100%",
  display: "flex",
  flexDirection: "column",
  vars: { [gutterWidthVar]: GUTTER, [laneTotalWidthProperty]: "0px" },
});

// Right-hand reservation matching the lane strip, for the rows that share the
// waterfall's frequency axis. Zero-width when there are no lanes.
export const laneSpacer = style({
  width: `var(${laneTotalWidthProperty}, 0px)`,
  flexShrink: 0,
});

// Live row
export const liveRow = style({
  display: "flex",
  height: "8rem",
  minHeight: 0,
  flexShrink: 0,
  marginTop: "0.5rem",
});

export const liveCanvasWrapper = style({
  flex: 1,
  position: "relative",
  minHeight: 0,
  minWidth: 0,
});

export const liveCanvas = style({
  display: "block",
  width: "100%",
  height: "100%",
  border: `1px solid rgba(255,255,255,0.1)`,
});

export const gridOverlay = style({
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  overflow: "hidden",
});

// Occupancy row
export const occupancyRow = style({
  display: "flex",
  height: "0.75rem",
  flexShrink: 0,
});

export const occupancyRowSpacer = style({
  width: GUTTER,
  flexShrink: 0,
  borderRight: `1px solid rgba(255,255,255,0.1)`,
});

export const occupancyCanvas = style({
  flex: 1,
  display: "block",
  minHeight: 0,
  minWidth: 0,
});

// Band row
export const bandRow = style({
  display: "flex",
  flexShrink: 0,
});

export const bandRowSpacer = style({
  width: GUTTER,
  flexShrink: 0,
  borderRight: `1px solid rgba(255,255,255,0.1)`,
});

export const bandContainer = style({
  position: "relative",
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
});

// Freq axis row
export const freqAxisRow = style({
  display: "flex",
  height: "2rem",
  flexShrink: 0,
});

export const freqAxisLeft = style({
  width: GUTTER,
  flexShrink: 0,
  borderRight: `1px solid rgba(255,255,255,0.1)`,
});

export const freqAxisContainer = style({
  position: "relative",
  flex: 1,
  borderTop: `1px solid rgba(255,255,255,0.1)`,
  borderBottom: `1px solid rgba(255,255,255,0.1)`,
});

export const freqAxisRight = style({
  width: "2.5rem",
  flexShrink: 0,
});

// Waterfall row
export const waterfallRow = style({
  display: "flex",
  flex: 1,
  minHeight: 0,
});

// The full-height history scroll surface. Any pixel of the column scrolls
// time — by wheel, drag, or keyboard — so there is no thumb to acquire.
export const timeLabels = style({
  position: "relative",
  width: GUTTER,
  flexShrink: 0,
  overflow: "hidden",
  cursor: "grab",
  touchAction: "none",
  userSelect: "none",
  selectors: {
    "&:active": { cursor: "grabbing" },
    "&:hover": { backgroundColor: "rgba(255,255,255,0.03)" },
    "&:focus-visible": { outline: `1px solid rgba(255,255,255,0.5)`, outlineOffset: "-1px" },
  },
});

export const waterfallCanvasContainer = style({
  position: "relative",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
});

export const waterfallCanvas = style({
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
});

export const annotationCanvas = style({
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  pointerEvents: "none",
});

// --- Frequency lanes ---

// A lane is a narrow, full-height column sharing the main view's time axis.
// `flexShrink: 0` against a `flex: 1` waterfall is what makes the waterfall,
// not the page, pay for lane width. The total is capped in the resize handler
// as well as here -- an uncapped secondary surface is exactly how the old
// subview row crowded out the primary instrument.
export const lane = style({
  position: "relative",
  flexShrink: 0,
  minWidth: 0,
  borderLeft: `1px solid rgba(255,255,255,0.12)`,
});

// Empty box the lane's canvas is created inside. React renders it and never
// puts children in it; LaneCore owns everything below this node.
export const laneCanvasHost = style({
  position: "absolute",
  inset: 0,
});

/**
 * The lane label is an absolute overlay and MUST stay one.
 *
 * A header in normal flow -- even 1.25rem of it -- makes the lane canvas
 * shorter than the main waterfall, so the same `D` maps to a different pixel
 * height and rows silently stop lining up between columns, worst while scrolled
 * back. This looks like a cosmetic choice and is not.
 */
export const laneLabel = style({
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 2,
  padding: "0.2rem 0.3rem",
  fontFamily: font.mono,
  fontSize: "9px",
  lineHeight: 1.5,
  pointerEvents: "none",
  background: "linear-gradient(to bottom, rgba(10,10,10,0.82), rgba(10,10,10,0))",
});

export const laneLabelLine = style({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

export const laneLabelName = style([laneLabelLine, { color: "rgba(255,255,255,0.9)" }]);
export const laneLabelRange = style([laneLabelLine, { color: "rgba(255,255,255,0.55)" }]);

// Bin count, so a lane's real resolution is legible. A range spanning a handful
// of bins across 96px is blocky; that is honest, not a defect to interpolate.
export const laneLabelBins = style([laneLabelLine, { color: "rgba(255,255,255,0.35)" }]);

// On the lane's own left edge, so dragging it trades width directly with the
// main waterfall (or the lane to its left) with nothing in between.
export const laneResizeHandle = style({
  position: "absolute",
  top: 0,
  bottom: 0,
  left: 0,
  width: "6px",
  zIndex: 3,
  cursor: "col-resize",
  touchAction: "none",
  selectors: {
    "&:hover": { background: "rgba(255,255,255,0.12)" },
    "&:active": { background: "rgba(255,255,255,0.2)" },
  },
});

// Shared spacer used in live and occupancy rows
export const spacerW10 = style({
  width: "2.5rem",
  flexShrink: 0,
});

// --- History scroll controls (overlaid on the waterfall) ---

// Passive position rail. It takes no input — the gutter does — but it is the
// one thing the gutter cannot express: where this window sits in the whole
// retained session, readable at a glance instead of by comparing clock times.
export const historyScrollbar = style({
  position: "absolute",
  top: 0,
  bottom: 0,
  right: 0,
  width: "0.25rem",
  backgroundColor: "rgba(0,0,0,0.35)",
  pointerEvents: "none",
});

export const historyScrollbarThumb = style({
  position: "absolute",
  left: 0,
  right: 0,
  minHeight: "0.5rem",
  borderRadius: "0.125rem",
  backgroundColor: "rgba(255,255,255,0.32)",
  pointerEvents: "none",
});

export const historyScrollbarThumbPaused = style({
  backgroundColor: "rgba(250, 190, 40, 0.75)",
});

export const historyIndicator = style({
  position: "absolute",
  top: "0.375rem",
  right: "0.75rem",
  zIndex: 2,
  display: "flex",
  alignItems: "center",
  gap: "0.35rem",
  padding: "0.15rem 0.45rem",
  fontFamily: font.mono,
  fontSize: "10px",
  lineHeight: 1.4,
  color: "rgba(255,255,255,0.85)",
  backgroundColor: "rgba(10,10,10,0.8)",
  border: `1px solid rgba(255,255,255,0.12)`,
  borderRadius: "0.25rem",
  cursor: "pointer",
  whiteSpace: "nowrap",
});

export const historyIndicatorLive = style({
  color: "rgba(74, 222, 128, 0.95)",
});

export const historyIndicatorPaused = style({
  color: "rgba(250, 190, 40, 0.95)",
});

// Marks the oldest available edge of the backend session.
export const historyExpiringEdge = style({
  position: "absolute",
  left: 0,
  right: "0.25rem",
  bottom: 0,
  height: "2px",
  backgroundColor: "rgba(250, 190, 40, 0.65)",
  pointerEvents: "none",
});
