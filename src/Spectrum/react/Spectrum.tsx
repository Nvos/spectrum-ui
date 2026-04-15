import { useEffect, useRef } from "react";
import type { SpectrumCore } from "../core/SpectrumCore";
import * as styles from "./styles.css";
import { SpectrumLayout } from "./SpectrumRows";

type Props = {
  core: SpectrumCore;
};

export const Spectrum = ({ core }: Props) => {
  const liveRef = useRef<HTMLCanvasElement>(null);
  const waterfallRef = useRef<HTMLCanvasElement>(null);
  const annotationRef = useRef<HTMLCanvasElement>(null);
  const occupancyRef = useRef<HTMLCanvasElement>(null);
  const freqAxisRef = useRef<HTMLDivElement>(null);
  const subviewHighlightRef = useRef<HTMLDivElement>(null);
  const timeLabelsRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const powerAxisRef = useRef<HTMLDivElement>(null);
  const colormapLegendRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    core.mount({
      waterfall: waterfallRef.current!,
      live: liveRef.current!,
      annotation: annotationRef.current!,
      occupancy: occupancyRef.current!,
      freqAxis: freqAxisRef.current!,
      subviewHighlight: subviewHighlightRef.current!,
      timeLabels: timeLabelsRef.current!,
      tooltip: tooltipRef.current!,
      powerAxis: powerAxisRef.current!,
      colormapLegend: colormapLegendRef.current!,
    });
    return () => core.destroy();
  }, [core]);

  return (
    <>
      <SpectrumLayout
        liveRef={liveRef}
        annotationRef={annotationRef}
        waterfallRef={waterfallRef}
        occupancyRef={occupancyRef}
        freqAxisRef={freqAxisRef}
        subviewHighlightRef={subviewHighlightRef}
        timeLabelsRef={timeLabelsRef}
        powerAxisRef={powerAxisRef}
        colormapLegendRef={colormapLegendRef}
      />
      <div ref={tooltipRef} className={styles.tooltip} style={{ display: "none" }} />
    </>
  );
};
