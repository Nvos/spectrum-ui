import { style, styleVariants } from "@vanilla-extract/css";
import { background, text, font } from "./Spectrum/tokens";

export const root = style({
  width: "100%",
  height: "100dvh",
  display: "flex",
  flexDirection: "column",
  backgroundColor: background[950],
  color: text.default,
});

export const spectrumContainer = style({
  flex: 1,
  minHeight: 0,
});

export const controlsRow = style({
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  paddingLeft: "2rem",
  paddingRight: "2rem",
  paddingTop: "0.75rem",
  paddingBottom: "0.25rem",
  flexShrink: 0,
  flexWrap: "wrap",
});

export const colormapSelectorRow = style({
  display: "none",
});

export const separator = style({
  width: "1px",
  height: "1.25rem",
  backgroundColor: "rgba(255,255,255,0.1)",
  flexShrink: 0,
  marginLeft: "0.25rem",
  marginRight: "0.25rem",
});

const buttonBase = style({
  padding: "0.25rem 0.75rem",
  fontSize: "0.8125rem",
  fontFamily: font.mono,
  borderRadius: "0.25rem",
  border: "1px solid",
  cursor: "pointer",
  background: "none",
});

export const button = styleVariants({
  active: [buttonBase, { borderColor: "rgba(255,255,255,0.4)", color: "white" }],
  inactive: [buttonBase, { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }],
});

export const tauControls = style({
  display: "flex",
  alignItems: "center",
  gap: "0.25rem",
  marginLeft: "0.25rem",
});

export const tauLabel = style({
  fontSize: "0.75rem",
  fontFamily: font.mono,
  color: "rgba(255,255,255,0.3)",
  paddingRight: "0.125rem",
});

export const occLabel = style({
  fontSize: "0.75rem",
  fontFamily: font.mono,
  color: "rgba(255,255,255,0.3)",
});

export const numberInput = style({
  width: "5rem",
  padding: "0.25rem 0.5rem",
  fontSize: "0.8125rem",
  fontFamily: font.mono,
  borderRadius: "0.25rem",
  border: `1px solid rgba(255,255,255,0.1)`,
  background: "transparent",
  color: "rgba(255,255,255,0.6)",
  ":focus": {
    outline: "none",
    borderColor: "rgba(255,255,255,0.3)",
  },
});
