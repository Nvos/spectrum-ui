import { style } from "@vanilla-extract/css";
import { text, font } from "./tokens";

export const container = style({
  position: "relative",
  width: "2rem",
  flexShrink: 0,
  userSelect: "none",
  pointerEvents: "none",
  overflow: "visible",
});

export const tickRow = style({
  position: "absolute",
  right: 0,
  display: "flex",
  alignItems: "center",
});

export const tickLabel = style({
  fontSize: "10px",
  fontFamily: font.mono,
  color: text.muted,
  paddingRight: "0.25rem",
});

export const tickLine = style({
  width: "0.375rem",
  height: "1px",
  backgroundColor: "rgba(255,255,255,0.25)",
});
