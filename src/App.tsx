import { useAtomValue, useSetAtom } from "jotai";
import { Provider } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as styles from "./App.css";
import {
  COLORMAP_NAMES,
  FrameBuffer,
  POWER_CEILING,
  POWER_FLOOR,
  ProfilePanel,
  Spectrum,
  SpectrumCore,
  SpectrumSubview,
} from "./Spectrum";
import type { ProfileRange, SpectrumInitialData } from "./Spectrum";
import { generateHydrationPayload, generateLiveFrame, MOCK_BIN_COUNT, TICK_MS } from "./mock";
import type { HydrationPayload } from "./mock";
import {
  avgTauAtom,
  bandsAtom,
  colorMapAtom,
  createSpectrumStore,
  displayMaxAtom,
  displayMinAtom,
  layerVisibilityAtom,
  occupancyThresholdAtom,
} from "./Spectrum/react/store";
import type { LayerName, SpectrumStore } from "./Spectrum/react/store";
import type { Band } from "./Spectrum/core/BandTypes";

const SUBVIEW_PALETTE = [
  { band: "rgba(100, 210, 255, 0.18)", accent: "#64d2ff" },
  { band: "rgba(255, 180, 50, 0.18)", accent: "#ffb432" },
  { band: "rgba(180, 130, 255, 0.18)", accent: "#b482ff" },
  { band: "rgba(100, 255, 160, 0.18)", accent: "#64ffa0" },
  { band: "rgba(255, 100, 130, 0.18)", accent: "#ff6482" },
];

const DEFAULT_BINS = 4000;
const DEFAULT_ROWS = 300;

const DEMO_BANDS: Band[] = [
  // ───────────────────────────────────────────────────────────────────────
  // TELECOM — Cellular FDD, sub-1 GHz (low-band coverage layer)
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "n71",
    name: "n71 — 600 MHz",
    freqStartMHz: 617,
    freqEndMHz: 698,
    color: "blue",
    children: [
      { id: "n71-dl", name: "n71 DL", freqStartMHz: 617, freqEndMHz: 652, color: "blue" },
      { id: "n71-ul", name: "n71 UL", freqStartMHz: 663, freqEndMHz: 698, color: "blue" },
    ],
  },
  {
    id: "n28",
    name: "n28 — 700 MHz (APT)",
    freqStartMHz: 703,
    freqEndMHz: 803,
    color: "blue",
    children: [
      { id: "n28-ul", name: "n28 UL", freqStartMHz: 703, freqEndMHz: 748, color: "blue" },
      { id: "n28-dl", name: "n28 DL", freqStartMHz: 758, freqEndMHz: 803, color: "blue" },
    ],
  },
  {
    id: "n12",
    name: "n12 — 700 MHz (Lower, US)",
    freqStartMHz: 699,
    freqEndMHz: 746,
    color: "blue",
    children: [
      { id: "n12-ul", name: "n12 UL", freqStartMHz: 699, freqEndMHz: 716, color: "blue" },
      { id: "n12-dl", name: "n12 DL", freqStartMHz: 729, freqEndMHz: 746, color: "blue" },
    ],
  },
  {
    id: "n20",
    name: "n20 — 800 MHz (EU Digital Dividend)",
    freqStartMHz: 791,
    freqEndMHz: 862,
    color: "blue",
    children: [
      { id: "n20-dl", name: "n20 DL", freqStartMHz: 791, freqEndMHz: 821, color: "blue" },
      { id: "n20-ul", name: "n20 UL", freqStartMHz: 832, freqEndMHz: 862, color: "blue" },
    ],
  },
  {
    id: "n5",
    name: "n5 — 850 MHz",
    freqStartMHz: 824,
    freqEndMHz: 894,
    color: "blue",
    children: [
      { id: "n5-ul", name: "n5 UL", freqStartMHz: 824, freqEndMHz: 849, color: "blue" },
      { id: "n5-dl", name: "n5 DL", freqStartMHz: 869, freqEndMHz: 894, color: "blue" },
    ],
  },
  {
    id: "n8",
    name: "n8 — 900 MHz (GSM)",
    freqStartMHz: 880,
    freqEndMHz: 960,
    color: "blue",
    children: [
      { id: "n8-ul", name: "n8 UL", freqStartMHz: 880, freqEndMHz: 915, color: "blue" },
      { id: "n8-dl", name: "n8 DL", freqStartMHz: 925, freqEndMHz: 960, color: "blue" },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // TELECOM — Cellular FDD/TDD, 1–3 GHz (capacity layer)
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "n3",
    name: "n3 — 1800 MHz (DCS)",
    freqStartMHz: 1710,
    freqEndMHz: 1880,
    color: "indigo",
    children: [
      { id: "n3-ul", name: "n3 UL", freqStartMHz: 1710, freqEndMHz: 1785, color: "indigo" },
      { id: "n3-dl", name: "n3 DL", freqStartMHz: 1805, freqEndMHz: 1880, color: "indigo" },
    ],
  },
  {
    id: "n25",
    name: "n25 — 1900 MHz (PCS, ext.)",
    freqStartMHz: 1850,
    freqEndMHz: 1995,
    color: "indigo",
    children: [
      { id: "n25-ul", name: "n25 UL", freqStartMHz: 1850, freqEndMHz: 1915, color: "indigo" },
      { id: "n25-dl", name: "n25 DL", freqStartMHz: 1930, freqEndMHz: 1995, color: "indigo" },
    ],
  },
  {
    id: "n1",
    name: "n1 — 2100 MHz (IMT)",
    freqStartMHz: 1920,
    freqEndMHz: 2170,
    color: "indigo",
    children: [
      { id: "n1-ul", name: "n1 UL", freqStartMHz: 1920, freqEndMHz: 1980, color: "indigo" },
      { id: "n1-dl", name: "n1 DL", freqStartMHz: 2110, freqEndMHz: 2170, color: "indigo" },
    ],
  },
  {
    id: "n66",
    name: "n66 — AWS-3 (1.7/2.1 GHz)",
    freqStartMHz: 1710,
    freqEndMHz: 2200,
    color: "indigo",
    children: [
      { id: "n66-ul", name: "n66 UL", freqStartMHz: 1710, freqEndMHz: 1780, color: "indigo" },
      { id: "n66-dl", name: "n66 DL", freqStartMHz: 2110, freqEndMHz: 2200, color: "indigo" },
    ],
  },
  {
    id: "n40",
    name: "n40 — 2300 MHz (TDD)",
    freqStartMHz: 2300,
    freqEndMHz: 2400,
    color: "indigo",
  },
  {
    id: "n41",
    name: "n41 — 2500 MHz (TDD, BRS/EBS)",
    freqStartMHz: 2496,
    freqEndMHz: 2690,
    color: "indigo",
  },
  {
    id: "n7",
    name: "n7 — 2600 MHz (FDD)",
    freqStartMHz: 2500,
    freqEndMHz: 2690,
    color: "indigo",
    children: [
      { id: "n7-ul", name: "n7 UL", freqStartMHz: 2500, freqEndMHz: 2570, color: "indigo" },
      { id: "n7-dl", name: "n7 DL", freqStartMHz: 2620, freqEndMHz: 2690, color: "indigo" },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // TELECOM — 5G NR mid-band, 3–6 GHz (the C-band core of 5G)
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "n77",
    name: "n77 — 3.7 GHz (TDD)",
    freqStartMHz: 3300,
    freqEndMHz: 4200,
    color: "purple",
  },
  {
    id: "n78",
    name: "n78 — C-band (3.5 GHz, TDD)",
    freqStartMHz: 3300,
    freqEndMHz: 3800,
    color: "purple",
  },
  {
    id: "n48",
    name: "n48 — CBRS (3.5 GHz, TDD)",
    freqStartMHz: 3550,
    freqEndMHz: 3700,
    color: "purple",
  },
  {
    id: "n79",
    name: "n79 — 4.7 GHz (TDD)",
    freqStartMHz: 4400,
    freqEndMHz: 5000,
    color: "purple",
  },

  // ───────────────────────────────────────────────────────────────────────
  // TELECOM — 5G NR mmWave, FR2 (24–48 GHz)
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "n258",
    name: "n258 — 26 GHz mmWave",
    freqStartMHz: 24250,
    freqEndMHz: 27500,
    color: "pink",
  },
  {
    id: "n257",
    name: "n257 — 28 GHz mmWave",
    freqStartMHz: 26500,
    freqEndMHz: 29500,
    color: "pink",
    children: [
      {
        id: "n261",
        name: "n261 — 28 GHz (US)",
        freqStartMHz: 27500,
        freqEndMHz: 28350,
        color: "pink",
      },
    ],
  },
  {
    id: "n260",
    name: "n260 — 39 GHz mmWave",
    freqStartMHz: 37000,
    freqEndMHz: 40000,
    color: "pink",
  },

  // ───────────────────────────────────────────────────────────────────────
  // TELECOM — Wi-Fi / WLAN
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "ism-24",
    name: "2.4 GHz ISM (Wi-Fi / BT)",
    freqStartMHz: 2400,
    freqEndMHz: 2483.5,
    color: "teal",
  },
  { id: "wifi-24", name: "Wi-Fi 2.4 GHz", freqStartMHz: 2401, freqEndMHz: 2473, color: "teal" },
  { id: "bt-24", name: "Bluetooth", freqStartMHz: 2402, freqEndMHz: 2480, color: "teal" },
  {
    id: "wifi-5",
    name: "5 GHz Wi-Fi (U-NII)",
    freqStartMHz: 5150,
    freqEndMHz: 5850,
    color: "teal",
    children: [
      { id: "unii-1", name: "U-NII-1", freqStartMHz: 5150, freqEndMHz: 5250, color: "teal" },
      { id: "unii-2a", name: "U-NII-2A", freqStartMHz: 5250, freqEndMHz: 5350, color: "teal" },
      { id: "unii-2c", name: "U-NII-2C/2E", freqStartMHz: 5470, freqEndMHz: 5725, color: "teal" },
      { id: "unii-3", name: "U-NII-3", freqStartMHz: 5725, freqEndMHz: 5850, color: "teal" },
    ],
  },
  {
    id: "wifi-6e",
    name: "6 GHz Wi-Fi (6E/7)",
    freqStartMHz: 5925,
    freqEndMHz: 7125,
    color: "teal",
    children: [
      { id: "unii-5", name: "U-NII-5", freqStartMHz: 5925, freqEndMHz: 6425, color: "teal" },
      { id: "unii-6", name: "U-NII-6", freqStartMHz: 6425, freqEndMHz: 6525, color: "teal" },
      { id: "unii-7", name: "U-NII-7", freqStartMHz: 6525, freqEndMHz: 6875, color: "teal" },
      { id: "unii-8", name: "U-NII-8", freqStartMHz: 6875, freqEndMHz: 7125, color: "teal" },
    ],
  },
  {
    id: "wigig-60",
    name: "60 GHz WiGig (11ad/ay)",
    freqStartMHz: 57000,
    freqEndMHz: 71000,
    color: "teal",
  },

  // ───────────────────────────────────────────────────────────────────────
  // TELECOM — Sub-GHz short-range / ISM (IoT, telemetry, LPWAN)
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "ism-433",
    name: "433 MHz ISM",
    freqStartMHz: 433.05,
    freqEndMHz: 434.79,
    color: "cyan",
  },
  {
    id: "ism-868",
    name: "868 MHz SRD (EU)",
    freqStartMHz: 863,
    freqEndMHz: 870,
    color: "cyan",
  },
  {
    id: "ism-915",
    name: "915 MHz ISM (US)",
    freqStartMHz: 902,
    freqEndMHz: 928,
    color: "cyan",
  },

  // ───────────────────────────────────────────────────────────────────────
  // GNSS — grouped by band; children are per-constellation signals
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "gnss-l5",
    name: "GNSS L5 / E5 (1176 MHz)",
    freqStartMHz: 1164,
    freqEndMHz: 1217,
    color: "amber",
    children: [
      { id: "gps-l5", name: "GPS L5", freqStartMHz: 1166.22, freqEndMHz: 1186.68, color: "amber" },
      {
        id: "gal-e5a",
        name: "Galileo E5a",
        freqStartMHz: 1166.22,
        freqEndMHz: 1186.68,
        color: "amber",
      },
      {
        id: "gal-e5b",
        name: "Galileo E5b",
        freqStartMHz: 1196.91,
        freqEndMHz: 1217.37,
        color: "amber",
      },
      { id: "glo-l3", name: "GLONASS L3", freqStartMHz: 1190, freqEndMHz: 1212, color: "amber" },
      {
        id: "bds-b2a",
        name: "BeiDou B2a/B2b",
        freqStartMHz: 1166.22,
        freqEndMHz: 1217.37,
        color: "amber",
      },
    ],
  },
  {
    id: "gnss-l2",
    name: "GNSS L2 (1227 MHz)",
    freqStartMHz: 1215,
    freqEndMHz: 1254,
    color: "amber",
    children: [
      { id: "gps-l2", name: "GPS L2", freqStartMHz: 1217.37, freqEndMHz: 1237.83, color: "amber" },
      {
        id: "glo-l2",
        name: "GLONASS L2",
        freqStartMHz: 1242.94,
        freqEndMHz: 1248.63,
        color: "amber",
      },
    ],
  },
  {
    id: "gnss-e6",
    name: "GNSS E6 / B3 (1268–1279 MHz)",
    freqStartMHz: 1258,
    freqEndMHz: 1300,
    color: "amber",
    children: [
      {
        id: "bds-b3",
        name: "BeiDou B3",
        freqStartMHz: 1258.29,
        freqEndMHz: 1278.75,
        color: "amber",
      },
      { id: "gal-e6", name: "Galileo E6", freqStartMHz: 1260, freqEndMHz: 1300, color: "amber" },
    ],
  },
  {
    id: "gnss-l1",
    name: "GNSS L1 / E1 (1575 MHz)",
    freqStartMHz: 1559,
    freqEndMHz: 1610,
    color: "amber",
    children: [
      {
        id: "bds-b1i",
        name: "BeiDou B1I",
        freqStartMHz: 1559.05,
        freqEndMHz: 1563.14,
        color: "amber",
      },
      {
        id: "gps-l1",
        name: "GPS L1 / Galileo E1 / BeiDou B1C",
        freqStartMHz: 1563.42,
        freqEndMHz: 1587.42,
        color: "amber",
      },
      {
        id: "glo-l1",
        name: "GLONASS L1",
        freqStartMHz: 1593.9,
        freqEndMHz: 1609.9,
        color: "amber",
      },
    ],
  },
  {
    id: "gnss-navic-s",
    name: "NavIC S-band",
    freqStartMHz: 2483.5,
    freqEndMHz: 2500,
    color: "amber",
  },

  // ───────────────────────────────────────────────────────────────────────
  // DRONES — control, telemetry, FPV video, and UAS command-and-control
  // (these overlap ISM/Wi-Fi bands by design; kept distinct for the drone lane)
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "drone-433",
    name: "Drone 433 MHz (telemetry)",
    freqStartMHz: 433.05,
    freqEndMHz: 434.79,
    color: "red",
  },
  {
    id: "drone-900",
    name: "Drone 900 MHz (long-range C2)",
    freqStartMHz: 902,
    freqEndMHz: 928,
    color: "red",
  },
  {
    id: "drone-13",
    name: "Drone 1.3 GHz FPV video",
    freqStartMHz: 1240,
    freqEndMHz: 1300,
    color: "red",
  },
  {
    id: "drone-24",
    name: "Drone 2.4 GHz (control + video)",
    freqStartMHz: 2400,
    freqEndMHz: 2483.5,
    color: "red",
  },
  {
    id: "uas-c2",
    name: "UAS C2 link (CNPC, AeroMACS-adj.)",
    freqStartMHz: 5030,
    freqEndMHz: 5091,
    color: "red",
  },
  {
    id: "drone-58",
    name: "Drone 5.8 GHz FPV video",
    freqStartMHz: 5650,
    freqEndMHz: 5925,
    color: "red",
    children: [
      {
        id: "fpv-raceband",
        name: "FPV Raceband",
        freqStartMHz: 5658,
        freqEndMHz: 5917,
        color: "red",
      },
      {
        id: "fpv-ism",
        name: "5.8 GHz ISM core",
        freqStartMHz: 5725,
        freqEndMHz: 5875,
        color: "red",
      },
    ],
  },
];

const decodeHydration = (payload: HydrationPayload): SpectrumInitialData => {
  const { binCount, spectrum, annotations } = payload;
  const count = spectrum.count;

  const tsBuf = new Uint8Array(count * 8);
  tsBuf.setFromBase64(payload.timestamps);
  const timestamps = Array.from(new Float64Array(tsBuf.buffer));

  const specBuf = new Uint8Array(count * binCount);
  specBuf.setFromBase64(spectrum.rows);

  const annBuf = new Uint8Array(count * binCount);
  annBuf.setFromBase64(annotations.rows);

  const maxHoldBuf = new Uint8Array(binCount);
  maxHoldBuf.setFromBase64(payload.maxHold);

  const maxSnapshotBuf = new Uint8Array(binCount);
  maxSnapshotBuf.setFromBase64(payload.maxSnapshot);

  const occBuf = new Uint8Array(binCount * 4);
  occBuf.setFromBase64(payload.occupancy.counts);

  return {
    spectrum: { rows: new Int8Array(specBuf.buffer), count, timestamps },
    annotations: { rows: new Int8Array(annBuf.buffer), count, timestamps },
    maxHold: new Int8Array(maxHoldBuf.buffer),
    maxSnapshot: new Int8Array(maxSnapshotBuf.buffer),
    occupancy: {
      counts: new Uint32Array(occBuf.buffer),
      total: payload.occupancy.total,
      threshold: payload.occupancy.threshold,
    },
  };
};

const LAYERS: { id: LayerName; label: string; color: string }[] = [
  { id: "live", label: "Live", color: "#4ade80" },
  { id: "avg", label: "Average", color: "#fabe28" },
  { id: "max", label: "Max Hold", color: "#ff5050" },
  { id: "maxSnapshot", label: "Max Snapshot", color: "#b450ff" },
  { id: "annotations", label: "Annotations", color: "#ff00c8" },
];

const AVG_TAU_STEPS = [500, 1000, 2000, 5000, 10_000];
const AVG_TAU_LABELS: Record<number, string> = {
  500: "0.5s",
  1000: "1s",
  2000: "2s",
  5000: "5s",
  10000: "10s",
};

type SpectrumParams = { freqStart: number; resolution: number; binCount: number; rowCount: number };
type SpectrumConfig = { params: SpectrumParams; initialData?: SpectrumInitialData };

const useMockInterval = (frameBuffer: FrameBuffer | null) => {
  const frameBytesRef = useRef(new Uint8Array(12 + 2 * MOCK_BIN_COUNT));

  const processFrame = useCallback(
    (frame: string) => {
      if (!frameBuffer) return;
      frameBytesRef.current.setFromBase64(frame);
      const bytes = frameBytesRef.current;
      const dv = new DataView(bytes.buffer);
      const timestampMs = dv.getFloat64(0, true);
      const waterfallLen = dv.getUint16(8, true);
      const annotationLen = dv.getUint16(10, true);
      const waterfallRow = new Int8Array(bytes.buffer, 12, waterfallLen);
      const annotationRow = new Int8Array(bytes.buffer, 12 + waterfallLen, annotationLen);
      frameBuffer.push(waterfallRow, annotationRow, timestampMs);
    },
    [frameBuffer],
  );

  useEffect(() => {
    if (!frameBuffer) return;
    let handle: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      handle = setInterval(() => processFrame(generateLiveFrame(MOCK_BIN_COUNT)), TICK_MS);
    };
    const stop = () => {
      if (handle !== null) {
        clearInterval(handle);
        handle = null;
      }
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [processFrame]);
};

// Bridges Jotai atoms → SpectrumCore imperative API.
// Runs once per (store, core) pair; re-runs when core changes (re-hydrate).
const useSpectrumCoreBridge = (store: SpectrumStore, core: SpectrumCore | null) => {
  useEffect(() => {
    if (!core) return;
    const unsubs = [
      store.sub(displayMinAtom, () =>
        core.setDisplayRange(store.get(displayMinAtom), store.get(displayMaxAtom)),
      ),
      store.sub(displayMaxAtom, () =>
        core.setDisplayRange(store.get(displayMinAtom), store.get(displayMaxAtom)),
      ),
      store.sub(colorMapAtom, () => core.setColormap(store.get(colorMapAtom))),
      store.sub(layerVisibilityAtom, () => core.setLayerVisibility(store.get(layerVisibilityAtom))),
      store.sub(avgTauAtom, () => core.setAvgTau(store.get(avgTauAtom))),
      store.sub(occupancyThresholdAtom, () =>
        core.setOccupancyThreshold(store.get(occupancyThresholdAtom)),
      ),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, [store, core]);
};

const DEFAULT_PARAMS: SpectrumParams = {
  freqStart: 25_000,
  resolution: 1500,
  binCount: DEFAULT_BINS,
  rowCount: DEFAULT_ROWS,
};

// Inner component — lives inside <Provider store={store}> so atom hooks work.
type SubviewDef = { id: number; freqStart: number; freqEnd: number };

const AppInner = ({ store }: { store: SpectrumStore }) => {
  const [paramsForm, setParamsForm] = useState<SpectrumParams>(DEFAULT_PARAMS);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [profileRanges, setProfileRanges] = useState<ProfileRange[]>([]);
  const profileRangesRef = useRef(profileRanges);
  profileRangesRef.current = profileRanges;
  const [subviewDefs, setSubviewDefs] = useState<SubviewDef[]>([]);
  const [subviewForm, setSubviewForm] = useState({ freqStart: 144_000, freqEnd: 174_000 });
  const nextSubviewId = useRef(0);
  const [subviewFlexMap, setSubviewFlexMap] = useState<Record<number, number>>({});
  const subviewsRowRef = useRef<HTMLDivElement>(null);

  const [config, setConfig] = useState<SpectrumConfig | null>(() => {
    const initialData = decodeHydration(generateHydrationPayload());
    return {
      params: {
        freqStart: 25_000,
        resolution: 1500,
        binCount: DEFAULT_BINS,
        rowCount: DEFAULT_ROWS,
      },
      initialData,
    };
  });

  const { frameBuffer, core } = useMemo(() => {
    if (!config) return { frameBuffer: null, core: null };
    const { params, initialData } = config;
    const fb = new FrameBuffer(
      params.rowCount,
      params.binCount,
      initialData?.spectrum,
      initialData?.annotations,
    );
    const c = new SpectrumCore(fb, {
      ...params,
      initialData,
      onDisplayRangeChange: (min, max) => {
        store.set(displayMinAtom, min);
        store.set(displayMaxAtom, max);
      },
      onReset: () => console.log("[spectrum] reset all"),
      onProfileRangeChange: (id, startMHz, endMHz) => {
        setProfileRanges(
          profileRangesRef.current.map((r) =>
            r.id === id ? { ...r, freqStartMHz: startMHz, freqEndMHz: endMHz } : r,
          ),
        );
      },
    });
    return { frameBuffer: fb, core: c };
    // store is stable (created once in storeRef), safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useMockInterval(frameBuffer);
  useSpectrumCoreBridge(store, core);

  useEffect(() => {
    if (!core || !config) return;
    const { freqStart, binCount, resolution } = config.params;
    const globalSpan = binCount * resolution;
    core.setSubviewHighlights(
      subviewDefs.map((def, i) => ({
        normalizedStart: (def.freqStart - freqStart) / globalSpan,
        normalizedEnd: (def.freqEnd - freqStart) / globalSpan,
        color: SUBVIEW_PALETTE[i % SUBVIEW_PALETTE.length].band,
      })),
    );
  }, [subviewDefs, core, config]);

  // Keep flex map in sync with subviewDefs: new ids get the average flex of existing ones
  // so a freshly added subview starts at equal share; removed ids are dropped.
  useEffect(() => {
    setSubviewFlexMap((prev) => {
      const vals = Object.values(prev);
      const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 1;
      const next: Record<number, number> = {};
      for (const def of subviewDefs) next[def.id] = prev[def.id] ?? avg;
      return next;
    });
  }, [subviewDefs]);

  const HANDLE_WIDTH_PX = 10;
  const MIN_SUBVIEW_WIDTH_PX = 288; // 18rem

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>, leftIdx: number) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    document.body.style.userSelect = "none";

    const startX = e.clientX;
    const container = subviewsRowRef.current;
    if (!container) return;

    const cs = getComputedStyle(container);
    const availW =
      container.clientWidth -
      parseFloat(cs.paddingLeft) -
      parseFloat(cs.paddingRight) -
      (subviewDefs.length - 1) * HANDLE_WIDTH_PX;

    const startFlexes = subviewDefs.map((def) => subviewFlexMap[def.id] ?? 1);
    const totalFlex = startFlexes.reduce((a, b) => a + b, 0);
    const minFlex = (MIN_SUBVIEW_WIDTH_PX / availW) * totalFlex;
    const leftId = subviewDefs[leftIdx].id;
    const rightId = subviewDefs[leftIdx + 1].id;

    const onMove = (me: PointerEvent) => {
      const raw = ((me.clientX - startX) / availW) * totalFlex;
      const delta = Math.max(
        -(startFlexes[leftIdx] - minFlex),
        Math.min(startFlexes[leftIdx + 1] - minFlex, raw),
      );
      setSubviewFlexMap((prev) => ({
        ...prev,
        [leftId]: startFlexes[leftIdx] + delta,
        [rightId]: startFlexes[leftIdx + 1] - delta,
      }));
    };

    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      document.body.style.userSelect = "";
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp, { once: true });
  };

  const handleRehydrate = () => {
    const newData = decodeHydration(generateHydrationPayload());
    store.set(occupancyThresholdAtom, newData.occupancy.threshold);
    setConfig((prev) => (prev ? { params: prev.params, initialData: newData } : null));
  };

  const colorMap = useAtomValue(colorMapAtom);
  const setColorMap = useSetAtom(colorMapAtom);
  const layerVisibility = useAtomValue(layerVisibilityAtom);
  const setLayerVisibility = useSetAtom(layerVisibilityAtom);
  const avgTau = useAtomValue(avgTauAtom);
  const setAvgTau = useSetAtom(avgTauAtom);
  const occupancyThreshold = useAtomValue(occupancyThresholdAtom);
  const setOccupancyThreshold = useSetAtom(occupancyThresholdAtom);
  const bands = useAtomValue(bandsAtom);
  const setBands = useSetAtom(bandsAtom);

  useEffect(() => {
    setBands(DEMO_BANDS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleLayerToggle = (id: LayerName, visible: boolean) =>
    setLayerVisibility((prev) => ({ ...prev, [id]: visible }));

  return (
    <div className={styles.root}>
      <div className={styles.controlsRow}>
        {Object.entries(COLORMAP_NAMES).map(([key, name]) => (
          <button
            key={key}
            onClick={() => setColorMap(Number(key))}
            className={colorMap === Number(key) ? styles.button.active : styles.button.inactive}
          >
            {name}
          </button>
        ))}
        <div className={styles.separator} />
        {LAYERS.map(({ id, label, color }) => {
          const active = layerVisibility[id] ?? true;
          return (
            <button
              key={id}
              onClick={() => handleLayerToggle(id, !active)}
              className={active ? styles.button.active : styles.button.inactive}
              style={active ? { borderColor: color, color } : undefined}
            >
              {label}
            </button>
          );
        })}
        {(layerVisibility.avg ?? true) && (
          <>
            <div className={styles.tauControls}>
              <span className={styles.tauLabel}>τ</span>
              {AVG_TAU_STEPS.map((step) => (
                <button
                  key={step}
                  onClick={() => setAvgTau(step)}
                  className={avgTau === step ? styles.button.active : styles.button.inactive}
                  style={avgTau === step ? { borderColor: "#fabe28", color: "#fabe28" } : undefined}
                >
                  {AVG_TAU_LABELS[step]}
                </button>
              ))}
            </div>
          </>
        )}
        <div className={styles.separator} />
        <button onClick={() => core?.resetAll()} className={styles.button.inactive}>
          Reset
        </button>
        <button
          onClick={() => {
            const snapshot = core?.takeMaxSnapshot();
            if (snapshot) console.log("[spectrum] snapshot taken", snapshot.length, "bins");
            setLayerVisibility((prev) => ({ ...prev, maxSnapshot: true }));
          }}
          className={styles.button.inactive}
        >
          Snapshot
        </button>
        <div className={styles.separator} />
        <div className={styles.separator} />
        <button onClick={handleRehydrate} className={styles.button.inactive}>
          Re-hydrate
        </button>
        <div className={styles.separator} />
        <button
          onClick={() => setProfileDrawerOpen(true)}
          className={profileRanges.length > 0 ? styles.button.active : styles.button.inactive}
        >
          Profiles {profileRanges.length > 0 ? `(${profileRanges.length})` : ""}
        </button>
        <div className={styles.separator} />
        <span className={styles.occLabel}>zoom</span>
        <input
          type="number"
          value={subviewForm.freqStart}
          onChange={(e) => setSubviewForm((p) => ({ ...p, freqStart: Number(e.target.value) }))}
          className={styles.numberInput}
          style={{ width: "6rem" }}
        />
        <span className={styles.occLabel}>–</span>
        <input
          type="number"
          value={subviewForm.freqEnd}
          onChange={(e) => setSubviewForm((p) => ({ ...p, freqEnd: Number(e.target.value) }))}
          className={styles.numberInput}
          style={{ width: "6rem" }}
        />
        <span className={styles.occLabel}>kHz</span>
        <button
          onClick={() => {
            if (!core) return;
            setSubviewDefs((prev) => [...prev, { id: nextSubviewId.current++, ...subviewForm }]);
          }}
          className={styles.button.inactive}
        >
          Add zoom
        </button>
        <div className={styles.separator} />
        <span className={styles.occLabel}>occ thr</span>
        <input
          type="number"
          value={occupancyThreshold}
          onChange={(e) => setOccupancyThreshold(Number(e.target.value))}
          min={POWER_FLOOR}
          max={POWER_CEILING}
          step={1}
          className={styles.numberInput}
        />
        <span className={styles.occLabel}>dBm</span>
      </div>
      <div className={styles.controlsRow}>
        {(
          [
            { key: "freqStart" as const, label: "freqStart (kHz)" },
            { key: "resolution" as const, label: "resolution (kHz/bin)" },
            { key: "binCount" as const, label: "binCount" },
            { key: "rowCount" as const, label: "rowCount" },
          ] as const
        ).map(({ key, label }) => (
          <label
            key={key}
            className={styles.occLabel}
            style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}
          >
            {label}
            <input
              type="number"
              value={paramsForm[key]}
              onChange={(e) => setParamsForm((p) => ({ ...p, [key]: Number(e.target.value) }))}
              className={styles.numberInput}
              style={{ width: "7rem" }}
            />
          </label>
        ))}
        <button onClick={() => setConfig({ params: paramsForm })} className={styles.button.active}>
          Apply params
        </button>
        <button onClick={() => setConfig(null)} className={styles.button.inactive}>
          Clear
        </button>
      </div>
      <div className={styles.spectrumContainer}>
        {core && <Spectrum core={core} profileRanges={profileRanges} bands={bands} />}
      </div>
      {profileDrawerOpen && (
        <>
          <div className={styles.drawerOverlay} onClick={() => setProfileDrawerOpen(false)} />
          <div className={styles.drawer}>
            <div className={styles.drawerHeader}>
              <span className={styles.drawerTitle}>Profile Ranges</span>
              <button
                className={styles.button.inactive}
                onClick={() => setProfileDrawerOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className={styles.drawerBody}>
              {config && (
                <ProfilePanel
                  ranges={profileRanges}
                  freqStartMHz={config.params.freqStart / 1000}
                  freqEndMHz={
                    (config.params.freqStart + config.params.binCount * config.params.resolution) /
                    1000
                  }
                  onChange={setProfileRanges}
                />
              )}
            </div>
          </div>
        </>
      )}
      {core && subviewDefs.length > 0 && (
        <div className={styles.subviewsRow} ref={subviewsRowRef}>
          {subviewDefs.flatMap((def, i) => {
            const { accent } = SUBVIEW_PALETTE[i % SUBVIEW_PALETTE.length];
            const elements = [];
            if (i > 0) {
              elements.push(
                <div
                  key={`handle-${def.id}`}
                  className={styles.resizeHandle}
                  onPointerDown={(e) => handleResizePointerDown(e, i - 1)}
                >
                  <div className={styles.resizeHandleBar} />
                </div>,
              );
            }
            elements.push(
              <div
                key={def.id}
                className={styles.subviewWrapper}
                style={{ borderTop: `2px solid ${accent}`, flex: subviewFlexMap[def.id] ?? 1 }}
              >
                <div className={styles.subviewHeader}>
                  <span style={{ color: accent }}>
                    {(def.freqStart / 1000).toFixed(0)}–{(def.freqEnd / 1000).toFixed(0)} MHz
                  </span>
                  <button
                    onClick={() => setSubviewDefs((prev) => prev.filter((d) => d.id !== def.id))}
                    className={styles.button.inactive}
                  >
                    ✕
                  </button>
                </div>
                <SpectrumSubview core={core} freqStart={def.freqStart} freqEnd={def.freqEnd} />
              </div>,
            );
            return elements;
          })}
        </div>
      )}
    </div>
  );
};

const App = () => {
  const storeRef = useRef<SpectrumStore | null>(null);
  if (!storeRef.current) storeRef.current = createSpectrumStore();
  const store = storeRef.current;

  return (
    <Provider store={store}>
      <AppInner store={store} />
    </Provider>
  );
};

export default App;
