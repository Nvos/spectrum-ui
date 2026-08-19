import type { ReactNode, RefObject } from "react";
import * as styles from "./SpectrumRows.css";

type BandRowProps = {
  bandContainerRef: RefObject<HTMLDivElement | null>;
};

export const BandRow = ({ bandContainerRef }: BandRowProps) => {
  return (
    <div className={styles.bandRow}>
      <div className={styles.bandRowSpacer} />
      <div ref={bandContainerRef} className={styles.bandContainer} />
      <div className={styles.spacerW10} />
    </div>
  );
};

type LiveRowProps = {
  liveRef: RefObject<HTMLCanvasElement | null>;
  powerAxisRef: RefObject<HTMLDivElement | null>;
  gridContainerRef: RefObject<HTMLDivElement | null>;
};

export const LiveRow = ({ liveRef, powerAxisRef, gridContainerRef }: LiveRowProps) => {
  return (
    <div className={styles.liveRow}>
      <div ref={powerAxisRef} />
      <div className={styles.liveCanvasWrapper}>
        <canvas className={styles.liveCanvas} ref={liveRef} />
        <div ref={gridContainerRef} className={styles.gridOverlay} />
      </div>
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
  /** History scrollbar / follow indicator, overlaid on the waterfall. */
  overlay?: ReactNode;
};

export const WaterfallRow = ({ waterfallRef, annotationRef, timeLabelsRef, colormapLegendRef, overlay }: WaterfallRowProps) => {
  return (
    <div className={styles.waterfallRow}>
      <div ref={timeLabelsRef} className={styles.timeLabels} />
      <div className={styles.waterfallCanvasContainer}>
        <canvas className={styles.waterfallCanvas} ref={waterfallRef} />
        <canvas className={styles.annotationCanvas} ref={annotationRef} />
        {overlay}
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
  subviewHighlightRef: RefObject<HTMLDivElement | null>;
  timeLabelsRef: RefObject<HTMLDivElement | null>;
  powerAxisRef: RefObject<HTMLDivElement | null>;
  colormapLegendRef: RefObject<HTMLDivElement | null>;
  bandContainerRef: RefObject<HTMLDivElement | null>;
  gridContainerRef: RefObject<HTMLDivElement | null>;
  waterfallOverlay?: ReactNode;
};

export const SpectrumLayout = ({
  liveRef,
  waterfallRef,
  annotationRef,
  occupancyRef,
  freqAxisRef,
  subviewHighlightRef,
  timeLabelsRef,
  powerAxisRef,
  colormapLegendRef,
  bandContainerRef,
  gridContainerRef,
  waterfallOverlay,
}: LayoutProps) => {
  return (
    <div className={styles.layout}>
      <div className={styles.layoutInner}>
        <BandRow bandContainerRef={bandContainerRef} />
        <LiveRow liveRef={liveRef} powerAxisRef={powerAxisRef} gridContainerRef={gridContainerRef} />
        <OccupancyRow occupancyRef={occupancyRef} />
        <div className={styles.freqAxisRow}>
          <div className={styles.freqAxisLeft} />
          <div className={styles.freqAxisContainer} ref={freqAxisRef}>
            <div ref={subviewHighlightRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
          </div>
          <div className={styles.freqAxisRight} />
        </div>
        <WaterfallRow
          waterfallRef={waterfallRef}
          annotationRef={annotationRef}
          timeLabelsRef={timeLabelsRef}
          colormapLegendRef={colormapLegendRef}
          overlay={waterfallOverlay}
        />
      </div>
    </div>
  );
};
