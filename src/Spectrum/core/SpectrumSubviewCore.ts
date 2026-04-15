import { FrequencyAxisController } from "./FrequencyAxisController";
import { InputHandler } from "./InputHandler";
import { LiveRenderer } from "./LiveRenderer";
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
  freqAxis: HTMLElement;
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
  private freqAxisController: FrequencyAxisController | null = null;
  private tooltipController: TooltipController | null = null;
  private waterfallInput: InputHandler | null = null;
  private liveInput: InputHandler | null = null;

  private readonly buffer: RingBuffer;
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

  constructor(
    buffer: RingBuffer,
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
  ) {
    this.buffer = buffer;
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
  }

  mount(refs: SubviewRefs) {
    const { buffer, rowCount, binCount, subFreqStartMHz, subFreqEndMHz,
      normalizedStart, normalizedEnd, settings, layers, avgLayer, maxHold } = this;

    const viewport = new Viewport(binCount, refs.waterfall, 12, normalizedStart, normalizedEnd);
    viewport.panTo(normalizedStart, normalizedEnd);

    const waterfallRenderer = new WaterfallRenderer(rowCount, binCount, buffer, {
      displayMin: settings.displayMin,
      displayMax: settings.displayMax,
      colormap: settings.colormap,
    });
    waterfallRenderer.mount(refs.waterfall, viewport);

    const liveRenderer = new LiveRenderer(binCount, buffer, {
      displayMin: settings.displayMin,
      displayMax: settings.displayMax,
      layerVisibility: settings.layerVisibility,
    });
    liveRenderer.mount(refs.live, viewport);
    for (const { id, data, color, mode } of layers) {
      liveRenderer.setLayer(id, data, color, mode);
    }

    const freqAxisController = new FrequencyAxisController(subFreqStartMHz, subFreqEndMHz);
    freqAxisController.mount(refs.freqAxis);

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

    const renderAll = () => {
      freqAxisController.update(viewport.start, viewport.end);
      waterfallRenderer.render();
      liveRenderer.render();
    };

    this.waterfallInput = new InputHandler(refs.waterfall, viewport, renderAll);
    this.liveInput = new InputHandler(refs.live, viewport, renderAll);

    this.waterfallRenderer = waterfallRenderer;
    this.liveRenderer = liveRenderer;
    this.freqAxisController = freqAxisController;
    this.tooltipController = tooltipController;
  }

  render() {
    if (!this.freqAxisController || !this.waterfallRenderer || !this.liveRenderer) return;
    // viewport may have moved via InputHandler — let renderers read current state
    this.waterfallRenderer.render();
    this.liveRenderer.render();
  }

  push(writtenRow: number) {
    this.waterfallRenderer?.push(writtenRow);
    this.tooltipController?.refresh();
  }

  updateDisplayRange(min: number, max: number) {
    this.waterfallRenderer?.updateDisplayMin(min);
    this.waterfallRenderer?.updateDisplayMax(max);
    this.liveRenderer?.updateDisplayMin(min);
    this.liveRenderer?.updateDisplayMax(max);
  }

  updateColormap(lut: Uint8Array) {
    this.waterfallRenderer?.updateColormap(lut);
  }

  updateLayerVisibility(vis: Partial<LayerVisibility>) {
    this.liveRenderer?.updateLayerVisibility(vis);
  }

  destroy() {
    this.waterfallInput?.destroy();
    this.liveInput?.destroy();
    this.tooltipController?.destroy();
    this.waterfallRenderer?.destroy();
    this.liveRenderer?.destroy();
    this.freqAxisController?.destroy();
    this.waterfallRenderer = null;
    this.liveRenderer = null;
    this.freqAxisController = null;
    this.tooltipController = null;
    this.waterfallInput = null;
    this.liveInput = null;
  }
}
