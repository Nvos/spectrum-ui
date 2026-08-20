import { buildLUT, COLORMAPS } from "./colormaps";
import { AnnotationRenderer } from "./AnnotationRenderer";
import { BandController } from "./BandController";
import type { Band } from "./BandTypes";
import { ProfileRangeHandler } from "./ProfileRangeHandler";
import type { ProfileRange, NormalizedRange } from "./ProfileTypes";
import { AverageLayer } from "./AverageLayer";
import { ColormapLegendController } from "./ColormapLegendController";
import { FrequencyAxisController } from "./FrequencyAxisController";
import { GridLineController } from "./GridLineController";
import { FrameBuffer } from "./FrameBuffer";
import { InputHandler } from "./InputHandler";
import { TimeGutterInput } from "./TimeGutterInput";
import { LiveRenderer } from "./LiveRenderer";
import { MaxHoldLayer } from "./MaxHoldLayer";
import { OccupancyRenderer } from "./OccupancyRenderer";
import { PowerAxisController } from "./PowerAxisController";
import { SpectrumSubviewCore } from "./SpectrumSubviewCore";
import { SubviewHighlightController } from "./SubviewHighlightController";
import { TimeCursor } from "./TimeCursor";
import { TimeLabelsController } from "./TimeLabelsController";
import { TooltipController } from "./TooltipController";
import { Viewport } from "./Viewport";
import { WaterfallRenderer } from "./WaterfallRenderer";
import type { SubviewHandle, SubviewRefs } from "./SpectrumSubviewCore";
import type { HighlightRange } from "./SubviewHighlightController";

export type SpectrumInitialData = {
  spectrum: { rows: Int8Array; count: number; timestamps: number[]; seqStart?: number };
  annotations: { rows: Int8Array; count: number; timestamps: number[]; seqStart?: number };
  maxHold: Int8Array;
  maxSnapshot?: Int8Array;
  occupancy: { counts: Uint32Array; total: number; threshold: number };
};

/** Snapshot of the time cursor, published for follow/pause UI. */
export type HistoryState = {
  /** True when pinned to the newest row. */
  following: boolean;
  /** Absolute index of the newest visible row. */
  anchorRow: number;
  oldestAbs: number;
  totalWritten: number;
  displayRows: number;
  /** Wall-clock time of the anchor row, or 0 when it is unavailable. */
  timestampMs: number;
  /** True while the visible historical page window is being fetched. */
  loading: boolean;
  /** True while the anchor is pinned against the oldest available window. */
  atOldest: boolean;
  /** Distance from live as a fraction of retained history; 0 = live. */
  scrollTop: number;
  /** Visible window as a fraction of retained history. */
  scrollSize: number;
};

export type LayerVisibility = {
  live: boolean;
  avg: boolean;
  max: boolean;
  maxSnapshot: boolean;
  annotations: boolean;
};

export type SpectrumCoreOptions = {
  freqStart: number;
  resolution: number;
  binCount: number;
  initialData?: SpectrumInitialData;
  displayMin?: number;
  displayMax?: number;
  colormap?: number;
  layerVisibility?: Partial<LayerVisibility>;
  avgTau?: number;
  occupancyThreshold?: number;
  onDisplayRangeChange?: (min: number, max: number) => void;
  onReset?: () => void;
  onProfileRangeChange?: (id: string, startMHz: number, endMHz: number) => void;
  onHistoryStateChange?: (state: HistoryState) => void;
};

export type SpectrumMountRefs = {
  waterfall: HTMLCanvasElement;
  live: HTMLCanvasElement;
  annotation: HTMLCanvasElement;
  occupancy: HTMLCanvasElement;
  freqAxis: HTMLElement;
  subviewHighlight: HTMLElement;
  timeLabels: HTMLDivElement;
  tooltip: HTMLDivElement;
  powerAxis: HTMLDivElement;
  colormapLegend: HTMLDivElement;
  bandContainer: HTMLDivElement;
  bandTooltip: HTMLDivElement;
  gridContainer: HTMLDivElement;
};

export class SpectrumCore {
  private frameBuffer: FrameBuffer;
  private freqStart: number;
  private resolution: number;
  private historyRows: number;
  private binCount: number;
  private initialData: SpectrumInitialData | undefined;
  private onDisplayRangeChange: ((min: number, max: number) => void) | undefined;
  private onReset: (() => void) | undefined;

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
  private maxSnapshotData: Int8Array | null = null;
  private avgLayer: AverageLayer | null = null;
  private occupancyRenderer: OccupancyRenderer | null = null;
  private freqAxisController: FrequencyAxisController | null = null;
  private timeLabelsController: TimeLabelsController | null = null;
  private timeGutterInput: TimeGutterInput | null = null;
  private tooltipController: TooltipController | null = null;
  private powerAxisController: PowerAxisController | null = null;
  private colormapLegendController: ColormapLegendController | null = null;
  private subviewHighlightController: SubviewHighlightController | null = null;
  private bandController: BandController | null = null;
  private gridLineController: GridLineController | null = null;
  private waterfallInput: InputHandler | null = null;
  private liveInput: InputHandler | null = null;
  private rafHandle: number | null = null;
  private scheduleRender: (() => void) | null = null;
  private profileDragHandler: ProfileRangeHandler | null = null;
  private profileRangesCache: ProfileRange[] = [];
  private onProfileRangeChange: ((id: string, startMHz: number, endMHz: number) => void) | undefined;
  private lastProcessedCount = 0;
  private subviews: SpectrumSubviewCore[] = [];
  private timeCursor = new TimeCursor();
  private waterfallResizeObserver: ResizeObserver | null = null;
  private lastHistoryState: HistoryState | null = null;

  /** Published on every meaningful time-cursor change. Assignable at any time. */
  onHistoryStateChange: ((state: HistoryState) => void) | null = null;

  constructor(frameBuffer: FrameBuffer, options: SpectrumCoreOptions) {
    this.frameBuffer = frameBuffer;
    this.freqStart = options.freqStart;
    this.resolution = options.resolution;
    // Retained depth N is owned by the FrameBuffer; displayed rows D come from
    // the canvas. Deriving N here keeps the two from ever disagreeing.
    this.historyRows = frameBuffer.spectrum.rowCount;
    this.binCount = options.binCount;
    this.initialData = options.initialData;
    this.displayMin = options.displayMin ?? -92;
    this.displayMax = options.displayMax ?? -62;
    this.colormap = options.colormap ?? 0;
    this.layerVisibility = {
      live: true,
      avg: true,
      max: true,
      maxSnapshot: false,
      annotations: true,
      ...options.layerVisibility,
    };
    this.avgTau = options.avgTau ?? 2000;
    this.occupancyThreshold = options.initialData?.occupancy.threshold ?? options.occupancyThreshold ?? -82;
    this.onDisplayRangeChange = options.onDisplayRangeChange;
    this.onReset = options.onReset;
    this.onProfileRangeChange = options.onProfileRangeChange;
    this.onHistoryStateChange = options.onHistoryStateChange ?? null;
  }

  // The only place rows fan out to layers. Indices handed down are ABSOLUTE --
  // ring slots stay behind the RingBuffer accessors.
  private processNewRows() {
    const { spectrum, annotations } = this.frameBuffer;
    const total = spectrum.totalWritten;
    // Never replay rows that have already been overwritten (e.g. after the tab
    // was hidden long enough for the ring to lap the last processed row).
    const from = Math.max(this.lastProcessedCount, spectrum.oldestAbs());
    if (from >= total) {
      this.lastProcessedCount = total;
      return;
    }
    for (let abs = from; abs < total; abs++) {
      const specRow = spectrum.rowViewAbs(abs);
      const annRow = annotations.rowViewAbs(abs);
      this.maxHold!.push(specRow);
      this.avgLayer!.push(specRow, spectrum.timestampAtAbs(abs));
      this.occupancyRenderer!.push(specRow);
      this.waterfallRenderer!.push(abs, specRow);
      this.annotationRenderer!.push(abs, annRow);
      for (const sv of this.subviews) sv.push(abs, specRow, annRow);
    }
    this.lastProcessedCount = total;
  }

  /**
   * Waterfall canvas height in CSS pixels -- one displayed row per pixel.
   *
   * Floored to match how the canvas backing store is sized, so D never exceeds
   * the pixels available to draw it and no row ends up zero-height.
   */
  private measureDisplayRows(canvas: HTMLCanvasElement): number {
    return Math.max(1, Math.floor(canvas.getBoundingClientRect().height));
  }

  private applyDisplayRows(d: number) {
    this.timeCursor.setDisplayRows(d);
    this.waterfallRenderer?.setDisplayRows(d);
    this.annotationRenderer?.setDisplayRows(d);
    this.liveRenderer?.setDisplayRows(d);
    this.tooltipController?.setDisplayRows(d);
  }

  private buildHistoryState(): HistoryState {
    const { spectrum } = this.frameBuffer;
    const tc = this.timeCursor;
    const oldestAbs = spectrum.oldestAbs();
    const totalWritten = spectrum.totalWritten;
    const retained = Math.max(1, totalWritten - oldestAbs);
    const distanceFromLive = Math.max(0, totalWritten - 1 - tc.anchorRow);
    const scrollSize = Math.min(1, Math.max(0.03, tc.displayRows / retained));
    // Map onto the track the inflated thumb can actually travel. Dividing by
    // `retained` instead would agree only while the thumb is unclamped, and the
    // 0.03 floor engages once history exceeds ~33 screens — pinning the thumb
    // at the bottom across the oldest few percent of a deep session.
    const travel = Math.max(1, retained - tc.displayRows);
    const scrollTop =
      (1 - scrollSize) * Math.min(1, Math.max(0, distanceFromLive / travel));
    return {
      following: tc.follow,
      anchorRow: tc.anchorRow,
      oldestAbs,
      totalWritten,
      displayRows: tc.displayRows,
      timestampMs: spectrum.hasAbs(tc.anchorRow) ? spectrum.timestampAtAbs(tc.anchorRow) : 0,
      loading: this.frameBuffer.historyLoading,
      atOldest: tc.atOldest,
      scrollTop,
      scrollSize,
    };
  }

  // Emitted only on a change a human could see. While live the anchor advances
  // every frame, so publishing verbatim would re-render the UI at the ingest
  // rate for a readout that only ticks once a second.
  private publishHistoryState() {
    const handler = this.onHistoryStateChange;
    if (!handler) return;
    const next = this.buildHistoryState();
    const prev = this.lastHistoryState;
    const changed =
      prev === null ||
      prev.following !== next.following ||
      prev.atOldest !== next.atOldest ||
      prev.loading !== next.loading ||
      Math.floor(prev.timestampMs / 1000) !== Math.floor(next.timestampMs / 1000) ||
      prev.displayRows !== next.displayRows ||
      Math.abs(prev.scrollTop - next.scrollTop) > 0.002 ||
      Math.abs(prev.scrollSize - next.scrollSize) > 0.002;
    if (!changed) return;
    this.lastHistoryState = next;
    this.timeGutterInput?.setAriaPosition(
      Math.round(next.scrollTop * 100),
      next.following
        ? "Live"
        : next.loading
          ? "Loading history"
          : new Date(next.timestampMs).toLocaleTimeString(),
    );
    handler(next);
  }

  /** Scroll history by n rows; positive is newer. Leaves follow mode. */
  scrollHistoryByRows(n: number) {
    this.timeCursor.scrollByRows(n);
    this.scheduleRender?.();
  }

  /** Park the newest visible row at absolute index absRow. Leaves follow mode. */
  scrollHistoryTo(absRow: number) {
    this.timeCursor.scrollToAbs(absRow);
    this.scheduleRender?.();
  }

  scrollHistoryToLive() {
    this.timeCursor.scrollToLive();
    this.scheduleRender?.();
  }

  /** Park at the oldest available backend window. */
  scrollHistoryToOldest() {
    this.timeCursor.scrollToOldest();
    this.scheduleRender?.();
  }

  beginHistoryGesture() {
    this.frameBuffer.setHistoryGestureActive(true);
  }

  endHistoryGesture() {
    this.frameBuffer.setHistoryGestureActive(false);
  }

  // oxlint-disable-next-line max-lines-per-function
  mount(refs: SpectrumMountRefs) {
    const { frameBuffer, historyRows, binCount, initialData, displayMin, displayMax, colormap, layerVisibility, avgTau, occupancyThreshold } = this;
    const { spectrum: buffer, annotations: annotationBuffer } = frameBuffer;
    const timeCursor = this.timeCursor;

    const freqStartMHz = this.freqStart / 1000;
    const freqEndMHz = freqStartMHz + (binCount * this.resolution) / 1000;

    const waterfallRenderer = new WaterfallRenderer(historyRows, binCount, buffer, { displayMin, displayMax, colormap });
    const liveRenderer = new LiveRenderer(binCount, buffer, { displayMin, displayMax, layerVisibility });

    const viewport = new Viewport(binCount, refs.waterfall);
    waterfallRenderer.mount(refs.waterfall, viewport, timeCursor);
    liveRenderer.mount(refs.live, viewport, timeCursor);

    const maxHold = new MaxHoldLayer(binCount, initialData?.maxHold);
    liveRenderer.setLayer("max", maxHold.data, "rgba(255, 80, 80, 0.85)");

    const avgLayer = new AverageLayer(binCount, buffer, avgTau);
    liveRenderer.setLayer("avg", avgLayer.data, "rgba(250, 190, 40, 0.85)");

    const occupancyRenderer = new OccupancyRenderer(binCount, occupancyThreshold, initialData?.occupancy);
    occupancyRenderer.mount(refs.occupancy, viewport, timeCursor);

    const annotationRenderer = new AnnotationRenderer(annotationBuffer, historyRows, binCount, layerVisibility.annotations);
    annotationRenderer.mount(refs.annotation, viewport, timeCursor);
    liveRenderer.setAnnotation(annotationBuffer, annotationRenderer.rowActivity, historyRows);

    const freqAxisController = new FrequencyAxisController(freqStartMHz, freqEndMHz);
    freqAxisController.mount(refs.freqAxis);

    const timeLabelsController = new TimeLabelsController(buffer, timeCursor);
    timeLabelsController.mount(refs.timeLabels);

    const tooltipController = new TooltipController({
      freqStartMHz,
      freqEndMHz,
      binCount,
      buffer,
      avgLayer,
      maxHold,
      occupancyLayer: occupancyRenderer,
      viewport,
      timeCursor,
    });
    tooltipController.mount(refs.tooltip, refs.live, refs.waterfall);

    if (initialData?.maxSnapshot) this.takeMaxSnapshot(initialData.maxSnapshot);

    const powerAxisController = new PowerAxisController(displayMin, displayMax);
    powerAxisController.mount(refs.powerAxis);

    const colormapLegendController = new ColormapLegendController(displayMin, displayMax, colormap, {
      onChangeRange: (min, max) => {
        this.setDisplayRange(min, max);
        this.onDisplayRangeChange?.(min, max);
      },
    });
    colormapLegendController.mount(refs.colormapLegend);

    const subviewHighlightController = new SubviewHighlightController();
    subviewHighlightController.mount(refs.subviewHighlight);

    const bandController = new BandController(freqStartMHz, freqEndMHz, 3);
    bandController.mount(refs.bandContainer, refs.bandTooltip);
    bandController.onHover = (range) => {
      liveRenderer.setHoveredBand(range);
      if (range) waterfallRenderer.setHighlight(range.normStart, range.normEnd);
      else waterfallRenderer.clearHighlight();
      scheduleRender();
    };

    const gridLineController = new GridLineController(freqStartMHz, freqEndMHz);
    gridLineController.mount(refs.gridContainer);

    const renderAll = () => {
      this.processNewRows();
      // Bound the anchor before anything reads it, so every layer in this frame
      // sees the same time window.
      timeCursor.clamp(buffer.totalWritten, buffer.oldestAbs());
      this.frameBuffer.requestHistoryWindow({
        anchorRow: timeCursor.anchorRow,
        displayRows: timeCursor.displayRows,
        following: timeCursor.follow,
        interacting: this.frameBuffer.historyGestureActive,
      });
      tooltipController.refresh();
      freqAxisController.update(viewport.start, viewport.end);
      subviewHighlightController.update(viewport.start, viewport.end);
      bandController.update(viewport.start, viewport.end);
      gridLineController.update(viewport.start, viewport.end);
      waterfallRenderer.render();
      liveRenderer.render();
      occupancyRenderer.render();
      annotationRenderer.render();
      timeLabelsController.render();
      for (const sv of this.subviews) sv.render();
      this.publishHistoryState();
    };
    const scheduleRender = () => {
      if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
      this.rafHandle = requestAnimationFrame(renderAll);
    };

    this.scheduleRender = scheduleRender;

    this.profileDragHandler = new ProfileRangeHandler(
      refs.live,
      viewport,
      (id, normStart, normEnd) => {
        const freqStartMHz = this.freqStart / 1000;
        const span = (this.binCount * this.resolution) / 1000;
        const startMHz = freqStartMHz + normStart * span;
        const endMHz = freqStartMHz + normEnd * span;
        this.profileRangesCache = this.profileRangesCache.map((r) =>
          r.id === id ? { ...r, freqStartMHz: startMHz, freqEndMHz: endMHz } : r,
        );
        const norm = this.toNormalizedRanges(this.profileRangesCache);
        annotationRenderer.setProfileRanges(norm);
        liveRenderer.setProfileRanges(norm);
        this.profileDragHandler?.setRanges(norm);
        this.tooltipController?.setProfileRanges(norm);
        scheduleRender();
        this.onProfileRangeChange?.(id, startMHz, endMHz);
      },
    );

    // shift+wheel on the waterfall scrolls time; the live pane keeps plain
    // frequency zoom only.
    this.waterfallInput = new InputHandler(refs.waterfall, viewport, renderAll, timeCursor);
    this.liveInput = new InputHandler(refs.live, viewport, renderAll);

    // The time gutter is the primary history control: a full-height column
    // rather than a thin scrollbar, so there is nothing small to hit.
    this.timeGutterInput = new TimeGutterInput(refs.timeLabels, timeCursor, {
      onUpdate: renderAll,
      onGestureStart: () => this.beginHistoryGesture(),
      onGestureEnd: () => this.endHistoryGesture(),
    });

    this.lastProcessedCount = buffer.totalWritten;
    this.frameBuffer.onPush = scheduleRender;
    this.frameBuffer.onHistoryLoad = scheduleRender;

    this.waterfallRenderer = waterfallRenderer;
    this.liveRenderer = liveRenderer;

    this.annotationRenderer = annotationRenderer;
    this.maxHold = maxHold;
    this.avgLayer = avgLayer;
    this.occupancyRenderer = occupancyRenderer;
    this.freqAxisController = freqAxisController;
    this.timeLabelsController = timeLabelsController;
    this.tooltipController = tooltipController;
    this.powerAxisController = powerAxisController;
    this.colormapLegendController = colormapLegendController;
    this.subviewHighlightController = subviewHighlightController;
    this.bandController = bandController;
    this.gridLineController = gridLineController;

    // D is the waterfall height in CSS pixels -- one row per pixel. Nothing is
    // reallocated when it changes: the waterfall takes a uniform, annotation
    // blocks are display-size independent, and labels are rebuilt per frame.
    // Applied after the fields above are set, since applyDisplayRows fans out
    // through them.
    this.applyDisplayRows(this.measureDisplayRows(refs.waterfall));
    this.waterfallResizeObserver = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      this.applyDisplayRows(Math.max(1, Math.floor(height ?? 1)));
      scheduleRender();
    });
    this.waterfallResizeObserver.observe(refs.waterfall);
  }

  destroy() {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.waterfallResizeObserver?.disconnect();
    this.waterfallResizeObserver = null;
    this.lastHistoryState = null;
    this.frameBuffer.onPush = null;
    this.frameBuffer.onHistoryLoad = null;
    this.profileDragHandler?.destroy();
    this.profileDragHandler = null;
    this.scheduleRender = null;
    this.waterfallRenderer?.destroy();
    this.liveRenderer?.destroy();
    this.waterfallInput?.destroy();
    this.timeGutterInput?.destroy();
    this.liveInput?.destroy();
    this.freqAxisController?.destroy();
    this.timeLabelsController?.destroy();
    this.tooltipController?.destroy();
    this.powerAxisController?.destroy();
    this.colormapLegendController?.destroy();
    this.subviewHighlightController?.destroy();
    this.bandController?.destroy();
    this.gridLineController?.destroy();

    this.waterfallRenderer = null;
    this.liveRenderer = null;

    this.annotationRenderer = null;
    this.maxHold = null;
    this.avgLayer = null;
    this.occupancyRenderer = null;
    this.freqAxisController = null;
    this.timeLabelsController = null;
    this.tooltipController = null;
    this.powerAxisController = null;
    this.colormapLegendController = null;
    this.subviewHighlightController = null;
    this.bandController = null;
    this.gridLineController = null;
    this.waterfallInput = null;
    this.timeGutterInput = null;
    this.liveInput = null;
    this.rafHandle = null;
    this.maxSnapshotData = null;
    for (const sv of this.subviews) sv.destroy();
    this.subviews = [];
  }

  resetAll() {
    this.maxHold?.reset();
    this.avgLayer?.reset();
    this.occupancyRenderer?.reset();
    this.onReset?.();
  }

  resetMaxHold() {
    this.maxHold?.reset();
  }

  takeMaxSnapshot(data?: Int8Array): Int8Array | null {
    if (!this.maxHold || !this.liveRenderer) return null;
    this.maxSnapshotData = data ? new Int8Array(data) : new Int8Array(this.maxHold.data);
    this.liveRenderer.setLayer("maxSnapshot", this.maxSnapshotData, "rgba(180, 80, 255, 0.85)", "line");
    this.liveRenderer.setLayerVisible("maxSnapshot", this.layerVisibility.maxSnapshot);
    return this.maxSnapshotData;
  }

  resetOccupancy() {
    this.occupancyRenderer?.reset();
  }

  addSubview(refs: SubviewRefs, subFreqStart: number, subFreqEnd: number): SubviewHandle {
    if (!this.maxHold || !this.avgLayer || !this.occupancyRenderer) throw new Error("mount() must be called before addSubview()");
    const globalSpan = this.binCount * this.resolution;
    const normalizedStart = (subFreqStart - this.freqStart) / globalSpan;
    const normalizedEnd = (subFreqEnd - this.freqStart) / globalSpan;
    const subview = new SpectrumSubviewCore(
      this.frameBuffer.spectrum,
      this.frameBuffer.annotations,
      this.historyRows,
      this.binCount,
      subFreqStart / 1000,
      subFreqEnd / 1000,
      normalizedStart,
      normalizedEnd,
      { displayMin: this.displayMin, displayMax: this.displayMax, colormap: this.colormap, layerVisibility: this.layerVisibility },
      [
        { id: "max", data: this.maxHold.data, color: "rgba(255, 80, 80, 0.85)", mode: "line" },
        { id: "avg", data: this.avgLayer.data, color: "rgba(250, 190, 40, 0.85)", mode: "line" },
      ],
      this.avgLayer,
      this.maxHold,
      this.occupancyRenderer.data,
      this.timeCursor,
      () => this.scheduleRender?.(),
    );
    subview.mount(refs);
    this.subviews.push(subview);
    return {
      destroy: () => {
        const idx = this.subviews.indexOf(subview);
        if (idx !== -1) this.subviews.splice(idx, 1);
        subview.destroy();
      },
    };
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
    for (const sv of this.subviews) sv.updateDisplayRange(min, max);
  }

  setColormap(colormap: number) {
    this.colormap = colormap;
    const lut = buildLUT(COLORMAPS[colormap]);
    this.waterfallRenderer?.updateColormap(lut);
    this.colormapLegendController?.update(this.displayMin, this.displayMax, colormap);
    for (const sv of this.subviews) sv.updateColormap(lut);
  }

  setLayerVisibility(vis: Partial<LayerVisibility>) {
    this.layerVisibility = { ...this.layerVisibility, ...vis };
    this.liveRenderer?.updateLayerVisibility(this.layerVisibility);
    if (vis.annotations !== undefined) {
      this.annotationRenderer?.setVisible(vis.annotations);
      this.annotationRenderer?.render();
    }
    for (const sv of this.subviews) sv.updateLayerVisibility(vis);
  }

  setAvgTau(tau: number) {
    this.avgTau = tau;
    this.avgLayer?.setTau(tau);
  }

  setOccupancyThreshold(threshold: number) {
    this.occupancyThreshold = threshold;
    this.occupancyRenderer?.setThreshold(threshold);
  }

  setSubviewHighlights(ranges: HighlightRange[]) {
    this.subviewHighlightController?.setRanges(ranges);
  }

  setBands(bands: Band[]) {
    this.bandController?.setBands(bands);
    this.scheduleRender?.();
  }

  setProfileRanges(ranges: ProfileRange[]) {
    this.profileRangesCache = ranges;
    const norm = this.toNormalizedRanges(ranges);
    this.annotationRenderer?.setProfileRanges(norm);
    this.liveRenderer?.setProfileRanges(norm);
    this.profileDragHandler?.setRanges(norm);
    this.tooltipController?.setProfileRanges(norm);
    this.scheduleRender?.();
  }

  private toNormalizedRanges(ranges: ProfileRange[]): NormalizedRange[] {
    const freqStartMHz = this.freqStart / 1000;
    const span = (this.binCount * this.resolution) / 1000;
    return ranges.map((r) => ({
      id: r.id,
      numericId: r.numericId,
      name: r.name,
      start: (r.freqStartMHz - freqStartMHz) / span,
      end: (r.freqEndMHz - freqStartMHz) / span,
      powerDbm: r.powerDbm,
    }));
  }
}
