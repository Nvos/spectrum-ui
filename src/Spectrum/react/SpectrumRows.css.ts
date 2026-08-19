import { style } from "@vanilla-extract/css";
import { gutterWidthVar } from "../core/styles.css";
import { font } from "../tokens";

// Wide enough for an absolute HH:MM:SS time label in the waterfall gutter.
// Shared by every left gutter in the layout so the panes stay aligned.
const GUTTER = "3.5rem";

export const layout = style({
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  padding: "2rem",
});

export const layoutInner = style({
  height: "100%",
  display: "flex",
  flexDirection: "column",
  vars: { [gutterWidthVar]: GUTTER },
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

export const timeLabels = style({
  position: "relative",
  width: GUTTER,
  flexShrink: 0,
  overflow: "hidden",
  pointerEvents: "none",
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

// Shared spacer used in live and occupancy rows
export const spacerW10 = style({
  width: "2.5rem",
  flexShrink: 0,
});

// --- History scroll controls (overlaid on the waterfall) ---

export const historyScrollbar = style({
  position: "absolute",
  top: 0,
  bottom: 0,
  right: 0,
  width: "0.625rem",
  backgroundColor: "rgba(0,0,0,0.35)",
  borderLeft: `1px solid rgba(255,255,255,0.08)`,
  cursor: "pointer",
  touchAction: "none",
  selectors: {
    "&:focus-visible": { outline: `1px solid rgba(255,255,255,0.5)`, outlineOffset: "-1px" },
  },
});

export const historyScrollbarThumb = style({
  position: "absolute",
  left: "1px",
  right: "1px",
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
  right: "1.125rem",
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
  right: "0.625rem",
  bottom: 0,
  height: "2px",
  backgroundColor: "rgba(250, 190, 40, 0.65)",
  pointerEvents: "none",
});
