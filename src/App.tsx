import { useAtomValue, useSetAtom } from "jotai";
import { Provider } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import * as styles from "./App.css";
import { COLORMAP_NAMES, FrameBuffer, POWER_CEILING, POWER_FLOOR, Spectrum } from "./Spectrum";
import type { SpectrumHandle, SpectrumInitialData } from "./Spectrum";
import { generateHydrationPayload, generateLiveFrame, MOCK_BIN_COUNT, TICK_MS } from "./Spectrum/mock";
import type { HydrationPayload } from "./Spectrum/mock";
import {
  avgTauAtom,
  colorMapAtom,
  createSpectrumStore,
  layerVisibilityAtom,
  occupancyThresholdAtom,
} from "./Spectrum/store";
import type { LayerName, SpectrumStore } from "./Spectrum/store";

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
}

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

// Drives the mock interval, always pushing into whichever FrameBuffer is current.
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
}

// Inner component — lives inside <Provider store={store}> so atom hooks work.
const AppInner = ({ store }: { store: SpectrumStore }) => {
  const [initialData, setInitialData] = useState<SpectrumInitialData>(() =>
    decodeHydration(generateHydrationPayload()),
  );
  const [frameBuffer, setFrameBuffer] = useState<FrameBuffer>(() => makeMockFrameBuffer(initialData));
  const [hydrationKey, setHydrationKey] = useState(0);

  useMockInterval(frameBuffer);

  const handleRehydrate = () => {
    const newData = decodeHydration(generateHydrationPayload());
    setInitialData(newData);
    setFrameBuffer(makeMockFrameBuffer(newData));
    setHydrationKey((k) => k + 1);
  };

  const spectrumRef = useRef<SpectrumHandle>(null);
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
        <button
          onClick={() => spectrumRef.current?.resetMaxHold()}
          className={styles.button.inactive}
        >
          Reset Max
        </button>
        <button
          onClick={() => spectrumRef.current?.resetOccupancy()}
          className={styles.button.inactive}
        >
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
        <Spectrum
          key={hydrationKey}
          ref={spectrumRef}
          store={store}
          frameBuffer={frameBuffer}
          initialData={initialData}
          freqStart={20_000}
          resolution={200}
          binCount={DEFAULT_BINS}
          rowCount={DEFAULT_ROWS}
        />
      </div>
    </div>
  );
}

const App = () => {
  const storeRef = useRef<SpectrumStore | null>(null);
  if (!storeRef.current) storeRef.current = createSpectrumStore();
  const store = storeRef.current;

  return (
    <Provider store={store}>
      <AppInner store={store} />
    </Provider>
  );
}

export default App;
