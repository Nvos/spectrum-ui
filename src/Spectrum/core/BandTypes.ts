export type BandColor =
  | "red" | "orange" | "amber" | "yellow"
  | "green" | "teal" | "cyan" | "blue"
  | "indigo" | "purple" | "pink" | "gray";

export const BAND_COLORS: Record<BandColor, string> = {
  red:    "#ff6b6b",
  orange: "#ff9f43",
  amber:  "#f9ca24",
  yellow: "#ffeaa7",
  green:  "#55efc4",
  teal:   "#00cec9",
  cyan:   "#45b7d1",
  blue:   "#74b9ff",
  indigo: "#6c5ce7",
  purple: "#a29bfe",
  pink:   "#fd79a8",
  gray:   "#778ca3",
};

export type Band = {
  id: string;
  name: string;
  freqStartMHz: number;
  freqEndMHz: number;
  color: BandColor;
  children?: Band[];
};
