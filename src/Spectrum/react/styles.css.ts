import { style } from "@vanilla-extract/css";
import { font, text } from "../tokens";

export const tooltip = style({
  position: "fixed",
  zIndex: 50,
  pointerEvents: "none",
  padding: "0.3rem 0.5rem",
  fontSize: "0.75rem",
  fontFamily: font.mono,
  color: text.default,
  backgroundColor: "rgba(23,23,23,0.95)",
  border: `1px solid rgba(255,255,255,0.1)`,
  borderRadius: "0.25rem",
  boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  display: "grid",
  gridTemplateColumns: "auto auto",
  columnGap: "0.625rem",
  rowGap: "0.1rem",
});
