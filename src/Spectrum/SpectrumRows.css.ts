import { style } from "@vanilla-extract/css";

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
});

// Live row
export const liveRow = style({
  display: "flex",
  height: "8rem",
  minHeight: 0,
  flexShrink: 0,
  marginTop: "0.5rem",
});

export const liveCanvas = style({
  flex: 1,
  display: "block",
  minHeight: 0,
  minWidth: 0,
  border: `1px solid rgba(255,255,255,0.1)`,
});

// Occupancy row
export const occupancyRow = style({
  display: "flex",
  height: "0.75rem",
  flexShrink: 0,
});

export const occupancyRowSpacer = style({
  width: "2rem",
  flexShrink: 0,
  borderRight: `1px solid rgba(255,255,255,0.1)`,
});

export const occupancyCanvas = style({
  flex: 1,
  display: "block",
  minHeight: 0,
  minWidth: 0,
});

// Freq axis row
export const freqAxisRow = style({
  display: "flex",
  height: "2rem",
  flexShrink: 0,
});

export const freqAxisLeft = style({
  width: "2rem",
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
  width: "2rem",
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
