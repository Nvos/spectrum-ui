import { useEffect, useRef } from "react";
import type { SpectrumCore } from "../core/SpectrumCore";
import * as styles from "./SpectrumSubviewRows.css";
import * as tooltipStyles from "./styles.css";

type Props = {
  core: SpectrumCore;
  freqStart: number;
  freqEnd: number;
};

export const SpectrumSubview = ({ core, freqStart, freqEnd }: Props) => {
  const waterfallRef = useRef<HTMLCanvasElement>(null);
  const annotationRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const occupancyRef = useRef<HTMLCanvasElement>(null);
  const freqAxisRef = useRef<HTMLDivElement>(null);
  const powerAxisRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = core.addSubview(
      {
        waterfall: waterfallRef.current!,
        annotation: annotationRef.current!,
        live: liveRef.current!,
        occupancy: occupancyRef.current!,
        freqAxis: freqAxisRef.current!,
        powerAxis: powerAxisRef.current!,
        tooltip: tooltipRef.current!,
      },
      freqStart,
      freqEnd,
    );
    return () => handle.destroy();
  }, [core, freqStart, freqEnd]);

  return (
    <>
      <div className={styles.subviewLayout}>
        <div className={styles.subviewLiveRow}>
          <div ref={powerAxisRef} />
          <canvas className={styles.subviewLiveCanvas} ref={liveRef} />
        </div>
        <div className={styles.subviewOccupancyRow}>
          <div className={styles.subviewOccupancySpacer} />
          <canvas className={styles.subviewOccupancyCanvas} ref={occupancyRef} />
        </div>
        <div className={styles.subviewFreqAxisRow}>
          <div className={styles.subviewFreqAxisLeft} />
          <div className={styles.subviewFreqAxisContainer} ref={freqAxisRef} />
        </div>
        <div className={styles.subviewWaterfallRow}>
          <div className={styles.subviewWaterfallLeft} />
          <div className={styles.subviewWaterfallContainer}>
            <canvas className={styles.subviewWaterfallCanvas} ref={waterfallRef} />
            <canvas className={styles.subviewAnnotationCanvas} ref={annotationRef} />
          </div>
        </div>
      </div>
      <div ref={tooltipRef} className={tooltipStyles.tooltip} style={{ display: "none" }} />
    </>
  );
};
