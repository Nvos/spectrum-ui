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
  private readonly rowCount: number;
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

  constructor(
    buffer: RingBuffer,
    annotationBuffer: RingBuffer,
    rowCount: number,
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
  ) {
    this.buffer = buffer;
    this.annotationBuffer = annotationBuffer;
    this.rowCount = rowCount;
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
  }

  mount(refs: SubviewRefs) {
    const { buffer, annotationBuffer, rowCount, binCount, subFreqStartMHz, subFreqEndMHz,
      normalizedStart, normalizedEnd, settings, layers, avgLayer, maxHold } = this;

    const viewport = new Viewport(binCount, refs.waterfall, 12, normalizedStart, normalizedEnd);
    viewport.panTo(normalizedStart, normalizedEnd);

    const initialH = refs.waterfall.getBoundingClientRect().height;
    const initialRowCount = Math.max(10, Math.floor(initialH / 2));

    const waterfallRenderer = new WaterfallRenderer(initialRowCount, binCount, buffer, {
      displayMin: settings.displayMin,
      displayMax: settings.displayMax,
      colormap: settings.colormap,
    });
    waterfallRenderer.mount(refs.waterfall, viewport);

    this.resizeObserver = new ResizeObserver((entries) => {
      const h = entries[0].contentRect.height;
      const n = Math.max(10, Math.floor(h / 2));
      waterfallRenderer.setRowCount(n);
      annotationRenderer.setDisplayRowCount(n);
    });
    this.resizeObserver.observe(refs.waterfall);

    const liveRenderer = new LiveRenderer(binCount, buffer, {
      displayMin: settings.displayMin,
      displayMax: settings.displayMax,
      layerVisibility: settings.layerVisibility,
    });
    liveRenderer.mount(refs.live, viewport);
    for (const { id, data, color, mode } of layers) {
      liveRenderer.setLayer(id, data, color, mode);
    }

    const annotationRenderer = new AnnotationRenderer(annotationBuffer, rowCount, binCount, settings.layerVisibility.annotations ?? true);
    annotationRenderer.mount(refs.annotation, viewport);
    liveRenderer.setAnnotation(annotationBuffer, annotationRenderer.rowActivity, rowCount);

    const freqAxisController = new FrequencyAxisController(subFreqStartMHz, subFreqEndMHz);
    freqAxisController.mount(refs.freqAxis);

    const powerAxisController = new PowerAxisController(settings.displayMin, settings.displayMax);
    powerAxisController.mount(refs.powerAxis);

    const tooltipController = new TooltipController({
      freqStartMHz: subFreqStartMHz,
      freqEndMHz: subFreqEndMHz,
      binCount,
      rowCount,
      buffer,
      avgLayer,
      maxHold,
      viewport,
    });
    tooltipController.mount(refs.tooltip, refs.live, refs.waterfall);

    const subviewSpan = normalizedEnd - normalizedStart;
    const toLocal = (v: number) => (v - normalizedStart) / subviewSpan;

    const renderAll = () => {
      freqAxisController.update(toLocal(viewport.start), toLocal(viewport.end));
      waterfallRenderer.render();
      liveRenderer.render();
    };

    this.waterfallInput = new InputHandler(refs.waterfall, viewport, renderAll);
    this.liveInput = new InputHandler(refs.live, viewport, renderAll);

    const occupancyView = new OccupancyView(this.occupancyData, binCount);
    occupancyView.mount(refs.occupancy, viewport);

    this.waterfallRenderer = waterfallRenderer;
    this.liveRenderer = liveRenderer;
    this.annotationRenderer = annotationRenderer;
    this.occupancyView = occupancyView;
    this.freqAxisController = freqAxisController;
    this.powerAxisController = powerAxisController;
    this.tooltipController = tooltipController;
    this.viewport = viewport;
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

  push(writtenRow: number, specRow: Int8Array, annRow: Int8Array) {
    this.waterfallRenderer?.push(writtenRow, specRow);
    this.annotationRenderer?.push(writtenRow, annRow);
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
