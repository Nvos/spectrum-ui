import { useCallback, useEffect, useRef, useState } from "react";
import * as styles from "../../App.css";
import { ColorMap, COLORMAP_NAMES, FrameBuffer, POWER_CEILING, POWER_FLOOR, Spectrum } from "../../Spectrum";
import type { SpectrumHandle, SpectrumInitialData } from "../../Spectrum";
import type { HydrationPayload } from "../../Spectrum/mock";

// ---------------------------------------------------------------------------
// Endpoints — replace with real backend URLs before deploying
// ---------------------------------------------------------------------------
const HYDRATION_ENDPOINT = "/api/spectrum/hydrate";
const SSE_ENDPOINT = "/api/spectrum/stream";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_BINS = 2000;
const DEFAULT_ROWS = 300;

const LAYERS: { id: string; label: string; color: string }[] = [
  { id: "avg", label: "Average", color: "#fabe28" },
  { id: "max", label: "Max Hold", color: "#ff5050" },
];

const AVG_TAU_STEPS = [500, 1000, 2000, 5000, 10_000];
const AVG_TAU_LABELS: Record<number, string> = {
  500: "0.5s",
  1000: "1s",
  2000: "2s",
  5000: "5s",
  10000: "10s",
};

// ---------------------------------------------------------------------------
// Hydration decoding
//
// The hydration payload arrives as a JSON object where binary fields are
// base64-encoded.  We decode them here into typed arrays before constructing
// the FrameBuffer so the initial waterfall/occupancy/max-hold state is
// available from the very first render.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------
type ConnectionState = "connecting" | "connected" | "error" | "disconnected";

// ---------------------------------------------------------------------------
// useSpectrumSSE
//
// Fetches initial hydration data, then opens an SSE connection for live
// frames.  Returns the hydrated FrameBuffer, the decoded initial data (so
// <Spectrum> can seed max-hold / occupancy), and the current connection state.
//
// Lifecycle:
//   1. On mount — fetch hydration → decode → create FrameBuffer → open SSE.
//   2. SSE "frame" event — parse binary frame → frameBuffer.push(spec, ann).
//   3. Page hidden  — close SSE to avoid buffering frames off-screen.
//   4. Page visible — re-hydrate then open SSE from the new lastTimestamp.
//                     Resuming SSE from the old timestamp after a long idle
//                     would cause the server to replay an unbounded backlog of
//                     frames that would flood the ring buffer and freeze the
//                     event loop.  Re-hydrating is safe regardless of how long
//                     the tab was away.
//   5. Unmount     — close SSE and abort any in-flight fetch.
// ---------------------------------------------------------------------------
const useSpectrumSSE = (): {
  frameBuffer: FrameBuffer | null;
  initialData: SpectrumInitialData | null;
  connectionState: ConnectionState;
  hydrationKey: number;
} => {
  const [frameBuffer, setFrameBuffer] = useState<FrameBuffer | null>(null);
  const [initialData, setInitialData] = useState<SpectrumInitialData | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [hydrationKey, setHydrationKey] = useState(0);

  // Keep a stable ref to FrameBuffer so the SSE handler closure never stales.
  const frameBufferRef = useRef<FrameBuffer | null>(null);
  // Reusable decode buffer — sized for the max expected frame (4-byte header + 2 rows).
  const frameBytesRef = useRef(new Uint8Array(4 + 2 * DEFAULT_BINS));
  const sseRef = useRef<EventSource | null>(null);
  // Abort controller for any in-flight hydration fetch (initial or reconnect).
  const hydrateAbortRef = useRef<AbortController | null>(null);

  const openSSE = useCallback((since: number) => {
    sseRef.current?.close();

    setConnectionState("connecting");
    const url = `${SSE_ENDPOINT}?since=${since}`;
    const es = new EventSource(url);
    sseRef.current = es;

    es.addEventListener("open", () => {
      setConnectionState("connected");
    });

    // Each SSE "frame" event carries a base64-encoded binary payload with the
    // same wire format as generateLiveFrame():
    //   [waterfallLen: u16le][annotationLen: u16le][waterfallBytes...][annotationBytes...]
    es.addEventListener("frame", (e: MessageEvent<string>) => {
      const fb = frameBufferRef.current;
      if (!fb) return;

      const bytes = frameBytesRef.current;
      bytes.setFromBase64(e.data);
      const dv = new DataView(bytes.buffer);
      const waterfallLen = dv.getUint16(0, true);
      const annotationLen = dv.getUint16(2, true);
      const waterfallRow = new Int8Array(bytes.buffer, 4, waterfallLen);
      const annotationRow = new Int8Array(bytes.buffer, 4 + waterfallLen, annotationLen);
      fb.push(waterfallRow, annotationRow);
    });

    es.addEventListener("error", () => {
      setConnectionState("error");
      es.close();
      sseRef.current = null;
    });
  }, []);

  const hydrate = useCallback(
    async (signal: AbortSignal) => {
      console.log('hydrating')
      setConnectionState("connecting");
      const res = await fetch(HYDRATION_ENDPOINT, { signal });
      if (!res.ok) throw new Error(`Hydration failed: ${res.status}`);
      const payload: HydrationPayload = await res.json();
      const decoded = decodeHydration(payload);

      const fb = new FrameBuffer(
        DEFAULT_ROWS,
        payload.binCount,
        decoded.spectrum,
        decoded.annotations,
      );

      frameBufferRef.current = fb;
      setInitialData(decoded);
      setFrameBuffer(fb);
      setHydrationKey((k) => k + 1);
      openSSE(payload.lastTimestamp);
    },
    [openSSE],
  );

  // Initial hydration on mount.
  useEffect(() => {
    const controller = new AbortController();
    hydrateAbortRef.current = controller;

    hydrate(controller.signal).catch((err) => {
      if ((err as Error).name !== "AbortError") {
        console.error("hydration error", err);
        setConnectionState("error");
      }
    });

    return () => {
      controller.abort();
    };
  }, [hydrate]);

  // Re-hydrate when the page becomes visible again after being hidden.
  // This safely handles any idle duration without replaying a large backlog.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        hydrateAbortRef.current?.abort();
        sseRef.current?.close();
        sseRef.current = null;
        setConnectionState("disconnected");
      } else {
        const controller = new AbortController();
        hydrateAbortRef.current = controller;
        hydrate(controller.signal).catch((err) => {
          if ((err as Error).name !== "AbortError") {
            console.error("reconnect hydration error", err);
            setConnectionState("error");
          }
        });
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hydrate]);

  // Close SSE on unmount.
  useEffect(() => {
    return () => {
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, []);

  return { frameBuffer, initialData, connectionState, hydrationKey };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const ConnectionBadge = ({ state }: { state: ConnectionState }) => {
  const colors: Record<ConnectionState, string> = {
    connecting: "rgba(250,190,40,0.8)",
    connected: "rgba(80,200,80,0.8)",
    error: "rgba(255,80,80,0.8)",
    disconnected: "rgba(255,255,255,0.3)",
  };
  return (
    <span
      style={{
        fontSize: "0.75rem",
        fontFamily: "ui-monospace,monospace",
        color: colors[state],
        marginLeft: "0.5rem",
      }}
    >
      {state}
    </span>
  );
}

const SseApp = () => {
  const { frameBuffer, initialData, connectionState, hydrationKey } = useSpectrumSSE();

  const spectrumRef = useRef<SpectrumHandle>(null);
  const [displayMax, setDisplayMax] = useState(-62);
  const [displayMin, setDisplayMin] = useState(-92);
  const [colorMap, setColorMap] = useState<number>(ColorMap.SDR);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({
    avg: true,
    max: true,
  });
  const handleLayerToggle = (id: string, visible: boolean) =>
    setLayerVisibility((prev) => ({ ...prev, [id]: visible }));
  const [avgTau, setAvgTau] = useState(2000);
  const [occupancyThreshold, setOccupancyThreshold] = useState(-82);
  const [annotationsVisible, setAnnotationsVisible] = useState(true);

  if (!frameBuffer || !initialData) {
    return (
      <div className={styles.root} style={{ alignItems: "center", justifyContent: "center" }}>
        <ConnectionBadge state={connectionState} />
      </div>
    );
  }

  // Derive freq bounds from the first hydration payload.
  // These would normally come from the hydration response directly.
  const freqStart = 88_000; // kHz — placeholder, replace with payload.freqStart / 1000
  const resolution = 10; // kHz/bin — placeholder, replace with derived from payload

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
        <button
          onClick={() => setAnnotationsVisible((v) => !v)}
          className={annotationsVisible ? styles.button.active : styles.button.inactive}
        >
          Annotations
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
        <div className={styles.separator} />
        <ConnectionBadge state={connectionState} />
      </div>
      <div className={styles.spectrumContainer}>
        <Spectrum
          key={hydrationKey}
          ref={spectrumRef}
          colorMap={colorMap}
          displayMin={displayMin}
          onDisplayMinChange={setDisplayMin}
          displayMax={displayMax}
          freqStart={freqStart}
          resolution={resolution}
          frameBuffer={frameBuffer}
          initialData={initialData}
          binCount={DEFAULT_BINS}
          rowCount={DEFAULT_ROWS}
          layerVisibility={layerVisibility}
          avgTau={avgTau}
          occupancyThreshold={occupancyThreshold}
          annotationsVisible={annotationsVisible}
          onDisplayMaxChange={setDisplayMax}
        />
      </div>
    </div>
  );
};

export default SseApp;
