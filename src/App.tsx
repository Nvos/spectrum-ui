import { useAtomValue, useSetAtom } from "jotai";
import { Provider } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as styles from "./App.css";
import { COLORMAP_NAMES, FrameBuffer, POWER_CEILING, POWER_FLOOR, Spectrum, SpectrumCore } from "./Spectrum";
import type { SpectrumInitialData } from "./Spectrum";
import { generateHydrationPayload, generateLiveFrame, MOCK_BIN_COUNT, TICK_MS } from "./Spectrum/core/mock";
import type { HydrationPayload } from "./Spectrum/core/mock";
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

const DEFAULT_BINS = 2000;
const DEFAULT_ROWS = 300;

const decodeHydration = (payload: HydrationPayload): SpectrumInitialData => {
  const { binCount, spectrum, annotations } = payload;
  const count = spectrum.count;

  const tsBuf = new Uint8Array(count * 4);
  tsBuf.setFromBase64(payload.timestamps);
  const timestamps = Array.from(new Uint32Array(tsBuf.buffer));

  const specBuf = new Uint8Array(count * binCount);
  specBuf.setFromBase64(spectrum.rows);

  const annBuf = new Uint8Array(count * binCount);
  annBuf.setFromBase64(annotations.rows);

  const maxHoldBuf = new Uint8Array(binCount);
  maxHoldBuf.setFromBase64(payload.maxHold);

  const occBuf = new Uint8Array(binCount * 4);
  occBuf.setFromBase64(payload.occupancy.values);

  return {
    spectrum: { rows: new Int8Array(specBuf.buffer), count, timestamps },
    annotations: { rows: new Int8Array(annBuf.buffer), count, timestamps },
    maxHold: new Int8Array(maxHoldBuf.buffer),
    occupancy: { values: new Float32Array(occBuf.buffer), total: payload.occupancy.total },
  };
};

const LAYERS: { id: LayerName; label: string; color: string }[] = [
  { id: "live", label: "Live", color: "#4ade80" },
  { id: "avg", label: "Average", color: "#fabe28" },
  { id: "max", label: "Max Hold", color: "#ff5050" },
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

const makeMockFrameBuffer = (data: SpectrumInitialData): FrameBuffer =>
  new FrameBuffer(DEFAULT_ROWS, DEFAULT_BINS, data.spectrum, data.annotations);

const useMockInterval = (frameBuffer: FrameBuffer) => {
  const frameBytesRef = useRef(new Uint8Array(4 + 2 * DEFAULT_BINS));

  const processFrame = useCallback((frame: string) => {
    frameBytesRef.current.setFromBase64(frame);
    const bytes = frameBytesRef.current;
    const dv = new DataView(bytes.buffer);
    const waterfallLen = dv.getUint16(0, true);
    const annotationLen = dv.getUint16(2, true);
    const waterfallRow = new Int8Array(bytes.buffer, 4, waterfallLen);
    const annotationRow = new Int8Array(bytes.buffer, 4 + waterfallLen, annotationLen);
    frameBuffer.push(waterfallRow, annotationRow);
  }, [frameBuffer]);

  useEffect(() => {
    let handle: ReturnType<typeof setInterval> | null = null;
    const start = () => { handle = setInterval(() => processFrame(generateLiveFrame(MOCK_BIN_COUNT)), TICK_MS); };
    const stop = () => { if (handle !== null) { clearInterval(handle); handle = null; } };
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [processFrame]);
};

// Bridges Jotai atoms → SpectrumCore imperative API.
// Runs once per (store, core) pair; re-runs when core changes (re-hydrate).
const useSpectrumCoreBridge = (store: SpectrumStore, core: SpectrumCore) => {
  useEffect(() => {
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
    return () => { for (const u of unsubs) u(); };
  }, [store, core]);
};

// Inner component — lives inside <Provider store={store}> so atom hooks work.
const AppInner = ({ store }: { store: SpectrumStore }) => {
  const [initialData, setInitialData] = useState<SpectrumInitialData>(() =>
    decodeHydration(generateHydrationPayload()),
  );
  const [frameBuffer, setFrameBuffer] = useState<FrameBuffer>(() => makeMockFrameBuffer(initialData));
  const [hydrationKey, setHydrationKey] = useState(0);

  useMockInterval(frameBuffer);

  const core = useMemo(
    () =>
      new SpectrumCore(frameBuffer, {
        freqStart: 20_000,
        resolution: 200,
        binCount: DEFAULT_BINS,
        rowCount: DEFAULT_ROWS,
        initialData,
        onDisplayRangeChange: (min, max) => {
          store.set(displayMinAtom, min);
          store.set(displayMaxAtom, max);
        },
      }),
    // store is stable (created once in storeRef), safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frameBuffer, initialData],
  );

  useSpectrumCoreBridge(store, core);

  const handleRehydrate = () => {
    const newData = decodeHydration(generateHydrationPayload());
    setInitialData(newData);
    setFrameBuffer(makeMockFrameBuffer(newData));
    setHydrationKey((k) => k + 1);
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
        <button onClick={() => core.resetMaxHold()} className={styles.button.inactive}>
          Reset Max
        </button>
        <button onClick={() => core.resetOccupancy()} className={styles.button.inactive}>
          Reset Occ
        </button>
        <div className={styles.separator} />
        <div className={styles.separator} />
        <button onClick={handleRehydrate} className={styles.button.inactive}>
          Re-hydrate
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
      <div className={styles.spectrumContainer}>
        <Spectrum key={hydrationKey} core={core} />
      </div>
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
