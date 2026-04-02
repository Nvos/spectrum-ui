import { POWER_NO_READING } from "./constants";

export const TICK_MS = 60;

export const MOCK_FREQ_START = 88_000_000;
export const MOCK_FREQ_END = 108_000_000;
export const MOCK_BIN_COUNT = 2000;
export const MOCK_HYDRATION_ROWS = 300;

const OCCUPANCY_THRESHOLD_DBM = -85;

const toBase64 = (buffer: ArrayBufferLike): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export type HydrationPayload = {
  lastTimestamp: number;
  freqStart: number;
  freqEnd: number;
  binCount: number;
  timestamps: string;
  spectrum: { count: number; rows: string };
  annotations: { count: number; rows: string };
  maxHold: string;
  occupancy: { total: number; counts: string };
};

export const generateLiveFrame = (binCount: number): string => {
  const buffer = new ArrayBuffer(12 + 2 * binCount);
  const view = new DataView(buffer);
  view.setFloat64(0, Date.now(), true);
  view.setUint16(8, binCount, true);
  view.setUint16(10, binCount, true);
  generateRow(new Int8Array(buffer, 12, binCount), binCount);
  generateAnnotationRow(new Int8Array(buffer, 12 + binCount, binCount), binCount);
  return toBase64(buffer);
}

export const generateHydrationPayload = (): HydrationPayload => {
  const now = Date.now();
  const n = MOCK_HYDRATION_ROWS;
  const bins = MOCK_BIN_COUNT;

  const timestamps = new Float64Array(n);
  const spectrumRows = new Int8Array(n * bins);
  const annotationRows = new Int8Array(n * bins);
  const maxHold = new Int8Array(bins).fill(POWER_NO_READING);
  const occupancyCounts = new Uint32Array(bins);

  const rowBuf = new Int8Array(bins);
  const annBuf = new Int8Array(bins);

  for (let i = 0; i < n; i++) {
    generateRow(rowBuf, bins);
    generateAnnotationRow(annBuf, bins);

    timestamps[i] = now - Math.round((n - 1 - i) * TICK_MS);
    spectrumRows.set(rowBuf, i * bins);
    annotationRows.set(annBuf, i * bins);

    for (let b = 0; b < bins; b++) {
      if (rowBuf[b] > maxHold[b]) maxHold[b] = rowBuf[b];
      if (rowBuf[b] > OCCUPANCY_THRESHOLD_DBM) occupancyCounts[b]++;
    }
  }

  return {
    lastTimestamp: timestamps[n - 1],
    freqStart: MOCK_FREQ_START,
    freqEnd: MOCK_FREQ_END,
    binCount: bins,
    timestamps: toBase64(timestamps.buffer),
    spectrum: { count: n, rows: toBase64(spectrumRows.buffer) },
    annotations: { count: n, rows: toBase64(annotationRows.buffer) },
    maxHold: toBase64(maxHold.buffer),
    occupancy: { total: n, counts: toBase64(occupancyCounts.buffer) },
  };
}

// Thermal noise floor sits below any useful threshold so all idle bins encode as -127 (below threshold)
const NOISE_FLOOR_DBM = -90;

// Encode a dBm value as Int8: below -127 or above 127 is clamped, value is stored directly
const dbmToInt8 = (dbm: number): number => {
  return Math.max(-127, Math.min(127, Math.round(dbm)));
}

type Signal = {
  bin: number; // center bin
  halfBw: number; // half-bandwidth in bins (~125–500 kHz LoRa channels at 200 kHz/bin)
  peakDbm: number; // peak power when transmitting
  active: boolean;
  ticksLeft: number;
  continuous?: boolean; // always-on, never deactivated
};

const SIGNALS: Signal[] = [
  // Low band
  { bin: 60, halfBw: 1, peakDbm: -82, active: false, ticksLeft: 0 },
  { bin: 190, halfBw: 2, peakDbm: -71, active: false, ticksLeft: 0 },
  { bin: 320, halfBw: 1, peakDbm: -87, active: false, ticksLeft: 0 },
  { bin: 440, halfBw: 1, peakDbm: -76, active: false, ticksLeft: 0 },
  // Mid-low band
  { bin: 580, halfBw: 3, peakDbm: -68, active: false, ticksLeft: 0 },
  { bin: 720, halfBw: 1, peakDbm: -80, active: false, ticksLeft: 0 },
  { bin: 850, halfBw: 5, peakDbm: -73, active: false, ticksLeft: 0 },
  { bin: 970, halfBw: 1, peakDbm: -84, active: false, ticksLeft: 0 },
  // Mid band
  { bin: 1080, halfBw: 2, peakDbm: -70, active: false, ticksLeft: 0 },
  { bin: 1200, halfBw: 1, peakDbm: -78, active: false, ticksLeft: 0 },
  { bin: 1340, halfBw: 4, peakDbm: -66, active: false, ticksLeft: 0 },
  { bin: 1450, halfBw: 1, peakDbm: -85, active: false, ticksLeft: 0 },
  // High band
  { bin: 1580, halfBw: 2, peakDbm: -74, active: false, ticksLeft: 0 },
  { bin: 1700, halfBw: 1, peakDbm: -81, active: false, ticksLeft: 0 },
  { bin: 1820, halfBw: 3, peakDbm: -69, active: false, ticksLeft: 0 },
  { bin: 1940, halfBw: 1, peakDbm: -77, active: false, ticksLeft: 0 },
  // Continuous beacons — always active, used to exercise full-ring block rendering.
  { bin: 250,  halfBw: 1, peakDbm: -72, active: true, ticksLeft: 0, continuous: true },
  { bin: 1750, halfBw: 1, peakDbm: -75, active: true, ticksLeft: 0, continuous: true },
];

// ~2% chance per tick to start a burst; exponential burst length (~1.5 s mean)
const ACTIVATE_PROB = 0.02;
const BURST_MEAN_TICKS = 25;

// Marks bins belonging to currently active signals (call after generateRow).
// Returns true if any bin was marked active.
export const generateAnnotationRow = (out: Int8Array, binCount: number): boolean => {
  out.fill(-128);
  let anyActive = false;
  for (const sig of SIGNALS) {
    if (!sig.active) continue;
    anyActive = true;
    const lo = Math.max(0, sig.bin - sig.halfBw);
    const hi = Math.min(binCount - 1, sig.bin + sig.halfBw);
    for (let b = lo; b <= hi; b++) out[b] = 0;
  }
  return anyActive;
};

export const generateRow = (out: Int8Array, binCount: number) => {
  // Advance burst state machines
  for (const sig of SIGNALS) {
    if (sig.continuous) continue;
    if (sig.active) {
      if (--sig.ticksLeft <= 0) sig.active = false;
    } else if (Math.random() < ACTIVATE_PROB) {
      sig.active = true;
      // Exponentially distributed burst duration
      sig.ticksLeft = Math.ceil(-Math.log(Math.random()) * BURST_MEAN_TICKS);
    }
  }

  for (let i = 0; i < binCount; i++) {
    // Gaussian-ish thermal noise (triangular sum of two uniforms, centered at 0)
    let dbm = NOISE_FLOOR_DBM + (Math.random() + Math.random() - 1) * 4;

    for (const sig of SIGNALS) {
      if (!sig.active) continue;
      const d = Math.abs(i - sig.bin);
      if (d > sig.halfBw + 1) continue;

      // CSS flat-top shape: full power within halfBw, sharp rolloff at the edge
      const rolloff = d > sig.halfBw ? 10 : d === sig.halfBw ? 3 : 0;
      const s = sig.peakDbm - rolloff + (Math.random() - 0.5) * 1.5;
      if (s > dbm) dbm = s;
    }

    out[i] = dbmToInt8(dbm);
  }
};
