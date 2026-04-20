import { style } from "@vanilla-extract/css";

export const subviewLayout = style({
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
});

// Live row
export const subviewLiveRow = style({
  display: "flex",
  height: "5rem",
  flexShrink: 0,
});

export const subviewLiveCanvas = style({
  flex: 1,
  display: "block",
  minWidth: 0,
  minHeight: 0,
});

// Occupancy row
export const subviewOccupancyRow = style({
  display: "flex",
  height: "0.75rem",
  flexShrink: 0,
});

export const subviewOccupancySpacer = style({
  width: "2rem",
  flexShrink: 0,
  borderRight: `1px solid rgba(255,255,255,0.1)`,
});

export const subviewOccupancyCanvas = style({
  flex: 1,
  display: "block",
  minWidth: 0,
  minHeight: 0,
});

// Freq axis row
export const subviewFreqAxisRow = style({
  display: "flex",
  height: "1.75rem",
  flexShrink: 0,
});

export const subviewFreqAxisLeft = style({
  width: "2rem",
  flexShrink: 0,
  borderRight: `1px solid rgba(255,255,255,0.1)`,
});

export const subviewFreqAxisContainer = style({
  position: "relative",
  flex: 1,
  borderTop: `1px solid rgba(255,255,255,0.1)`,
  borderBottom: `1px solid rgba(255,255,255,0.1)`,
});

// Waterfall row
export const subviewWaterfallRow = style({
  display: "flex",
  flex: 1,
  minHeight: 0,
});

export const subviewWaterfallLeft = style({
  width: "2rem",
  flexShrink: 0,
});

export const subviewWaterfallContainer = style({
  position: "relative",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
});

export const subviewWaterfallCanvas = style({
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
});
