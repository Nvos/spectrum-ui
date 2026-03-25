import { useAtomValue } from "jotai";
import type { RefObject } from "react";
import { ColormapLegend } from "./ColormapLegend";
import { PowerAxis } from "./PowerAxis";
import { displayMaxAtom, displayMinAtom } from "./store";
import * as styles from "./SpectrumRows.css";

type LiveRowProps = {
  liveRef: RefObject<HTMLCanvasElement | null>;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseLeave: () => void;
};

export const LiveRow = ({ liveRef, onMouseMove, onMouseLeave }: LiveRowProps) => {
  const displayMin = useAtomValue(displayMinAtom);
  const displayMax = useAtomValue(displayMaxAtom);
  return (
    <div className={styles.liveRow}>
      <PowerAxis powerMin={displayMin} powerMax={displayMax} />
      <canvas
        className={styles.liveCanvas}
        ref={liveRef}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      />
      <div className={styles.spacerW10} />
    </div>
  );
};

type OccupancyRowProps = {
  occupancyRef: RefObject<HTMLCanvasElement | null>;
};

export const OccupancyRow = ({ occupancyRef }: OccupancyRowProps) => {
  return (
    <div className={styles.occupancyRow}>
      <div className={styles.occupancyRowSpacer} />
      <canvas className={styles.occupancyCanvas} ref={occupancyRef} />
      <div className={styles.spacerW10} />
    </div>
  );
};

type WaterfallRowProps = {
  waterfallRef: RefObject<HTMLCanvasElement | null>;
  annotationRef: RefObject<HTMLCanvasElement | null>;
  timeLabelsRef: RefObject<HTMLDivElement | null>;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseLeave: () => void;
};

export const WaterfallRow = ({
  waterfallRef,
  annotationRef,
  timeLabelsRef,
  onMouseMove,
  onMouseLeave,
}: WaterfallRowProps) => {
  return (
    <div className={styles.waterfallRow}>
      <div ref={timeLabelsRef} className={styles.timeLabels} />
      <div className={styles.waterfallCanvasContainer}>
        <canvas
          className={styles.waterfallCanvas}
          ref={waterfallRef}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        />
        <canvas className={styles.annotationCanvas} ref={annotationRef} />
      </div>
      <ColormapLegend />
    </div>
  );
};

export type CanvasHandlers = {
  onLiveMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onWaterfallMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseLeave: () => void;
};

type LayoutProps = {
  liveRef: RefObject<HTMLCanvasElement | null>;
  waterfallRef: RefObject<HTMLCanvasElement | null>;
  annotationRef: RefObject<HTMLCanvasElement | null>;
  occupancyRef: RefObject<HTMLCanvasElement | null>;
  freqAxisRef: RefObject<HTMLDivElement | null>;
  timeLabelsRef: RefObject<HTMLDivElement | null>;
  canvasHandlers: CanvasHandlers;
};

export const SpectrumLayout = ({
  liveRef,
  waterfallRef,
  annotationRef,
  occupancyRef,
  freqAxisRef,
  timeLabelsRef,
  canvasHandlers,
}: LayoutProps) => {
  return (
    <div className={styles.layout}>
      <div className={styles.layoutInner}>
        <LiveRow
          liveRef={liveRef}
          onMouseMove={canvasHandlers.onLiveMouseMove}
          onMouseLeave={canvasHandlers.onMouseLeave}
        />
        <OccupancyRow occupancyRef={occupancyRef} />
        <div className={styles.freqAxisRow}>
          <div className={styles.freqAxisLeft} />
          <div className={styles.freqAxisContainer} ref={freqAxisRef} />
          <div className={styles.freqAxisRight} />
        </div>
        <WaterfallRow
          waterfallRef={waterfallRef}
          annotationRef={annotationRef}
          timeLabelsRef={timeLabelsRef}
          onMouseMove={canvasHandlers.onWaterfallMouseMove}
          onMouseLeave={canvasHandlers.onMouseLeave}
        />
      </div>
    </div>
  );
};
