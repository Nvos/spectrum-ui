import { useCallback, useRef } from "react";
import * as styles from "./Spectrum.css";
import type { AverageLayer } from "./AverageLayer";
import type { MaxHoldLayer } from "./MaxHoldLayer";
import type { OccupancyLayer } from "./OccupancyLayer";
import type { RingBuffer } from "./RingBuffer";
import type { Viewport } from "./Viewport";

type MousePosition = {
  clientX: number;
  clientY: number;
  normX: number;
  waterfallNormY: number | undefined;
};

type Props = {
  viewportRef: React.RefObject<Viewport | null>;
  freqStartMHz: number;
  freqEndMHz: number;
  binCount: number;
  rowCount: number;
  buffer: RingBuffer;
  avgLayerRef: React.RefObject<AverageLayer | null>;
  maxHoldRef: React.RefObject<MaxHoldLayer | null>;
  occupancyLayerRef: React.RefObject<OccupancyLayer | null>;
};

export function useSpectrumTooltip({
  viewportRef,
  freqStartMHz,
  freqEndMHz,
  binCount,
  rowCount,
  buffer,
  avgLayerRef,
  maxHoldRef,
  occupancyLayerRef,
}: Props) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const lastMouseRef = useRef<MousePosition | null>(null);

  const refreshTooltip = useCallback(() => {
    const pos = lastMouseRef.current;
    const viewport = viewportRef.current;
    const tt = tooltipRef.current;
    if (!pos || !viewport || !tt) return;

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
    const avg = avgLayerRef.current?.data[binIndex];
    const max = maxHoldRef.current?.data[binIndex];
    const occ = occupancyLayerRef.current?.data[binIndex];

    const cell = (label: string, value: string) =>
      `<span class="${styles.tooltipLabel}">${label}</span><span>${value}</span>`;

    tt.innerHTML =
      cell("freq", `${freqMHz.toFixed(3)} MHz`) +
      cell("live", `${dbm} dBm`) +
      (avg !== undefined ? cell("avg", `${avg.toFixed(1)} dBm`) : "") +
      (max !== undefined && isFinite(max) ? cell("max", `${max.toFixed(1)} dBm`) : "") +
      (occ !== undefined ? cell("occ", `${(occ * 100).toFixed(1)}%`) : "");

    tt.style.left = `${pos.clientX + 8}px`;
    tt.style.top = `${pos.clientY - 8}px`;
  }, [
    freqStartMHz,
    freqEndMHz,
    binCount,
    rowCount,
    buffer,
    avgLayerRef,
    maxHoldRef,
    occupancyLayerRef,
    viewportRef,
  ]);

  const refreshTooltipRef = useRef(refreshTooltip);
  refreshTooltipRef.current = refreshTooltip;

  const handleLiveMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!viewportRef.current || !tooltipRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      lastMouseRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        normX: (e.clientX - rect.left) / rect.width,
        waterfallNormY: undefined,
      };
      tooltipRef.current.style.display = "grid";
      refreshTooltip();
    },
    [refreshTooltip, viewportRef],
  );

  const handleWaterfallMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!viewportRef.current || !tooltipRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      lastMouseRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        normX: (e.clientX - rect.left) / rect.width,
        waterfallNormY: (e.clientY - rect.top) / rect.height,
      };
      tooltipRef.current.style.display = "grid";
      refreshTooltip();
    },
    [refreshTooltip, viewportRef],
  );

  const handleCanvasMouseLeave = useCallback(() => {
    lastMouseRef.current = null;
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
  }, []);

  return {
    tooltipRef,
    refreshTooltipRef,
    canvasHandlers: {
      onLiveMouseMove: handleLiveMouseMove,
      onWaterfallMouseMove: handleWaterfallMouseMove,
      onMouseLeave: handleCanvasMouseLeave,
    },
  };
}
