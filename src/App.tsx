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
  { band: "rgba(255, 180, 50, 0.18)",  accent: "#ffb432" },
  { band: "rgba(180, 130, 255, 0.18)", accent: "#b482ff" },
  { band: "rgba(100, 255, 160, 0.18)", accent: "#64ffa0" },
  { band: "rgba(255, 100, 130, 0.18)", accent: "#ff6482" },
];

const DEFAULT_BINS = 2000;
const DEFAULT_ROWS = 300;

const DEMO_BANDS: Band[] = [
  // ── HF / VHF low (25–88 MHz) — sparse single-row baseline ───────
  { id: "vhf-gov",      name: "VHF Gov/Mil",       freqStartMHz: 25,     freqEndMHz: 50,     color: "#636e72" },
  { id: "6m",           name: "6m Amateur",         freqStartMHz: 50,     freqEndMHz: 54,     color: "#a29bfe" },
  { id: "vhf-tv-lo",    name: "VHF TV Low",         freqStartMHz: 54,     freqEndMHz: 72,     color: "#b2bec3" },
  { id: "rc",           name: "RC Aircraft",        freqStartMHz: 72,     freqEndMHz: 76,     color: "#fd79a8" },
  { id: "vhf-tv-hi",    name: "VHF TV High",        freqStartMHz: 76,     freqEndMHz: 88,     color: "#dfe6e9" },
  // ── VHF stress zone: all 3 rows + 1 overflow (87.5–175 MHz) ─────
  // Row 0: fm → ils → pager → marine
  // Row 1: airband → pub-safety
  // Row 2: guard → aprs → ch16 → noaa
  // Overflow: vhf156-8 (sub-channel inside ch16 — 4th nesting level)
  { id: "fm",           name: "FM Broadcast",       freqStartMHz: 87.5,   freqEndMHz: 108,    color: "#ff6b6b" },
  { id: "ils",          name: "ILS / VOR",          freqStartMHz: 108,    freqEndMHz: 118,    color: "#ffeaa7" },
  { id: "airband",      name: "Airband",            freqStartMHz: 108,    freqEndMHz: 137,    color: "#4ecdc4" },
  { id: "guard",        name: "Guard 121.5",        freqStartMHz: 121.4,  freqEndMHz: 121.6,  color: "#ff7675" },
  { id: "mil-air",      name: "Military Air",       freqStartMHz: 132,    freqEndMHz: 144,    color: "#e17055" },
  { id: "2m",           name: "2m Amateur",         freqStartMHz: 144,    freqEndMHz: 148,    color: "#74b9ff" },
  { id: "aprs",         name: "APRS 144.8",         freqStartMHz: 144.7,  freqEndMHz: 144.9,  color: "#0984e3" },
  { id: "pager",        name: "Paging",             freqStartMHz: 148,    freqEndMHz: 152,    color: "#fdcb6e" },
  { id: "pub-safety",   name: "Public Safety",      freqStartMHz: 150,    freqEndMHz: 174,    color: "#e84393" },
  { id: "marine",       name: "VHF Marine",         freqStartMHz: 156,    freqEndMHz: 174,    color: "#45b7d1" },
  { id: "ch16",         name: "Distress Ch.16",     freqStartMHz: 156.7,  freqEndMHz: 156.9,  color: "#d63031" },
  { id: "vhf156-8",     name: "VHF 156.8",          freqStartMHz: 156.79, freqEndMHz: 156.81, color: "#ff7675" },
  { id: "noaa",         name: "NOAA Weather",       freqStartMHz: 162.4,  freqEndMHz: 162.6,  color: "#00b894" },
  // ── DAB / UHF (174–500 MHz) ──────────────────────────────────────
  { id: "dab",          name: "DAB+ Band III",      freqStartMHz: 174,    freqEndMHz: 230,    color: "#96ceb4" },
  { id: "1-25m",        name: "1.25m Amateur",      freqStartMHz: 220,    freqEndMHz: 225,    color: "#55efc4" },
  { id: "mil-uhf",      name: "Military UHF",       freqStartMHz: 225,    freqEndMHz: 380,    color: "#576574" },
  { id: "tetra-lo",     name: "TETRA (lo)",         freqStartMHz: 380,    freqEndMHz: 390,    color: "#ff9f43" },
  { id: "tetra-hi",     name: "TETRA (hi)",         freqStartMHz: 390,    freqEndMHz: 400,    color: "#e67e22" },
  { id: "gov-uhf",      name: "Gov UHF",            freqStartMHz: 400,    freqEndMHz: 406,    color: "#81ecec" },
  { id: "70cm",         name: "70cm Amateur",       freqStartMHz: 430,    freqEndMHz: 440,    color: "#a29bfe" },
  { id: "drone-433",    name: "Drone 433 ISM",      freqStartMHz: 433.05, freqEndMHz: 434.79, color: "#1dd1a1" },
  { id: "pmr446",       name: "PMR 446",            freqStartMHz: 446,    freqEndMHz: 446.2,  color: "#fd79a8" },
  // ── Cellular 700 MHz — wide + UL/DL sub-bands ────────────────────
  { id: "cell-700",     name: "700 MHz LTE",        freqStartMHz: 703,    freqEndMHz: 803,    color: "#00cec9" },
  { id: "cell-700-ul",  name: "700 UL",             freqStartMHz: 703,    freqEndMHz: 748,    color: "#81ecec" },
  { id: "cell-700-dl",  name: "700 DL",             freqStartMHz: 758,    freqEndMHz: 803,    color: "#74b9ff" },
  // ── Cellular 850 / GSM 900 — overlapping allocations ─────────────
  { id: "gsm850",       name: "GSM 850",            freqStartMHz: 824,    freqEndMHz: 894,    color: "#e17055" },
  { id: "gsm850-ul",    name: "GSM 850 UL",         freqStartMHz: 824,    freqEndMHz: 849,    color: "#fd79a8" },
  { id: "gsm850-dl",    name: "GSM 850 DL",         freqStartMHz: 869,    freqEndMHz: 894,    color: "#ff7675" },
  { id: "drone-868",    name: "Drone 868 SRD",      freqStartMHz: 863,    freqEndMHz: 870,    color: "#1dd1a1" },
  { id: "gsm900",       name: "GSM 900",            freqStartMHz: 880,    freqEndMHz: 960,    color: "#e84393" },
  { id: "gsm900-ul",    name: "GSM 900 UL",         freqStartMHz: 880,    freqEndMHz: 915,    color: "#a29bfe" },
  { id: "gsm900-dl",    name: "GSM 900 DL",         freqStartMHz: 925,    freqEndMHz: 960,    color: "#6c5ce7" },
  { id: "drone-915",    name: "Drone 915 ISM",      freqStartMHz: 902,    freqEndMHz: 928,    color: "#1dd1a1" },
  // ── L-Band / GPS — wide + narrow sub-channels ────────────────────
  { id: "l-band",       name: "L-Band Nav",         freqStartMHz: 960,    freqEndMHz: 1215,   color: "#636e72" },
  { id: "gps-l1",       name: "GPS L1",             freqStartMHz: 1572.4, freqEndMHz: 1576.4, color: "#ffeaa7" },
  { id: "glonass-l1",   name: "GLONASS L1",         freqStartMHz: 1593,   freqEndMHz: 1610,   color: "#fdcb6e" },
  { id: "fpv-1200",     name: "FPV 1.2 GHz",        freqStartMHz: 1080,   freqEndMHz: 1360,   color: "#f9ca24" },
  // ── DCS 1800 with UL/DL (1710–1880 MHz) ──────────────────────────
  { id: "dcs1800",      name: "DCS 1800",           freqStartMHz: 1710,   freqEndMHz: 1880,   color: "#a29bfe" },
  { id: "dcs1800-ul",   name: "DCS 1800 UL",        freqStartMHz: 1710,   freqEndMHz: 1785,   color: "#6c5ce7" },
  { id: "dcs1800-dl",   name: "DCS 1800 DL",        freqStartMHz: 1805,   freqEndMHz: 1880,   color: "#fdcb6e" },
  // ── UMTS 2100 with UL/DL (1920–2170 MHz) ─────────────────────────
  { id: "umts2100",     name: "UMTS 2100",          freqStartMHz: 1920,   freqEndMHz: 2170,   color: "#4ecdc4" },
  { id: "umts-ul",      name: "UMTS UL",            freqStartMHz: 1920,   freqEndMHz: 1980,   color: "#55efc4" },
  { id: "umts-dl",      name: "UMTS DL",            freqStartMHz: 2110,   freqEndMHz: 2170,   color: "#00b894" },
  // ── WiFi 2.4 GHz zone: all 3 rows + 1 overflow (2400–2500 MHz) ───
  // Row 0: ISM 2.4 GHz (wide)
  // Row 1: WiFi Ch.1 → Ch.6 → Ch.11 (non-overlapping)
  // Row 2: Bluetooth (overlaps all WiFi channels)
  // Overflow: WiFi 802.11n (blocked by all 3 rows)
  { id: "ism-24",       name: "ISM 2.4 GHz",        freqStartMHz: 2400,   freqEndMHz: 2500,   color: "#ffeaa7" },
  { id: "wifi-ch1",     name: "WiFi Ch.1",          freqStartMHz: 2401,   freqEndMHz: 2423,   color: "#ff6b6b" },
  { id: "bluetooth",    name: "Bluetooth",          freqStartMHz: 2402,   freqEndMHz: 2480,   color: "#6c5ce7" },
  { id: "wifi-80211n",  name: "WiFi 802.11n",       freqStartMHz: 2412,   freqEndMHz: 2462,   color: "#b2bec3" },
  { id: "wifi-ch6",     name: "WiFi Ch.6",          freqStartMHz: 2426,   freqEndMHz: 2448,   color: "#00b894" },
  { id: "wifi-ch11",    name: "WiFi Ch.11",         freqStartMHz: 2451,   freqEndMHz: 2473,   color: "#e84393" },
  // ── LTE 2600 with UL/DL (2500–2690 MHz) ──────────────────────────
  { id: "lte-2600",     name: "LTE B7 2600",        freqStartMHz: 2500,   freqEndMHz: 2690,   color: "#96ceb4" },
  { id: "lte-2600-ul",  name: "LTE B7 UL",          freqStartMHz: 2500,   freqEndMHz: 2570,   color: "#55efc4" },
  { id: "lte-2600-dl",  name: "LTE B7 DL",          freqStartMHz: 2620,   freqEndMHz: 2690,   color: "#00cec9" },
  // ── 5G NR n77 — wide band at right edge ──────────────────────────
  { id: "5g-n77",       name: "5G NR n77",          freqStartMHz: 2690,   freqEndMHz: 3025,   color: "#6c5ce7" },
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
        setProfileRanges(profileRangesRef.current.map((r) =>
          r.id === id ? { ...r, freqStartMHz: startMHz, freqEndMHz: endMHz } : r,
        ));
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
    setSubviewFlexMap(prev => {
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
    const availW = container.clientWidth
      - parseFloat(cs.paddingLeft)
      - parseFloat(cs.paddingRight)
      - (subviewDefs.length - 1) * HANDLE_WIDTH_PX;

    const startFlexes = subviewDefs.map(def => subviewFlexMap[def.id] ?? 1);
    const totalFlex = startFlexes.reduce((a, b) => a + b, 0);
    const minFlex = (MIN_SUBVIEW_WIDTH_PX / availW) * totalFlex;
    const leftId = subviewDefs[leftIdx].id;
    const rightId = subviewDefs[leftIdx + 1].id;

    const onMove = (me: PointerEvent) => {
      const raw = ((me.clientX - startX) / availW) * totalFlex;
      const delta = Math.max(-(startFlexes[leftIdx] - minFlex), Math.min(startFlexes[leftIdx + 1] - minFlex, raw));
      setSubviewFlexMap(prev => ({
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
      <div className={styles.spectrumContainer}>{core && <Spectrum core={core} profileRanges={profileRanges} bands={bands} />}</div>
      {profileDrawerOpen && (
        <>
          <div className={styles.drawerOverlay} onClick={() => setProfileDrawerOpen(false)} />
          <div className={styles.drawer}>
            <div className={styles.drawerHeader}>
              <span className={styles.drawerTitle}>Profile Ranges</span>
              <button className={styles.button.inactive} onClick={() => setProfileDrawerOpen(false)}>✕</button>
            </div>
            <div className={styles.drawerBody}>
              {config && (
                <ProfilePanel
                  ranges={profileRanges}
                  freqStartMHz={config.params.freqStart / 1000}
                  freqEndMHz={(config.params.freqStart + config.params.binCount * config.params.resolution) / 1000}
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
                </div>
              );
            }
            elements.push(
              <div
                key={def.id}
                className={styles.subviewWrapper}
                style={{ borderTop: `2px solid ${accent}`, flex: subviewFlexMap[def.id] ?? 1 }}
              >
                <div className={styles.subviewHeader}>
                  <span style={{ color: accent }}>{(def.freqStart / 1000).toFixed(0)}–{(def.freqEnd / 1000).toFixed(0)} MHz</span>
                  <button
                    onClick={() => setSubviewDefs((prev) => prev.filter((d) => d.id !== def.id))}
                    className={styles.button.inactive}
                  >
                    ✕
                  </button>
                </div>
                <SpectrumSubview core={core} freqStart={def.freqStart} freqEnd={def.freqEnd} />
              </div>
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
