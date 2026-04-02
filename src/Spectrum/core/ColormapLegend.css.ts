import { style } from "@vanilla-extract/css";
import { background,  text, font } from "./tokens";

export const container = style({
  position: "relative",
  width: "2.5rem",
  flexShrink: 0,
  userSelect: "none",
  overflow: "visible",
  backgroundColor: background[950],
  border: `1px solid rgba(255,255,255,0.1)`,
});

export const gradientArea = style({
  position: "absolute",
  left: 0,
  right: 0,
});

export const tickRow = style({
  position: "absolute",
  left: 0,
  right: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "none",
});

export const tickText = style({
  fontSize: "0.75rem",
  fontFamily: font.mono,
  color: text.default,
});

export const handle = style({
  position: "absolute",
  left: 0,
  right: 0,
  zIndex: 50,
  cursor: "ns-resize",
  display: "flex",
  flexDirection: "column",
});

export const handleLine = style({
  height: "2px",
  flexShrink: 0,
  backgroundColor: "rgba(255,255,255,0.9)",
});

export const handleBadge = style({
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

export const handleBadgeText = style({
  fontSize: "0.75rem",
  fontFamily: font.mono,
  color: text.default,
  lineHeight: 1,
});
