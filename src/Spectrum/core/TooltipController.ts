import * as styles from "./styles.css";
import type { AverageLayer } from "./AverageLayer";
import type { MaxHoldLayer } from "./MaxHoldLayer";
import type { OccupancyRenderer } from "./OccupancyRenderer";
import type { RingBuffer } from "./RingBuffer";
import type { Viewport } from "./Viewport";

type MousePosition = {
  clientX: number;
  clientY: number;
  normX: number;
  waterfallNormY: number | undefined;
};

type TooltipOptions = {
  freqStartMHz: number;
  freqEndMHz: number;
  binCount: number;
  rowCount: number;
  buffer: RingBuffer;
  avgLayer: AverageLayer;
  maxHold: MaxHoldLayer;
  occupancyLayer: OccupancyRenderer;
  viewport: Viewport;
};

export class TooltipController {
  private opts: TooltipOptions;
  private tooltip: HTMLDivElement | null = null;
  private liveCanvas: HTMLCanvasElement | null = null;
  private waterfallCanvas: HTMLCanvasElement | null = null;
  private lastMouse: MousePosition | null = null;

  constructor(opts: TooltipOptions) {
    this.opts = opts;
  }

  mount(tooltip: HTMLDivElement, liveCanvas: HTMLCanvasElement, waterfallCanvas: HTMLCanvasElement) {
    this.tooltip = tooltip;
    this.liveCanvas = liveCanvas;
    this.waterfallCanvas = waterfallCanvas;

    liveCanvas.addEventListener("mousemove", this.onLiveMouseMove);
    liveCanvas.addEventListener("mouseleave", this.onMouseLeave);
    waterfallCanvas.addEventListener("mousemove", this.onWaterfallMouseMove);
    waterfallCanvas.addEventListener("mouseleave", this.onMouseLeave);
  }

  refresh() {
    const pos = this.lastMouse;
    const tt = this.tooltip;
    if (!pos || !tt) return;

    const { freqStartMHz, freqEndMHz, binCount, rowCount, buffer, avgLayer, maxHold, occupancyLayer, viewport } = this.opts;

    const viewNorm = viewport.start + pos.normX * (viewport.end - viewport.start);
    const freqMHz = freqStartMHz + viewNorm * (freqEndMHz - freqStartMHz);
    const binIndex = Math.max(0, Math.min(binCount - 1, Math.floor(viewNorm * binCount)));
    const row =
      pos.waterfallNormY === undefined
        ? (buffer.writeRow - 1 + buffer.rowCount) % buffer.rowCount
        : (buffer.writeRow -
            1 -
            Math.floor(pos.waterfallNormY * (rowCount - 1)) +
            buffer.rowCount * 2) %
          buffer.rowCount;

    const dbm = buffer.data[row * binCount + binIndex];
    const avg = avgLayer.data[binIndex];
    const max = maxHold.data[binIndex];
    const occ = occupancyLayer.data[binIndex];
    const ts = buffer.timestamps[row];

    const cell = (label: string, value: string) =>
      `<span class="${styles.tooltipLabel}">${label}</span><span>${value}</span>`;

    tt.innerHTML =
      (ts > 0 ? cell("time", new Date(ts).toLocaleTimeString()) : "") +
      cell("freq", `${freqMHz.toFixed(3)} MHz`) +
      cell("live", `${dbm} dBm`) +
      (avg !== undefined ? cell("avg", `${avg.toFixed(1)} dBm`) : "") +
      (max !== undefined && isFinite(max) ? cell("max", `${max.toFixed(1)} dBm`) : "") +
      (occ !== undefined ? cell("occ", `${(occ * 100).toFixed(1)}%`) : "");

    tt.style.left = `${pos.clientX + 8}px`;
    tt.style.top = `${pos.clientY - 8}px`;
  }

  private onLiveMouseMove = (e: MouseEvent) => {
    const tt = this.tooltip;
    const canvas = this.liveCanvas;
    if (!tt || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    this.lastMouse = {
      clientX: e.clientX,
      clientY: e.clientY,
      normX: (e.clientX - rect.left) / rect.width,
      waterfallNormY: undefined,
    };
    tt.style.display = "grid";
    this.refresh();
  };

  private onWaterfallMouseMove = (e: MouseEvent) => {
    const tt = this.tooltip;
    const canvas = this.waterfallCanvas;
    if (!tt || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    this.lastMouse = {
      clientX: e.clientX,
      clientY: e.clientY,
      normX: (e.clientX - rect.left) / rect.width,
      waterfallNormY: (e.clientY - rect.top) / rect.height,
    };
    tt.style.display = "grid";
    this.refresh();
  };

  private onMouseLeave = () => {
    this.lastMouse = null;
    if (this.tooltip) this.tooltip.style.display = "none";
  };

  destroy() {
    this.liveCanvas?.removeEventListener("mousemove", this.onLiveMouseMove);
    this.liveCanvas?.removeEventListener("mouseleave", this.onMouseLeave);
    this.waterfallCanvas?.removeEventListener("mousemove", this.onWaterfallMouseMove);
    this.waterfallCanvas?.removeEventListener("mouseleave", this.onMouseLeave);
    this.tooltip = null;
    this.liveCanvas = null;
    this.waterfallCanvas = null;
  }
}
