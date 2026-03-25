import { resizeCanvasToDisplaySize } from "twgl.js";
import { computePowerTicks } from "./powerAxisUtils";
import { POWER_NO_READING } from "./constants";
import type { RingBuffer } from "./RingBuffer";
import type { Viewport } from "./Viewport";
import {
  displayMaxAtom,
  displayMinAtom,
  layerVisibilityAtom,
  type SpectrumStore,
} from "./store";

const ANN_OUTLINE_COLOR = "rgba(0, 0, 0, 0.75)";
const ANN_OUTLINE_WIDTH = 4;
const ANN_COLOR = "rgba(255, 0, 200, 0.95)";
const ANN_WIDTH = 1.5;
const ANN_DASH = [4, 4];

type AnnotationSource = {
  annBuf: RingBuffer;
  rowActivity: Uint8Array;
  rowCount: number;
};

type LayerConfig = {
  data: Int8Array | Float32Array;
  color: string;
  visible: boolean;
  mode: "line" | "fill";
};

export class LiveManager {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private viewport!: Viewport;
  private ringBuffer: RingBuffer;
  private binCount: number;
  private powerMin: number;
  private displayMax: number;
  private layers = new Map<string, LayerConfig>();
  private annotation: AnnotationSource | null = null;
  private liveVisible: boolean;
  private annotationVisible: boolean;
  private unsubscribes: Array<() => void>;

  constructor(binCount: number, buffer: RingBuffer, store: SpectrumStore) {
    this.binCount = binCount;
    this.ringBuffer = buffer;
    this.powerMin = store.get(displayMinAtom);
    this.displayMax = store.get(displayMaxAtom);
    const vis = store.get(layerVisibilityAtom);
    this.liveVisible = vis.live;
    this.annotationVisible = vis.annotations;

    this.unsubscribes = [
      store.sub(displayMinAtom, () =>
        this.updateDisplayMin(store.get(displayMinAtom)),
      ),
      store.sub(displayMaxAtom, () =>
        this.updateDisplayMax(store.get(displayMaxAtom)),
      ),
      store.sub(layerVisibilityAtom, () => {
        const v = store.get(layerVisibilityAtom);
        this.liveVisible = v.live;
        this.annotationVisible = v.annotations;
        for (const [id, visible] of Object.entries(v))
          this.setLayerVisible(id, visible);
        this.render();
      }),
    ];
  }

  destroy() {
    for (const unsub of this.unsubscribes) unsub();
  }

  mount(canvas: HTMLCanvasElement, viewport: Viewport) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context not available");
    this.ctx = ctx;
    this.viewport = viewport;
  }

  // oxlint-disable-next-line max-lines-per-function
  render = () => {
    const {
      canvas,
      ctx,
      viewport,
      ringBuffer,
      binCount,
      powerMin,
      displayMax,
    } = this;

    if (!canvas) {
      console.warn("Canvas not mounted");
      return;
    }

    resizeCanvasToDisplaySize(canvas, window.devicePixelRatio || 1);

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    // --- Grid lines (same positions as PowerAxis ticks) ---
    ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
    ctx.lineWidth = 1;
    for (const { dbm } of computePowerTicks(powerMin, displayMax)) {
      const normY = (dbm - powerMin) / (displayMax - powerMin);
      const y = Math.round((1 - normY) * height) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // --- Spectrum fill + line ---
    const { start, end } = viewport;
    const visibleSpan = end - start;

    const row =
      (ringBuffer.writeRow - 1 + ringBuffer.rowCount) % ringBuffer.rowCount;
    const rowOffset = row * binCount;
    const data = ringBuffer.data;

    const binStart = Math.floor(start * binCount);
    const binEnd = Math.ceil(end * binCount);

    const sampleX = (b: number) =>
      ((b / binCount - start) / visibleSpan) * width;
    const sampleY = (b: number) => {
      const bin = Math.max(0, Math.min(binCount - 1, b));
      // Int8 value is dBm directly
      const dbm = data[rowOffset + bin];
      const t = Math.min(
        1,
        Math.max(0, (dbm - powerMin) / (displayMax - powerMin)),
      );
      return (1 - t) * height;
    };

    // --- Background fill layers (e.g. max hold) — drawn before live fill ---
    for (const layer of this.layers.values()) {
      if (!layer.visible || layer.mode !== "fill") continue;
      const layerData = layer.data;
      const layerSampleY = (b: number) => {
        const bin = Math.max(0, Math.min(binCount - 1, b));
        const dbm = layerData[bin];
        const t = Math.min(
          1,
          Math.max(0, (dbm - powerMin) / (displayMax - powerMin)),
        );
        return (1 - t) * height;
      };
      ctx.beginPath();
      ctx.moveTo(sampleX(binStart), height);
      for (let b = binStart; b <= binEnd; b++)
        ctx.lineTo(sampleX(b), layerSampleY(b));
      ctx.lineTo(sampleX(binEnd), height);
      ctx.closePath();
      ctx.fillStyle = layer.color;
      ctx.fill();
    }

    if (this.liveVisible) {
      // Fill pass — closed polygon from bottom-left → spectrum → bottom-right
      ctx.beginPath();
      ctx.moveTo(sampleX(binStart), height);
      for (let b = binStart; b <= binEnd; b++)
        ctx.lineTo(sampleX(b), sampleY(b));
      ctx.lineTo(sampleX(binEnd), height);
      ctx.closePath();
      ctx.fillStyle = "rgba(74, 222, 128, 0.20)";
      ctx.fill();

      // Stroke pass — top edge only
      ctx.beginPath();
      ctx.strokeStyle = "rgba(74, 222, 128, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      for (let b = binStart; b <= binEnd; b++) {
        if (b === binStart) ctx.moveTo(sampleX(b), sampleY(b));
        else ctx.lineTo(sampleX(b), sampleY(b));
      }
      ctx.stroke();
    }

    // --- Overlay line layers (e.g. avg) — drawn after live fill ---
    for (const layer of this.layers.values()) {
      if (!layer.visible || layer.mode !== "line") continue;
      const layerData = layer.data;
      const layerSampleY = (b: number) => {
        const bin = Math.max(0, Math.min(binCount - 1, b));
        const dbm = layerData[bin];
        const t = Math.min(
          1,
          Math.max(0, (dbm - powerMin) / (displayMax - powerMin)),
        );
        return (1 - t) * height;
      };
      ctx.beginPath();
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      for (let b = binStart; b <= binEnd; b++) {
        if (b === binStart) ctx.moveTo(sampleX(b), layerSampleY(b));
        else ctx.lineTo(sampleX(b), layerSampleY(b));
      }
      ctx.stroke();
    }

    // --- Annotation vertical borders ---
    if (this.annotation && this.annotationVisible) {
      const { annBuf, rowActivity, rowCount } = this.annotation;
      const writeRow = annBuf.writeRow;
      let activeRowIdx = -1;
      for (let di = 0; di < rowCount; di++) {
        const rowIdx = (writeRow - 1 - di + rowCount * 2) % rowCount;
        if (rowActivity[rowIdx]) {
          activeRowIdx = rowIdx;
          break;
        }
      }
      if (activeRowIdx !== -1) {
        const annData = annBuf.data;
        const annOffset = activeRowIdx * binCount;
        const groups: { startBin: number; endBin: number }[] = [];
        let gs = -1;
        for (let b = 0; b <= binCount; b++) {
          const active =
            b < binCount && annData[annOffset + b] !== POWER_NO_READING;
          if (active && gs === -1) gs = b;
          else if (!active && gs !== -1) {
            groups.push({ startBin: gs, endBin: b });
            gs = -1;
          }
        }
        const drawAnnLines = () => {
          for (const { startBin, endBin } of groups) {
            const xL = sampleX(startBin);
            const xR = sampleX(endBin);
            ctx.beginPath();
            ctx.moveTo(xL, 0);
            ctx.lineTo(xL, height);
            ctx.moveTo(xR, 0);
            ctx.lineTo(xR, height);
            ctx.stroke();
          }
        };
        ctx.setLineDash(ANN_DASH);
        ctx.strokeStyle = ANN_OUTLINE_COLOR;
        ctx.lineWidth = ANN_OUTLINE_WIDTH;
        drawAnnLines();
        ctx.strokeStyle = ANN_COLOR;
        ctx.lineWidth = ANN_WIDTH;
        drawAnnLines();
        ctx.setLineDash([]);
      }
    }
  };

  setAnnotation(annBuf: RingBuffer, rowActivity: Uint8Array, rowCount: number) {
    this.annotation = { annBuf, rowActivity, rowCount };
  }

  setAnnotationVisible(v: boolean) {
    this.annotationVisible = v;
  }

  setLayer(
    id: string,
    data: Int8Array | Float32Array,
    color: string,
    mode: "line" | "fill" = "line",
  ) {
    this.layers.set(id, { data, color, visible: true, mode });
  }

  removeLayer(id: string) {
    this.layers.delete(id);
  }

  setLayerVisible(id: string, visible: boolean) {
    const layer = this.layers.get(id);
    if (layer) layer.visible = visible;
  }

  updateDisplayMin(displayMin: number) {
    this.powerMin = displayMin;
    if (this.ctx) this.render();
  }

  updateDisplayMax(displayMax: number) {
    this.displayMax = displayMax;
    if (this.ctx) this.render();
  }
}
