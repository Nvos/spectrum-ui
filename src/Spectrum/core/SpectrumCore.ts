import { buildLUT, COLORMAPS } from "./colormaps";
import { AnnotationRenderer } from "./AnnotationRenderer";
import { AverageLayer } from "./AverageLayer";
import { ColormapLegendController } from "./ColormapLegendController";
import { FrequencyAxisController } from "./FrequencyAxisController";
import { FrameBuffer } from "./FrameBuffer";
import { InputHandler } from "./InputHandler";
import { LiveRenderer } from "./LiveRenderer";
import { MaxHoldLayer } from "./MaxHoldLayer";
import { OccupancyLayer } from "./OccupancyLayer";
import { OccupancyRenderer } from "./OccupancyRenderer";
import { PowerAxisController } from "./PowerAxisController";
import { TimeLabelsController } from "./TimeLabelsController";
import { TooltipController } from "./TooltipController";
import { Viewport } from "./Viewport";
import { WaterfallRenderer } from "./WaterfallRenderer";

export type SpectrumInitialData = {
  spectrum: { rows: Int8Array; count: number; timestamps: number[] };
  annotations: { rows: Int8Array; count: number; timestamps: number[] };
  maxHold: Int8Array;
  occupancy: { values: Float32Array; total: number };
};

export type LayerVisibility = {
  live: boolean;
  avg: boolean;
  max: boolean;
  annotations: boolean;
};

export type SpectrumCoreOptions = {
  freqStart: number;
  resolution: number;
  rowCount: number;
  binCount: number;
  initialData?: SpectrumInitialData;
  displayMin?: number;
  displayMax?: number;
  colormap?: number;
  layerVisibility?: Partial<LayerVisibility>;
  avgTau?: number;
  occupancyThreshold?: number;
  onDisplayRangeChange?: (min: number, max: number) => void;
};

export type SpectrumMountRefs = {
  waterfall: HTMLCanvasElement;
  live: HTMLCanvasElement;
  annotation: HTMLCanvasElement;
  occupancy: HTMLCanvasElement;
  freqAxis: HTMLElement;
  timeLabels: HTMLDivElement;
  tooltip: HTMLDivElement;
  powerAxis: HTMLDivElement;
  colormapLegend: HTMLDivElement;
};

export class SpectrumCore {
  private frameBuffer: FrameBuffer;
  private freqStart: number;
  private resolution: number;
  private rowCount: number;
  private binCount: number;
  private initialData: SpectrumInitialData | undefined;
  private onDisplayRangeChange: ((min: number, max: number) => void) | undefined;

  // Settings
  private displayMin: number;
  private displayMax: number;
  private colormap: number;
  private layerVisibility: LayerVisibility;
  private avgTau: number;
  private occupancyThreshold: number;

  // Runtime — set on mount, cleared on destroy
  private waterfallRenderer: WaterfallRenderer | null = null;
  private liveRenderer: LiveRenderer | null = null;
  private annotationRenderer: AnnotationRenderer | null = null;
  private maxHold: MaxHoldLayer | null = null;
  private avgLayer: AverageLayer | null = null;
  private occupancyLayer: OccupancyLayer | null = null;
  private freqAxisController: FrequencyAxisController | null = null;
  private timeLabelsController: TimeLabelsController | null = null;
  private tooltipController: TooltipController | null = null;
  private powerAxisController: PowerAxisController | null = null;
  private colormapLegendController: ColormapLegendController | null = null;
  private waterfallInput: InputHandler | null = null;
  private liveInput: InputHandler | null = null;
  private rafHandle: number | null = null;
  private unsubscribeBuffer: (() => void) | null = null;

  constructor(frameBuffer: FrameBuffer, options: SpectrumCoreOptions) {
    this.frameBuffer = frameBuffer;
    this.freqStart = options.freqStart;
    this.resolution = options.resolution;
    this.rowCount = options.rowCount;
    this.binCount = options.binCount;
    this.initialData = options.initialData;
    this.displayMin = options.displayMin ?? -92;
    this.displayMax = options.displayMax ?? -62;
    this.colormap = options.colormap ?? 0;
    this.layerVisibility = {
      live: true,
      avg: true,
      max: true,
      annotations: true,
      ...options.layerVisibility,
    };
    this.avgTau = options.avgTau ?? 2000;
    this.occupancyThreshold = options.occupancyThreshold ?? -82;
    this.onDisplayRangeChange = options.onDisplayRangeChange;
  }

  // oxlint-disable-next-line max-lines-per-function
  mount(refs: SpectrumMountRefs) {
    const { frameBuffer, rowCount, binCount, initialData, displayMin, displayMax, colormap, layerVisibility, avgTau, occupancyThreshold } = this;
    const { spectrum: buffer, annotations: annotationBuffer } = frameBuffer;

    const freqStartMHz = this.freqStart / 1000;
    const freqEndMHz = freqStartMHz + (binCount * this.resolution) / 1000;

    const waterfallRenderer = new WaterfallRenderer(rowCount, binCount, buffer, { displayMin, displayMax, colormap });
    const liveRenderer = new LiveRenderer(binCount, buffer, { displayMin, displayMax, layerVisibility });

    const viewport = new Viewport(binCount, refs.waterfall);
    waterfallRenderer.mount(refs.waterfall, viewport);
    liveRenderer.mount(refs.live, viewport);

    const maxHold = new MaxHoldLayer(binCount, buffer, initialData?.maxHold);
    liveRenderer.setLayer("max", maxHold.data, "rgba(255, 80, 80, 0.85)");

    const avgLayer = new AverageLayer(binCount, buffer, avgTau);
    liveRenderer.setLayer("avg", avgLayer.data, "rgba(250, 190, 40, 0.85)");

    const occupancyLayer = new OccupancyLayer(binCount, buffer, occupancyThreshold, initialData?.occupancy);
    const occupancyRenderer = new OccupancyRenderer(binCount, occupancyLayer.data);
    occupancyRenderer.mount(refs.occupancy, viewport);

    const annotationRenderer = new AnnotationRenderer(annotationBuffer, rowCount, binCount, layerVisibility.annotations);
    annotationRenderer.mount(refs.annotation, viewport);
    liveRenderer.setAnnotation(annotationBuffer, annotationRenderer.rowActivity, rowCount);

    const freqAxisController = new FrequencyAxisController(freqStartMHz, freqEndMHz);
    freqAxisController.mount(refs.freqAxis);

    const timeLabelsController = new TimeLabelsController(buffer, rowCount);
    timeLabelsController.mount(refs.timeLabels);

    const tooltipController = new TooltipController({
      freqStartMHz,
      freqEndMHz,
      binCount,
      rowCount,
      buffer,
      avgLayer,
      maxHold,
      occupancyLayer,
      viewport,
    });
    tooltipController.mount(refs.tooltip, refs.live, refs.waterfall);

    const powerAxisController = new PowerAxisController(displayMin, displayMax);
    powerAxisController.mount(refs.powerAxis);

    const colormapLegendController = new ColormapLegendController(displayMin, displayMax, colormap, {
      onChangeRange: (min, max) => {
        this.setDisplayRange(min, max);
        this.onDisplayRangeChange?.(min, max);
      },
    });
    colormapLegendController.mount(refs.colormapLegend);

    const renderAll = () => {
      freqAxisController.update(viewport.start, viewport.end);
      waterfallRenderer.render();
      liveRenderer.render();
      occupancyRenderer.render();
      annotationRenderer.render();
    };
    const scheduleRender = () => {
      if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
      this.rafHandle = requestAnimationFrame(renderAll);
    };

    this.waterfallInput = new InputHandler(refs.waterfall, viewport, renderAll);
    this.liveInput = new InputHandler(refs.live, viewport, renderAll);

    this.unsubscribeBuffer = buffer.subscribe((writtenRow) => {
      waterfallRenderer.push(writtenRow);
      scheduleRender();
      tooltipController.refresh();
    });

    this.waterfallRenderer = waterfallRenderer;
    this.liveRenderer = liveRenderer;

    this.annotationRenderer = annotationRenderer;
    this.maxHold = maxHold;
    this.avgLayer = avgLayer;
    this.occupancyLayer = occupancyLayer;
    this.freqAxisController = freqAxisController;
    this.timeLabelsController = timeLabelsController;
    this.tooltipController = tooltipController;
    this.powerAxisController = powerAxisController;
    this.colormapLegendController = colormapLegendController;
  }

  destroy() {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.unsubscribeBuffer?.();
    this.annotationRenderer?.destroy();
    this.maxHold?.destroy();
    this.avgLayer?.destroy();
    this.occupancyLayer?.destroy();
    this.waterfallRenderer?.destroy();
    this.liveRenderer?.destroy();
    this.waterfallInput?.destroy();
    this.liveInput?.destroy();
    this.freqAxisController?.destroy();
    this.timeLabelsController?.destroy();
    this.tooltipController?.destroy();
    this.powerAxisController?.destroy();
    this.colormapLegendController?.destroy();

    this.waterfallRenderer = null;
    this.liveRenderer = null;

    this.annotationRenderer = null;
    this.maxHold = null;
    this.avgLayer = null;
    this.occupancyLayer = null;
    this.freqAxisController = null;
    this.timeLabelsController = null;
    this.tooltipController = null;
    this.powerAxisController = null;
    this.colormapLegendController = null;
    this.waterfallInput = null;
    this.liveInput = null;
    this.rafHandle = null;
    this.unsubscribeBuffer = null;
  }

  resetMaxHold() {
    this.maxHold?.reset();
  }

  resetOccupancy() {
    this.occupancyLayer?.reset();
  }

  setDisplayRange(min: number, max: number) {
    this.displayMin = min;
    this.displayMax = max;
    this.waterfallRenderer?.updateDisplayMin(min);
    this.waterfallRenderer?.updateDisplayMax(max);
    this.liveRenderer?.updateDisplayMin(min);
    this.liveRenderer?.updateDisplayMax(max);
    this.powerAxisController?.update(min, max);
    this.colormapLegendController?.update(min, max, this.colormap);
  }

  setColormap(colormap: number) {
    this.colormap = colormap;
    this.waterfallRenderer?.updateColormap(buildLUT(COLORMAPS[colormap]));
    this.colormapLegendController?.update(this.displayMin, this.displayMax, colormap);
  }

  setLayerVisibility(vis: Partial<LayerVisibility>) {
    this.layerVisibility = { ...this.layerVisibility, ...vis };
    this.liveRenderer?.updateLayerVisibility(this.layerVisibility);
    if (vis.annotations !== undefined) {
      this.annotationRenderer?.setVisible(vis.annotations);
      this.annotationRenderer?.render();
    }
  }

  setAvgTau(tau: number) {
    this.avgTau = tau;
    this.avgLayer?.setTau(tau);
  }

  setOccupancyThreshold(threshold: number) {
    this.occupancyThreshold = threshold;
    this.occupancyLayer?.setThreshold(threshold);
  }
}
