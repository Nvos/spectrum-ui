import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { AnnotationManager } from "./AnnotationManager";
import { buildLUT, COLORMAPS } from "./colormaps";
import { POWER_CEILING } from "./constants";
import { InputHandler } from "./InputHandler";
import { AverageLayer } from "./AverageLayer";
import { LiveManager } from "./LiveManager";
import { MaxHoldLayer } from "./MaxHoldLayer";
import { OccupancyLayer } from "./OccupancyLayer";
import { OccupancyManager } from "./OccupancyManager";
import { FrameBuffer } from "./FrameBuffer";
import * as styles from "./Spectrum.css";
import { SpectrumDisplayContext } from "./SpectrumContext";
import { SpectrumLayout } from "./SpectrumRows";
import { useFrequencyAxis } from "./useFrequencyAxis";
import { useSpectrumTooltip } from "./useSpectrumTooltip";
import { useTimeLabels } from "./useTimeLabels";
import { Viewport } from "./Viewport";
import { WaterfallManager } from "./WaterfallManager";

export type SpectrumInitialData = {
  spectrum: { rows: Int8Array; count: number; timestamps: number[] };
  annotations: { rows: Int8Array; count: number; timestamps: number[] };
  maxHold: Int8Array;
  occupancy: { values: Float32Array; total: number };
};

type Props = {
  // kHz
  freqStart: number;
  // kHz per bin
  resolution: number;
  // dBm — adjustable display floor
  displayMin: number;
  // dBm — adjustable display ceiling
  displayMax: number;
  colorMap: number;
  rowCount: number;
  binCount: number;
  frameBuffer: FrameBuffer;
  layerVisibility: Record<string, boolean>;
  avgTau: number;
  occupancyThreshold: number;
  annotationsVisible: boolean;
  initialData?: SpectrumInitialData;
  onDisplayMinChange: (v: number) => void;
  onDisplayMaxChange: (v: number) => void;
};

export type SpectrumHandle = {
  resetMaxHold: () => void;
  resetOccupancy: () => void;
};

// oxlint-disable-next-line max-lines-per-function
export const Spectrum = forwardRef<SpectrumHandle, Props>(
  (
    {
      frameBuffer,
      rowCount,
      binCount,
      freqStart,
      resolution,
      displayMin,
      displayMax,
      colorMap,
      layerVisibility,
      avgTau,
      occupancyThreshold,
      annotationsVisible,
      initialData,
      onDisplayMinChange,
      onDisplayMaxChange,
    },
    ref,
  ) => {
    const { spectrum: buffer, annotations: annotationBuffer } = frameBuffer;
    const freqStartMHz = freqStart / 1000;
    const freqEndMHz = freqStartMHz + (binCount * resolution) / 1000;

    const liveRef = useRef<HTMLCanvasElement>(null);
    const waterfallRef = useRef<HTMLCanvasElement>(null);
    const annotationRef = useRef<HTMLCanvasElement>(null);
    const timeLabelsRef = useRef<HTMLDivElement>(null);
    const managerRef = useRef(
      new WaterfallManager(rowCount, binCount, buffer, displayMin, POWER_CEILING),
    );
    const liveManagerRef = useRef(new LiveManager(binCount, buffer, displayMin, POWER_CEILING));
    const frequencyAxis = useFrequencyAxis({ freqMin: freqStartMHz, freqMax: freqEndMHz });
    const { update: updateFreqAxis } = frequencyAxis;
    const maxHoldRef = useRef<MaxHoldLayer | null>(null);
    const avgLayerRef = useRef<AverageLayer | null>(null);
    const occupancyRef = useRef<HTMLCanvasElement>(null);
    const occupancyLayerRef = useRef<OccupancyLayer | null>(null);
    const occupancyRendererRef = useRef<OccupancyManager | null>(null);
    const annotationManagerRef = useRef<AnnotationManager | null>(null);
    const viewportRef = useRef<Viewport | null>(null);
    const { tooltipRef, refreshTooltipRef, canvasHandlers } = useSpectrumTooltip({
      viewportRef,
      freqStartMHz,
      freqEndMHz,
      binCount,
      rowCount,
      buffer,
      avgLayerRef,
      maxHoldRef,
      occupancyLayerRef,
    });

    useTimeLabels(timeLabelsRef, buffer, rowCount);

    useEffect(() => {
      managerRef.current.updateColormap(buildLUT(COLORMAPS[colorMap]));
    }, [colorMap]);

    useEffect(() => {
      managerRef.current.updateDisplayMin(displayMin);
      liveManagerRef.current.updateDisplayMin(displayMin);
    }, [displayMin]);

    useEffect(() => {
      managerRef.current.updateDisplayMax(displayMax);
      liveManagerRef.current.updateDisplayMax(displayMax);
    }, [displayMax]);

    // oxlint-disable-next-line max-lines-per-function
    useEffect(() => {
      const waterfallCanvas = waterfallRef.current!;
      const liveCanvas = liveRef.current!;
      const waterfallManager = managerRef.current;
      const liveManager = liveManagerRef.current;

      const viewport = new Viewport(binCount, waterfallCanvas);
      viewportRef.current = viewport;

      waterfallManager.mount(waterfallCanvas, viewport);
      liveManager.mount(liveCanvas, viewport);

      const maxHold = new MaxHoldLayer(binCount, buffer, initialData?.maxHold);
      maxHoldRef.current = maxHold;
      liveManager.setLayer("max", maxHold.data, "rgba(255, 80, 80, 0.85)");

      const avgLayer = new AverageLayer(binCount, buffer);
      avgLayerRef.current = avgLayer;
      liveManager.setLayer("avg", avgLayer.data, "rgba(250, 190, 40, 0.85)");

      const occupancyLayer = new OccupancyLayer(binCount, buffer, undefined, initialData?.occupancy);
      occupancyLayerRef.current = occupancyLayer;
      const occupancyRenderer = new OccupancyManager(binCount, occupancyLayer.data);
      occupancyRendererRef.current = occupancyRenderer;
      occupancyRenderer.mount(occupancyRef.current!, viewport);

      const annotationManager = new AnnotationManager(
        annotationBuffer,
        rowCount,
        binCount,
      );
      annotationManager.mount(annotationRef.current!, viewport);
      annotationManagerRef.current = annotationManager;
      liveManager.setAnnotation(
        annotationBuffer,
        annotationManager.rowActivity,
        rowCount,
      );

      let rafHandle: number | null = null;
      const renderAll = () => {
        updateFreqAxis(viewport.start, viewport.end);
        waterfallManager.render();
        liveManager.render();
        occupancyRenderer.render();
        annotationManager.render();
      };
      const scheduleRender = () => {
        if (rafHandle !== null) cancelAnimationFrame(rafHandle);
        rafHandle = requestAnimationFrame(renderAll);
      };
      const waterfallInputHandler = new InputHandler(waterfallCanvas, viewport, renderAll);
      const liveInputHandler = new InputHandler(liveCanvas, viewport, renderAll);

      const unsubscribeBuffer = buffer.subscribe((writtenRow) => {
        waterfallManager.push(writtenRow);
        scheduleRender();
        refreshTooltipRef.current();
      });

      return () => {
        if (rafHandle !== null) cancelAnimationFrame(rafHandle);
        unsubscribeBuffer();
        annotationManager.destroy();
        annotationManagerRef.current = null;
        viewportRef.current = null;
        maxHoldRef.current = null;
        maxHold.destroy();
        avgLayerRef.current = null;
        avgLayer.destroy();
        occupancyLayerRef.current = null;
        occupancyRendererRef.current = null;
        occupancyLayer.destroy();
        waterfallInputHandler.destroy();
        liveInputHandler.destroy();
      };
    }, [waterfallRef, liveRef, buffer, binCount, updateFreqAxis]);

    useEffect(() => {
      const liveManager = liveManagerRef.current;
      for (const [id, visible] of Object.entries(layerVisibility)) {
        liveManager.setLayerVisible(id, visible);
      }
      liveManager.render();
    }, [layerVisibility]);

    useEffect(() => {
      if (avgLayerRef.current) avgLayerRef.current.tau = avgTau;
    }, [avgTau]);

    useEffect(() => {
      const layer = occupancyLayerRef.current;
      if (layer) {
        layer.threshold = occupancyThreshold;
        layer.reset();
      }
    }, [occupancyThreshold]);

    useEffect(() => {
      annotationManagerRef.current?.setVisible(annotationsVisible);
      liveManagerRef.current.setAnnotationVisible(annotationsVisible);
      liveManagerRef.current.render();
    }, [annotationsVisible]);

    useImperativeHandle(ref, () => ({
      resetMaxHold: () => maxHoldRef.current?.reset(),
      resetOccupancy: () => occupancyLayerRef.current?.reset(),
    }));

    const displaySettings = {
      colorMap,
      displayMin,
      displayMax,
      onDisplayMinChange,
      onDisplayMaxChange,
    };

    return (
      <SpectrumDisplayContext.Provider value={displaySettings}>
        <SpectrumLayout
          liveRef={liveRef}
          annotationRef={annotationRef}
          waterfallRef={waterfallRef}
          occupancyRef={occupancyRef}
          freqAxisRef={frequencyAxis.containerRef}
          timeLabelsRef={timeLabelsRef}
          canvasHandlers={canvasHandlers}
        />
        <div ref={tooltipRef} className={styles.tooltip} style={{ display: "none" }} />
      </SpectrumDisplayContext.Provider>
    );
  },
);
