export type ColormapFn = (t: number) => [number, number, number];

const piecewise = (controls: [number, number, number][]): ColormapFn => {
  const n = controls.length - 1;
  return (t: number) => {
    const s = Math.min(1, Math.max(0, t)) * n;
    const lo = Math.min(Math.floor(s), n - 1);
    const f = s - lo;
    const a = controls[lo],
      b = controls[lo + 1];
    return [
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f,
    ];
  };
};

// Control points match the GLSL functions in WaterfallRenderer.ts 1:1
const sdr = piecewise([
  [0.0, 0.0, 0.3], // dark navy (–57.5 dBm)
  [0.0, 0.0, 1.0], // pure blue
  [0.0, 1.0, 1.0], // cyan
  [0.0, 1.0, 0.0], // green
  [1.0, 1.0, 0.0], // yellow
  [1.0, 0.4, 0.0], // orange
  [0.6, 0.0, 0.0], // deep red (–39.3 dBm)
]);

const heat = piecewise([
  [0, 0, 0],
  [0.5, 0, 0.25],
  [1, 0.2, 0],
  [1, 0.8, 0],
  [1, 1, 1],
]);

const turbo = piecewise([
  [0.19, 0.07, 0.23],
  [0.27, 0.33, 0.77],
  [0.12, 0.63, 0.83],
  [0.11, 0.84, 0.72],
  [0.3, 0.97, 0.52],
  [0.64, 0.99, 0.24],
  [0.93, 0.82, 0.23],
  [0.98, 0.5, 0.13],
  [0.9, 0.22, 0.02],
  [0.69, 0.1, 0.0],
  [0.48, 0.02, 0.01],
]);

const grayscale: ColormapFn = (t) => {
  const v = Math.min(1, Math.max(0, t));
  return [v, v, v];
};

export const ColorMap = { SDR: 0, HEAT: 1, GRAYSCALE: 2, TURBO: 3 } as const;
export type ColorMapValue = (typeof ColorMap)[keyof typeof ColorMap];

export const COLORMAP_NAMES: Record<number, string> = {
  [ColorMap.SDR]: "SDR",
  [ColorMap.HEAT]: "Heat",
  [ColorMap.GRAYSCALE]: "Gray",
  [ColorMap.TURBO]: "Turbo",
};

export const COLORMAPS: Record<number, ColormapFn> = {
  [ColorMap.SDR]: sdr,
  [ColorMap.HEAT]: heat,
  [ColorMap.GRAYSCALE]: grayscale,
  [ColorMap.TURBO]: turbo,
};

export const LUT_SIZE = 256;

export const buildLUT = (fn: ColormapFn, size = LUT_SIZE): Uint8Array => {
  const lut = new Uint8Array(size * 3);
  for (let i = 0; i < size; i++) {
    const [r, g, b] = fn(i / (size - 1));
    lut[i * 3] = Math.round(r * 255);
    lut[i * 3 + 1] = Math.round(g * 255);
    lut[i * 3 + 2] = Math.round(b * 255);
  }
  return lut;
};
