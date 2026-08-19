import { AnnotationRenderer } from "./AnnotationRenderer";
import { FrequencyAxisController } from "./FrequencyAxisController";
import { InputHandler } from "./InputHandler";
import { LiveRenderer } from "./LiveRenderer";
import { OccupancyView } from "./OccupancyView";
import { PowerAxisController } from "./PowerAxisController";
import { TooltipController } from "./TooltipController";
import { Viewport } from "./Viewport";
import { WaterfallRenderer } from "./WaterfallRenderer";
import type { AverageLayer } from "./AverageLayer";
import type { MaxHoldLayer } from "./MaxHoldLayer";
import type { RingBuffer } from "./RingBuffer";
import type { LayerVisibility } from "./SpectrumCore";
import type { TimeCursor } from "./TimeCursor";

export type SubviewRefs = {
  waterfall: HTMLCanvasElement;
  live: HTMLCanvasElement;
  annotation: HTMLCanvasElement;
  occupancy: HTMLCanvasElement;
  freqAxis: HTMLElement;
  powerAxis: HTMLDivElement;
  tooltip: HTMLDivElement;
};

export type SubviewHandle = {
  destroy(): void;
};

type LayerEntry = {
  id: string;
  data: Int8Array | Float32Array;
  color: string;
  mode: "line" | "fill";
};

type SubviewSettings = {
  displayMin: number;
  displayMax: number;
  colormap: number;
  layerVisibility: LayerVisibility;
};

export class SpectrumSubviewCore implements SubviewHandle {
  private waterfallRenderer: WaterfallRenderer | null = null;
  private liveRenderer: LiveRenderer | null = null;
  private annotationRenderer: AnnotationRenderer | null = null;
  private occupancyView: OccupancyView | null = null;
  private freqAxisController: FrequencyAxisController | null = null;
  private powerAxisController: PowerAxisController | null = null;
  private tooltipController: TooltipController | null = null;
  private waterfallInput: InputHandler | null = null;
  private liveInput: InputHandler | null = null;
  private viewport: Viewport | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private readonly buffer: RingBuffer;
  private readonly annotationBuffer: RingBuffer;
  private readonly historyRows: number;
  private readonly binCount: number;
  private readonly subFreqStartMHz: number;
  private readonly subFreqEndMHz: number;
  private readonly normalizedStart: number;
  private readonly normalizedEnd: number;
  private readonly settings: SubviewSettings;
  private readonly layers: LayerEntry[];
  private readonly avgLayer: AverageLayer;
  private readonly maxHold: MaxHoldLayer;
  private readonly occupancyData: Float32Array;
  private readonly timeCursor: TimeCursor;
  private readonly requestRender: () => void;

  constructor(
    buffer: RingBuffer,
    annotationBuffer: RingBuffer,
    historyRows: number,
    binCount: number,
    subFreqStartMHz: number,
    subFreqEndMHz: number,
    normalizedStart: number,
    normalizedEnd: number,
    settings: SubviewSettings,
    layers: LayerEntry[],
    avgLayer: AverageLayer,
    maxHold: MaxHoldLayer,
    occupancyData: Float32Array,
    timeCursor: TimeCursor,
    requestRender: () => void,
  ) {
    this.buffer = buffer;
    this.annotationBuffer = annotationBuffer;
    this.historyRows = historyRows;
    this.binCount = binCount;
    this.subFreqStartMHz = subFreqStartMHz;
    this.subFreqEndMHz = subFreqEndMHz;
    this.normalizedStart = normalizedStart;
    this.normalizedEnd = normalizedEnd;
    this.settings = { ...settings };
    this.layers = layers;
    this.avgLayer = avgLayer;
    this.maxHold = maxHold;
    this.occupancyData = occupancyData;
    this.timeCursor = timeCursor;
    this.requestRender = requestRender;
  }

  mount(refs: SubviewRefs) {
    const { buffer, annotationBuffer, historyRows, binCount, subFreqStartMHz, subFreqEndMHz,
      normalizedStart, normalizedEnd, settings, layers, avgLayer, maxHold, timeCursor } = this;

    const viewport = new Viewport(binCount, refs.waterfall, 12, normalizedStart, normalizedEnd);
    viewport.panTo(normalizedStart, normalizedEnd);

    // A subview only ever renders normalizedStart..normalizedEnd -- its Viewport
    // clamps zoom to exactly that span -- so out-of-range bins are unreachable
    // and cropping the texture to them loses nothing at any zoom level. That is
    // what lets each subview hold the FULL ring depth in its own GL context
    // (textures cannot be shared across contexts) at a few MB rather than 33.
    const subBinStart = Math.max(0, Math.min(binCount - 1, Math.floor(normalizedStart * binCount)));
    const subBinEnd = Math.max(subBinStart + 1, Math.min(binCount, Math.ceil(normalizedEnd * binCount)));

    const displayRows = this.measureDisplayRows(refs.waterfall);

    const waterfallRenderer = new WaterfallRenderer(historyRows, binCount, buffer, {
      displayMin: settings.displayMin,
      displayMax: settings.displayMax,
      colormap: settings.colormap,
      binStart: subBinStart,
      binSpan: subBinEnd - subBinStart,
    });
    waterfallRenderer.mount(refs.waterfall, viewport, timeCursor);
    waterfallRenderer.setDisplayRows(displayRows);

    this.resizeObserver = new ResizeObserver((entries) => {
      const h = entries[0].contentRect.height;
      const n = Math.max(10, Math.floor(h / 2));
      waterfallRenderer.setDisplayRows(n);
      annotationRenderer.setDisplayRows(n);
      liveRenderer.setDisplayRows(n);
      tooltipController.setDisplayRows(n);
      this.requestRender();
    });
    this.resizeObserver.observe(refs.waterfall);

    const liveRenderer = new LiveRenderer(binCount, buffer, {
      displayMin: settings.displayMin,
      displayMax: settings.displayMax,
      layerVisibility: settings.layerVisibility,
    });
    liveRenderer.mount(refs.live, viewport, timeCursor);
    liveRenderer.setDisplayRows(displayRows);
    for (const { id, data, color, mode } of layers) {
      liveRenderer.setLayer(id, data, color, mode);
    }

    const annotationRenderer = new AnnotationRenderer(annotationBuffer, historyRows, binCount, settings.layerVisibility.annotations ?? true);
    annotationRenderer.mount(refs.annotation, viewport, timeCursor);
    annotationRenderer.setDisplayRows(displayRows);
    liveRenderer.setAnnotation(annotationBuffer, annotationRenderer.rowActivity, historyRows);

    const freqAxisController = new FrequencyAxisController(subFreqStartMHz, subFreqEndMHz);
    freqAxisController.mount(refs.freqAxis);

    const powerAxisController = new PowerAxisController(settings.displayMin, settings.displayMax);
    powerAxisController.mount(refs.powerAxis);

    const tooltipController = new TooltipController({
      freqStartMHz: subFreqStartMHz,
      freqEndMHz: subFreqEndMHz,
      binCount,
      buffer,
      avgLayer,
      maxHold,
      viewport,
      timeCursor,
      normalizedStart,
      normalizedEnd,
    });
    tooltipController.setDisplayRows(displayRows);
    tooltipController.mount(refs.tooltip, refs.live, refs.waterfall);

    // Input drives the parent render loop so a subview gesture repaints every
    // pane -- necessary now that shift+wheel here moves the shared time cursor.
    this.waterfallInput = new InputHandler(refs.waterfall, viewport, this.requestRender, timeCursor);
    this.liveInput = new InputHandler(refs.live, viewport, this.requestRender);

    const occupancyView = new OccupancyView(this.occupancyData, binCount);
    occupancyView.mount(refs.occupancy, viewport, timeCursor);

    this.waterfallRenderer = waterfallRenderer;
    this.liveRenderer = liveRenderer;
    this.annotationRenderer = annotationRenderer;
    this.occupancyView = occupancyView;
    this.freqAxisController = freqAxisController;
    this.powerAxisController = powerAxisController;
    this.tooltipController = tooltipController;
    this.viewport = viewport;
  }

  // Subviews keep 1 row per 2 CSS pixels, so they cover twice the wall-clock
  // span of the main view at the same anchor.
  private measureDisplayRows(canvas: HTMLCanvasElement): number {
    return Math.max(10, Math.floor(canvas.getBoundingClientRect().height / 2));
  }

  render() {
    if (!this.freqAxisController || !this.waterfallRenderer || !this.liveRenderer || !this.viewport) return;
    const subviewSpan = this.normalizedEnd - this.normalizedStart;
    const toLocal = (v: number) => (v - this.normalizedStart) / subviewSpan;
    this.freqAxisController.update(toLocal(this.viewport.start), toLocal(this.viewport.end));
    this.waterfallRenderer.render();
    this.liveRenderer.render();
    this.annotationRenderer?.render();
    this.occupancyView?.render();
    this.tooltipController?.refresh();
  }

  push(absRow: number, specRow: Int8Array, annRow: Int8Array) {
    this.waterfallRenderer?.push(absRow, specRow);
    this.annotationRenderer?.push(absRow, annRow);
  }

  updateDisplayRange(min: number, max: number) {
    this.waterfallRenderer?.updateDisplayMin(min);
    this.waterfallRenderer?.updateDisplayMax(max);
    this.liveRenderer?.updateDisplayMin(min);
    this.liveRenderer?.updateDisplayMax(max);
    this.powerAxisController?.update(min, max);
  }

  updateColormap(lut: Uint8Array) {
    this.waterfallRenderer?.updateColormap(lut);
  }

  updateLayerVisibility(vis: Partial<LayerVisibility>) {
    this.liveRenderer?.updateLayerVisibility(vis);
    if (vis.annotations !== undefined) {
      this.annotationRenderer?.setVisible(vis.annotations);
      this.annotationRenderer?.render();
    }
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.waterfallInput?.destroy();
    this.liveInput?.destroy();
    this.tooltipController?.destroy();
    this.waterfallRenderer?.destroy();
    this.liveRenderer?.destroy();
    this.annotationRenderer = null;
    this.occupancyView?.destroy();
    this.freqAxisController?.destroy();
    this.powerAxisController?.destroy();
    this.waterfallRenderer = null;
    this.liveRenderer = null;
    this.occupancyView = null;
    this.freqAxisController = null;
    this.powerAxisController = null;
    this.tooltipController = null;
    this.waterfallInput = null;
    this.liveInput = null;
    this.viewport = null;
  }
}
