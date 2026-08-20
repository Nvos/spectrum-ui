import type { CSSProperties, ReactNode, RefObject } from "react";
import * as styles from "./SpectrumRows.css";

type BandRowProps = {
  bandContainerRef: RefObject<HTMLDivElement | null>;
};

export const BandRow = ({ bandContainerRef }: BandRowProps) => {
  return (
    <div className={styles.bandRow}>
      <div className={styles.bandRowSpacer} />
      <div ref={bandContainerRef} className={styles.bandContainer} />
      <div className={styles.laneSpacer} />
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
      <div className={styles.laneSpacer} />
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
      <div className={styles.laneSpacer} />
      <div className={styles.spacerW10} />
    </div>
  );
};

type WaterfallRowProps = {
  waterfallRef: RefObject<HTMLCanvasElement | null>;
  annotationRef: RefObject<HTMLCanvasElement | null>;
  timeLabelsRef: RefObject<HTMLDivElement | null>;
  colormapLegendRef: RefObject<HTMLDivElement | null>;
  /** Measured to cap the lane strip against the row it takes its width from. */
  rowRef?: RefObject<HTMLDivElement | null>;
  /** Frequency lanes, sharing this row's height and so the main view's time axis. */
  lanes?: ReactNode;
  /** History scrollbar / follow indicator, overlaid on the waterfall. */
  overlay?: ReactNode;
};

export const WaterfallRow = ({ waterfallRef, annotationRef, timeLabelsRef, colormapLegendRef, rowRef, lanes, overlay }: WaterfallRowProps) => {
  return (
    <div className={styles.waterfallRow} ref={rowRef}>
      <div ref={timeLabelsRef} className={styles.timeLabels} />
      <div className={styles.waterfallCanvasContainer}>
        <canvas className={styles.waterfallCanvas} ref={waterfallRef} />
        <canvas className={styles.annotationCanvas} ref={annotationRef} />
        {overlay}
      </div>
      {lanes}
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
  bandContainerRef: RefObject<HTMLDivElement | null>;
  gridContainerRef: RefObject<HTMLDivElement | null>;
  waterfallRowRef?: RefObject<HTMLDivElement | null>;
  lanes?: ReactNode;
  /** Width the lane strip occupies, reserved on every row above the waterfall. */
  laneTotalWidthPx?: number;
  waterfallOverlay?: ReactNode;
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
  bandContainerRef,
  gridContainerRef,
  waterfallRowRef,
  lanes,
  laneTotalWidthPx = 0,
  waterfallOverlay,
}: LayoutProps) => {
  return (
    <div className={styles.layout}>
      <div
        className={styles.layoutInner}
        style={{ [styles.laneTotalWidthProperty]: `${laneTotalWidthPx}px` } as CSSProperties}
      >
        <BandRow bandContainerRef={bandContainerRef} />
        <LiveRow liveRef={liveRef} powerAxisRef={powerAxisRef} gridContainerRef={gridContainerRef} />
        <OccupancyRow occupancyRef={occupancyRef} />
        <div className={styles.freqAxisRow}>
          <div className={styles.freqAxisLeft} />
          <div className={styles.freqAxisContainer} ref={freqAxisRef} />
          <div className={styles.laneSpacer} />
          <div className={styles.freqAxisRight} />
        </div>
        <WaterfallRow
          waterfallRef={waterfallRef}
          annotationRef={annotationRef}
          timeLabelsRef={timeLabelsRef}
          colormapLegendRef={colormapLegendRef}
          rowRef={waterfallRowRef}
          lanes={lanes}
          overlay={waterfallOverlay}
        />
      </div>
    </div>
  );
};
