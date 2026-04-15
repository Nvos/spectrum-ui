import { style } from "@vanilla-extract/css";

export const subviewLayout = style({
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  border: `1px solid rgba(255,255,255,0.15)`,
});

export const subviewLiveRow = style({
  height: "5rem",
  flexShrink: 0,
});

export const subviewLiveCanvas = style({
  display: "block",
  width: "100%",
  height: "100%",
});

export const subviewFreqAxisRow = style({
  height: "1.75rem",
  flexShrink: 0,
  borderTop: `1px solid rgba(255,255,255,0.1)`,
  borderBottom: `1px solid rgba(255,255,255,0.1)`,
});

export const subviewFreqAxisContainer = style({
  position: "relative",
  width: "100%",
  height: "100%",
});

export const subviewWaterfallRow = style({
  position: "relative",
  flex: 1,
  minHeight: 0,
});

export const subviewWaterfallCanvas = style({
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
});
