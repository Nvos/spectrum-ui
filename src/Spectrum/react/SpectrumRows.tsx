import type { RefObject } from "react";
import * as styles from "./SpectrumRows.css";

type LiveRowProps = {
  liveRef: RefObject<HTMLCanvasElement | null>;
  powerAxisRef: RefObject<HTMLDivElement | null>;
};

export const LiveRow = ({ liveRef, powerAxisRef }: LiveRowProps) => {
  return (
    <div className={styles.liveRow}>
      <div ref={powerAxisRef} />
      <canvas className={styles.liveCanvas} ref={liveRef} />
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
  colormapLegendRef: RefObject<HTMLDivElement | null>;
};

export const WaterfallRow = ({ waterfallRef, annotationRef, timeLabelsRef, colormapLegendRef }: WaterfallRowProps) => {
  return (
    <div className={styles.waterfallRow}>
      <div ref={timeLabelsRef} className={styles.timeLabels} />
      <div className={styles.waterfallCanvasContainer}>
        <canvas className={styles.waterfallCanvas} ref={waterfallRef} />
        <canvas className={styles.annotationCanvas} ref={annotationRef} />
      </div>
      <div ref={colormapLegendRef} />
    </div>
  );
};

type LayoutProps = {
  liveRef: RefObject<HTMLCanvasElement | null>;
  waterfallRef: RefObject<HTMLCanvasElement | null>;
  annotationRef: RefObject<HTMLCanvasElement | null>;
  occupancyRef: RefObject<HTMLCanvasElement | null>;
  freqAxisRef: RefObject<HTMLDivElement | null>;
  timeLabelsRef: RefObject<HTMLDivElement | null>;
  powerAxisRef: RefObject<HTMLDivElement | null>;
  colormapLegendRef: RefObject<HTMLDivElement | null>;
};

export const SpectrumLayout = ({
  liveRef,
  waterfallRef,
  annotationRef,
  occupancyRef,
  freqAxisRef,
  timeLabelsRef,
  powerAxisRef,
  colormapLegendRef,
}: LayoutProps) => {
  return (
    <div className={styles.layout}>
      <div className={styles.layoutInner}>
        <LiveRow liveRef={liveRef} powerAxisRef={powerAxisRef} />
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
          colormapLegendRef={colormapLegendRef}
        />
      </div>
    </div>
  );
};
