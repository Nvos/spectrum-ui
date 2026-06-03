import { useEffect, useRef } from "react";
import type { SpectrumCore } from "../core/SpectrumCore";
import type { Band } from "../core/BandTypes";
import type { ProfileRange } from "../core/ProfileTypes";
import * as styles from "./styles.css";
import { SpectrumLayout } from "./SpectrumRows";

type Props = {
  core: SpectrumCore;
  profileRanges?: ProfileRange[];
  bands?: Band[];
};

export const Spectrum = ({ core, profileRanges, bands }: Props) => {
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
  const bandContainerRef = useRef<HTMLDivElement>(null);
  const bandTooltipRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

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
      bandContainer: bandContainerRef.current!,
      bandTooltip: bandTooltipRef.current!,
      gridContainer: gridContainerRef.current!,
    });
    return () => core.destroy();
  }, [core]);

  useEffect(() => {
    core.setProfileRanges(profileRanges ?? []);
  }, [core, profileRanges]);

  useEffect(() => {
    core.setBands(bands ?? []);
  }, [core, bands]);

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
        bandContainerRef={bandContainerRef}
        gridContainerRef={gridContainerRef}
      />
      <div ref={tooltipRef} className={styles.tooltip} style={{ display: "none" }} />
      <div ref={bandTooltipRef} className={styles.tooltip} style={{ display: "none" }} />
    </>
  );
};
