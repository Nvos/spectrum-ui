import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { AnnotationManager } from "./AnnotationManager";
import { InputHandler } from "./InputHandler";
import { AverageLayer } from "./AverageLayer";
import { LiveManager } from "./LiveManager";
import { MaxHoldLayer } from "./MaxHoldLayer";
import { OccupancyLayer } from "./OccupancyLayer";
import { OccupancyManager } from "./OccupancyManager";
import { FrameBuffer } from "./FrameBuffer";
import * as styles from "./Spectrum.css";
import type { SpectrumStore } from "./store";
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
  rowCount: number;
  binCount: number;
  frameBuffer: FrameBuffer;
  initialData?: SpectrumInitialData;
  store: SpectrumStore;
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
      initialData,
      store,
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

    // oxlint-disable-next-line max-lines-per-function
    useEffect(() => {
      const waterfallCanvas = waterfallRef.current!;
      const liveCanvas = liveRef.current!;
      const waterfallManager = new WaterfallManager(rowCount, binCount, buffer, store);
      const liveManager = new LiveManager(binCount, buffer, store);

      const viewport = new Viewport(binCount, waterfallCanvas);
      viewportRef.current = viewport;

      waterfallManager.mount(waterfallCanvas, viewport);
      liveManager.mount(liveCanvas, viewport);

      const maxHold = new MaxHoldLayer(binCount, buffer, initialData?.maxHold);
      maxHoldRef.current = maxHold;
      liveManager.setLayer("max", maxHold.data, "rgba(255, 80, 80, 0.85)");

      const avgLayer = new AverageLayer(binCount, buffer, store);
      avgLayerRef.current = avgLayer;
      liveManager.setLayer("avg", avgLayer.data, "rgba(250, 190, 40, 0.85)");

      const occupancyLayer = new OccupancyLayer(binCount, buffer, store, initialData?.occupancy);
      occupancyLayerRef.current = occupancyLayer;
      const occupancyRenderer = new OccupancyManager(binCount, occupancyLayer.data);
      occupancyRendererRef.current = occupancyRenderer;
      occupancyRenderer.mount(occupancyRef.current!, viewport);

      const annotationManager = new AnnotationManager(
        annotationBuffer,
        rowCount,
        binCount,
        store,
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
        waterfallManager.destroy();
        liveManager.destroy();
        waterfallInputHandler.destroy();
        liveInputHandler.destroy();
      };
    }, [waterfallRef, liveRef, buffer, binCount, rowCount, updateFreqAxis]);

    useImperativeHandle(ref, () => ({
      resetMaxHold: () => maxHoldRef.current?.reset(),
      resetOccupancy: () => occupancyLayerRef.current?.reset(),
    }));

    return (
      <>
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
      </>
    );
  },
);
