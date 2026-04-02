import { style } from "@vanilla-extract/css";
import { background, text, font } from "../tokens";

// --- Power axis ---

export const powerAxisContainer = style({
  position: "relative",
  width: "2rem",
  flexShrink: 0,
  userSelect: "none",
  pointerEvents: "none",
  overflow: "visible",
});

export const powerAxisTickRow = style({
  position: "absolute",
  right: 0,
  display: "flex",
  alignItems: "center",
  transform: "translateY(-50%)",
});

export const powerAxisTickLabel = style({
  fontSize: "10px",
  fontFamily: font.mono,
  color: text.muted,
  paddingRight: "0.25rem",
});

export const powerAxisTickLine = style({
  width: "0.375rem",
  height: "1px",
  backgroundColor: "rgba(255,255,255,0.25)",
});

// --- Colormap legend ---

export const colormapContainer = style({
  position: "relative",
  width: "2.5rem",
  flexShrink: 0,
  userSelect: "none",
  overflow: "visible",
  backgroundColor: background[950],
  border: `1px solid rgba(255,255,255,0.1)`,
});

export const colormapGradientArea = style({
  position: "absolute",
  left: 0,
  right: 0,
  cursor: "grab",
});

export const colormapTickRow = style({
  position: "absolute",
  left: 0,
  right: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "none",
  transform: "translateY(-50%)",
});

export const colormapTickText = style({
  fontSize: "0.75rem",
  fontFamily: font.mono,
  color: text.default,
  textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 -1px 3px rgba(0,0,0,0.9)",
});

export const colormapHandle = style({
  position: "absolute",
  left: 0,
  right: 0,
  zIndex: 50,
  cursor: "ns-resize",
  display: "flex",
  flexDirection: "column",
});

export const colormapHandleBadge = style({
  width: "100%",
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0.1rem 0.25rem",
  backgroundColor: background[950],
  borderTop: `1px solid rgba(255,255,255,0.1)`,
  borderBottom: `1px solid rgba(255,255,255,0.1)`,
});

export const colormapHandleBadgeText = style({
  fontSize: "0.75rem",
  fontFamily: font.mono,
  color: text.default,
  lineHeight: 1,
});

// --- Frequency axis ---

export const freqAxisTick = style({
  position: "absolute",
  top: 0,
  bottom: 0,
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  alignItems: "center",
  transform: "translateX(-50%)",
  pointerEvents: "none",
  userSelect: "none",
});

export const freqAxisTickMark = style({
  width: "1px",
  height: "0.5rem",
  backgroundColor: "rgba(255,255,255,0.25)",
});

export const freqAxisTickLabel = style({
  fontSize: "10px",
  fontFamily: font.mono,
  color: text.muted,
  whiteSpace: "nowrap",
  lineHeight: 1,
});

// --- Time labels ---

export const timeLabelRow = style({
  position: "absolute",
  left: 0,
  right: 0,
  display: "flex",
  alignItems: "center",
  transform: "translateY(-50%)",
  pointerEvents: "none",
});

export const timeLabelText = style({
  flex: 1,
  textAlign: "right",
  fontSize: "10px",
  fontFamily: font.mono,
  color: "rgba(255,255,255,0.65)",
  lineHeight: 1,
  paddingRight: "2px",
  textShadow: "0 1px 2px rgba(0,0,0,0.95), 0 -1px 2px rgba(0,0,0,0.95)",
});

export const timeLabelTick = style({
  width: "6px",
  height: "1px",
  flexShrink: 0,
  backgroundColor: "rgba(255,255,255,0.25)",
});

// --- Tooltip content (label column only; outer div is owned by React) ---

export const tooltipLabel = style({
  color: text.muted,
  textAlign: "right",
});
