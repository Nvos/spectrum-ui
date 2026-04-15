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
  const liveRef = useRef<HTMLCanvasElement>(null);
  const freqAxisRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = core.addSubview(
      {
        waterfall: waterfallRef.current!,
        live: liveRef.current!,
        freqAxis: freqAxisRef.current!,
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
          <canvas className={styles.subviewLiveCanvas} ref={liveRef} />
        </div>
        <div className={styles.subviewFreqAxisRow}>
          <div className={styles.subviewFreqAxisContainer} ref={freqAxisRef} />
        </div>
        <div className={styles.subviewWaterfallRow}>
          <canvas className={styles.subviewWaterfallCanvas} ref={waterfallRef} />
        </div>
      </div>
      <div ref={tooltipRef} className={tooltipStyles.tooltip} style={{ display: "none" }} />
    </>
  );
};
