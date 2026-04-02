const MAX_TICKS = 8;
const EDGE_GAP_PCT = 8;

type Tick = { dbm: number; pct: number };

export const powerTickStep = (powerMin: number, powerMax: number): number => {
  const range = powerMax - powerMin;
  const rough = range / MAX_TICKS;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  for (const s of [1, 2, 5, 10]) {
    if (s * mag >= rough) return s * mag;
  }
  return 10 * mag;
};

export const computePowerTicks = (powerMin: number, powerMax: number): Tick[] => {
  const range = powerMax - powerMin;
  const step = powerTickStep(powerMin, powerMax);
  const firstTick = Math.ceil(powerMin / step) * step;

  const middle: Tick[] = [];
  for (let d = firstTick; d <= powerMax; d += step) {
    const pct = ((powerMax - d) / range) * 100;
    if (pct > EDGE_GAP_PCT && pct < 100 - EDGE_GAP_PCT) {
      middle.push({ dbm: d, pct });
    }
  }

  return [{ dbm: powerMax, pct: 0 }, ...middle, { dbm: powerMin, pct: 100 }];
};
