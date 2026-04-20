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
  colorMapAtom,
  createSpectrumStore,
  displayMaxAtom,
  displayMinAtom,
  layerVisibilityAtom,
  occupancyThresholdAtom,
} from "./Spectrum/react/store";
import type { LayerName, SpectrumStore } from "./Spectrum/react/store";

const SUBVIEW_PALETTE = [
  { band: "rgba(100, 210, 255, 0.18)", accent: "#64d2ff" },
  { band: "rgba(255, 180, 50, 0.18)",  accent: "#ffb432" },
  { band: "rgba(180, 130, 255, 0.18)", accent: "#b482ff" },
  { band: "rgba(100, 255, 160, 0.18)", accent: "#64ffa0" },
  { band: "rgba(255, 100, 130, 0.18)", accent: "#ff6482" },
];

const DEFAULT_BINS = 2000;
const DEFAULT_ROWS = 300;

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
  freqStart: 20_000,
  resolution: 200,
  binCount: DEFAULT_BINS,
  rowCount: DEFAULT_ROWS,
};

// Inner component — lives inside <Provider store={store}> so atom hooks work.
type SubviewDef = { id: number; freqStart: number; freqEnd: number };

const AppInner = ({ store }: { store: SpectrumStore }) => {
  const [paramsForm, setParamsForm] = useState<SpectrumParams>(DEFAULT_PARAMS);
  const [profileRanges, setProfileRanges] = useState<ProfileRange[]>([]);
  const profileRangesRef = useRef(profileRanges);
  profileRangesRef.current = profileRanges;
  const [subviewDefs, setSubviewDefs] = useState<SubviewDef[]>([]);
  const [subviewForm, setSubviewForm] = useState({ freqStart: 96_000, freqEnd: 104_000 });
  const nextSubviewId = useRef(0);

  const [config, setConfig] = useState<SpectrumConfig | null>(() => {
    const initialData = decodeHydration(generateHydrationPayload());
    return {
      params: {
        freqStart: 20_000,
        resolution: 200,
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
      <div className={styles.spectrumContainer}>{core && <Spectrum core={core} profileRanges={profileRanges} />}</div>
      {config && (
        <ProfilePanel
          ranges={profileRanges}
          freqStartMHz={config.params.freqStart / 1000}
          freqEndMHz={(config.params.freqStart + config.params.binCount * config.params.resolution) / 1000}
          onChange={setProfileRanges}
        />
      )}
      {core && subviewDefs.length > 0 && (
        <div className={styles.subviewsRow}>
          {subviewDefs.map((def, i) => {
            const { accent } = SUBVIEW_PALETTE[i % SUBVIEW_PALETTE.length];
            return (
            <div key={def.id} className={styles.subviewWrapper} style={{ borderTop: `2px solid ${accent}` }}>
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
