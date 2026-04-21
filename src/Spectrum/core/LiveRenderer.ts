import { resizeCanvasToDisplaySize } from "twgl.js";
import { computePowerTicks } from "./powerAxisUtils";
import { POWER_NO_READING } from "./constants";
import type { RingBuffer } from "./RingBuffer";
import type { Viewport } from "./Viewport";
import type { NormalizedRange } from "./ProfileTypes";

export type LiveSettings = {
  displayMin: number;
  displayMax: number;
  layerVisibility: Record<string, boolean>;
};

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

export class LiveRenderer {
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
  private profileRanges: NormalizedRange[] = [];

  constructor(binCount: number, buffer: RingBuffer, settings: LiveSettings) {
    this.binCount = binCount;
    this.ringBuffer = buffer;
    this.powerMin = settings.displayMin;
    this.displayMax = settings.displayMax;
    this.liveVisible = settings.layerVisibility.live ?? true;
    this.annotationVisible = settings.layerVisibility.annotations ?? true;
  }

  setProfileRanges(ranges: NormalizedRange[]) {
    this.profileRanges = ranges;
  }

  destroy() {}

  updateLayerVisibility(vis: Record<string, boolean>) {
    this.liveVisible = vis.live ?? this.liveVisible;
    this.annotationVisible = vis.annotations ?? this.annotationVisible;
    for (const [id, visible] of Object.entries(vis)) this.setLayerVisible(id, visible);
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

    const { start, end } = viewport;
    const visibleSpan = end - start;

    // --- Profile bands ---
    if (this.profileRanges.length > 0) {
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(59, 130, 246, 0.12)";
      for (const r of this.profileRanges) {
        const xL = ((r.start - start) / visibleSpan) * width;
        ctx.fillRect(xL, 0, ((r.end - start) / visibleSpan) * width - xL, height);
      }
      ctx.strokeStyle = "rgba(59, 130, 246, 0.5)";
      ctx.lineWidth = 1;
      for (const r of this.profileRanges) {
        const xL = ((r.start - start) / visibleSpan) * width;
        const xR = ((r.end - start) / visibleSpan) * width;
        ctx.beginPath();
        ctx.moveTo(xL, 0); ctx.lineTo(xL, height);
        ctx.moveTo(xR, 0); ctx.lineTo(xR, height);
        ctx.stroke();
      }
    }

    // --- Spectrum fill + line ---

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

    // --- Profile handles + labels (topmost) ---
    if (this.profileRanges.length > 0) {
      const HANDLE_W = 4;
      const HANDLE_H = 20;
      const STRIP_H = 14;
      ctx.setLineDash([]);
      for (const r of this.profileRanges) {
        const xL = ((r.start - start) / visibleSpan) * width;
        const xR = ((r.end - start) / visibleSpan) * width;

        // Move strip across top of range
        ctx.fillStyle = "rgba(59, 130, 246, 0.22)";
        ctx.fillRect(xL, 0, xR - xL, STRIP_H);

        // Edge handles
        ctx.fillStyle = "rgba(59, 130, 246, 0.85)";
        ctx.fillRect(xL - HANDLE_W / 2, height / 2 - HANDLE_H / 2, HANDLE_W, HANDLE_H);
        ctx.fillRect(xR - HANDLE_W / 2, height / 2 - HANDLE_H / 2, HANDLE_W, HANDLE_H);

        // Label
        ctx.font = "bold 11px monospace";
        ctx.fillStyle = "rgba(59, 130, 246, 0.9)";
        ctx.fillText(`#${r.numericId}`, xL + HANDLE_W / 2 + 3, 11);
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
