import { style } from "@vanilla-extract/css";
import { text, font } from "./tokens";

export const tick = style({
  position: "absolute",
  top: 0,
  bottom: 0,
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  pointerEvents: "none",
  userSelect: "none",
});

export const tickMark = style({
  width: "1px",
  height: "0.5rem",
  backgroundColor: "rgba(255,255,255,0.25)",
});

export const tickLabel = style({
  fontSize: "10px",
  fontFamily: font.mono,
  color: text.muted,
  whiteSpace: "nowrap",
  lineHeight: 1,
});
