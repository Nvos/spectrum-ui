import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { SpectrumCore } from "../core/SpectrumCore";
import type { Band } from "../core/BandTypes";
import type { ProfileRange } from "../core/ProfileTypes";
import { MAX_LANES } from "../core/constants";
import * as styles from "./styles.css";
import * as rowStyles from "./SpectrumRows.css";
import { HistoryControls } from "./HistoryControls";
import { SpectrumLayout } from "./SpectrumRows";
import { followingAtom, historyPositionAtom } from "./store";

/** 6rem — wide enough to read a label, narrow enough that a fourth lane is free. */
const DEFAULT_LANE_WIDTH_PX = 96;
const MIN_LANE_WIDTH_PX = 48;

/**
 * Hard ceiling on the lane strip as a fraction of the waterfall row.
 *
 * The main waterfall is the primary instrument. A secondary surface allowed to
 * grow without a bound is exactly how the old subview row came to outweigh it.
 */
const LANE_MAX_ROW_FRACTION = 0.4;

/**
 * Settling delay before a moved range re-cuts its lane.
 *
 * A lane's texture crop is fixed at construction, so a range that moves has to
 * be rebuilt — a fresh GL context, program and texture. Profile ranges are
 * dragged directly on the main canvas and emit on every pointer move, so
 * reacting synchronously would rebuild a context per frame of a drag. Adding
 * and removing lanes stays immediate; only re-tuning waits.
 */
const LANE_RETUNE_DELAY_MS = 150;

type Props = {
  core: SpectrumCore;
  profileRanges?: ProfileRange[];
  bands?: Band[];
  live?: boolean;
};

export const Spectrum = ({ core, profileRanges, bands, live = true }: Props) => {
  const liveRef = useRef<HTMLCanvasElement>(null);
  const waterfallRef = useRef<HTMLCanvasElement>(null);
  const annotationRef = useRef<HTMLCanvasElement>(null);
  const occupancyRef = useRef<HTMLCanvasElement>(null);
  const freqAxisRef = useRef<HTMLDivElement>(null);
  const timeLabelsRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const powerAxisRef = useRef<HTMLDivElement>(null);
  const colormapLegendRef = useRef<HTMLDivElement>(null);
  const bandContainerRef = useRef<HTMLDivElement>(null);
  const bandTooltipRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const waterfallRowRef = useRef<HTMLDivElement>(null);
  const setFollowing = useSetAtom(followingAtom);
  const setHistoryPosition = useSetAtom(historyPositionAtom);

  useEffect(() => {
    // Assigned before mount so the very first rendered frame publishes state.
    core.onHistoryStateChange = (state) => {
      setFollowing(state.following);
      setHistoryPosition(state);
    };
    core.mount({
      waterfall: waterfallRef.current!,
      live: liveRef.current!,
      annotation: annotationRef.current!,
      occupancy: occupancyRef.current!,
      freqAxis: freqAxisRef.current!,
      timeLabels: timeLabelsRef.current!,
      tooltip: tooltipRef.current!,
      powerAxis: powerAxisRef.current!,
      colormapLegend: colormapLegendRef.current!,
      bandContainer: bandContainerRef.current!,
      bandTooltip: bandTooltipRef.current!,
      gridContainer: gridContainerRef.current!,
    });
    return () => {
      core.onHistoryStateChange = null;
      core.destroy();
    };
  }, [core, setFollowing, setHistoryPosition]);

  useEffect(() => {
    core.setProfileRanges(profileRanges ?? []);
  }, [core, profileRanges]);

  useEffect(() => {
    core.setBands(bands ?? []);
  }, [core, bands]);

  // --- Frequency lanes ---

  // A lane is a watched profile range: the object already exists, is named, and
  // is draggable on the main canvas, so a lane needs no editing UI of its own.
  const watched = useMemo(
    () => (profileRanges ?? []).filter((r) => r.watched).slice(0, MAX_LANES),
    [profileRanges],
  );
  const watchedRef = useRef(watched);
  watchedRef.current = watched;

  const [laneWidths, setLaneWidths] = useState<Record<string, number>>({});
  const [rowWidth, setRowWidth] = useState(0);
  const laneHosts = useRef(new Map<string, HTMLDivElement>());
  const laneRefCallbacks = useRef(new Map<string, (el: HTMLDivElement | null) => void>());

  // Stable per id, so a re-render does not detach and reattach every lane host.
  const laneHostRef = (id: string) => {
    let cb = laneRefCallbacks.current.get(id);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        if (el) laneHosts.current.set(id, el);
        else laneHosts.current.delete(id);
      };
      laneRefCallbacks.current.set(id, cb);
    }
    return cb;
  };

  const applyLanes = useCallback(() => {
    core.setLanes(
      watchedRef.current.flatMap((r) => {
        const host = laneHosts.current.get(r.id);
        return host
          ? [{ id: r.id, host, freqStartMHz: r.freqStartMHz, freqEndMHz: r.freqEndMHz }]
          : [];
      }),
    );
  }, [core]);

  // Structure — a lane appearing or disappearing — applies at once.
  const laneIdKey = watched.map((r) => r.id).join("|");
  useEffect(() => {
    applyLanes();
  }, [applyLanes, laneIdKey]);

  // Re-tuning waits for the drag to settle. See LANE_RETUNE_DELAY_MS.
  const laneRangeKey = watched.map((r) => `${r.id}:${r.freqStartMHz}:${r.freqEndMHz}`).join("|");
  useEffect(() => {
    const timer = setTimeout(applyLanes, LANE_RETUNE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [applyLanes, laneRangeKey]);

  // Lanes take their width from the waterfall row, so the cap is measured against it.
  useEffect(() => {
    const row = waterfallRowRef.current;
    if (!row) return;
    const observer = new ResizeObserver((entries) => {
      setRowWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  // The cap applies to what is drawn, not only to what a drag can request: six
  // lanes at their default width would otherwise exceed it on a 1366px screen
  // simply by being added.
  const requestedWidths = watched.map((r) => laneWidths[r.id] ?? DEFAULT_LANE_WIDTH_PX);
  const requestedTotal = requestedWidths.reduce((a, b) => a + b, 0);
  const capPx = rowWidth > 0 ? rowWidth * LANE_MAX_ROW_FRACTION : requestedTotal;
  const scale = requestedTotal > capPx && requestedTotal > 0 ? capPx / requestedTotal : 1;
  const laneWidthPx = requestedWidths.map((w) => Math.max(MIN_LANE_WIDTH_PX, Math.round(w * scale)));
  const laneTotalWidthPx = laneWidthPx.reduce((a, b) => a + b, 0);

  const handleLaneResize = (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    document.body.style.userSelect = "none";

    const startX = event.clientX;
    // Drag from the widths on screen, not the requested ones, so a strip that is
    // currently scaled down still tracks the pointer exactly.
    const startWidths = laneWidthPx;
    const startWidth = startWidths[index];
    const others = startWidths.reduce((sum, w, i) => (i === index ? sum : sum + w), 0);
    const maxWidth = Math.max(MIN_LANE_WIDTH_PX, capPx - others);
    const ids = watched.map((r) => r.id);

    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(
        maxWidth,
        Math.max(MIN_LANE_WIDTH_PX, startWidth - (moveEvent.clientX - startX)),
      );
      setLaneWidths((prev) => {
        const out = { ...prev };
        ids.forEach((id, i) => {
          out[id] = i === index ? next : startWidths[i];
        });
        return out;
      });
    };

    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      document.body.style.userSelect = "";
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp, { once: true });
  };

  const lanes = watched.map((range, index) => (
    <div key={range.id} className={rowStyles.lane} style={{ width: laneWidthPx[index] }}>
      <div className={rowStyles.laneCanvasHost} ref={laneHostRef(range.id)} />
      <div className={rowStyles.laneLabel}>
        <div className={rowStyles.laneLabelName}>{range.name || `#${range.numericId}`}</div>
        <div className={rowStyles.laneLabelRange}>
          {range.freqStartMHz.toFixed(2)}–{range.freqEndMHz.toFixed(2)}
        </div>
        <div className={rowStyles.laneLabelBins}>
          {core.binsForRange(range.freqStartMHz, range.freqEndMHz)} bins
        </div>
      </div>
      <div
        className={rowStyles.laneResizeHandle}
        onPointerDown={(event) => handleLaneResize(event, index)}
      />
    </div>
  ));

  return (
    <>
      <SpectrumLayout
        liveRef={liveRef}
        annotationRef={annotationRef}
        waterfallRef={waterfallRef}
        occupancyRef={occupancyRef}
        freqAxisRef={freqAxisRef}
        timeLabelsRef={timeLabelsRef}
        powerAxisRef={powerAxisRef}
        colormapLegendRef={colormapLegendRef}
        bandContainerRef={bandContainerRef}
        gridContainerRef={gridContainerRef}
        waterfallRowRef={waterfallRowRef}
        lanes={lanes}
        laneTotalWidthPx={laneTotalWidthPx}
        waterfallOverlay={<HistoryControls core={core} live={live} />}
      />
      <div ref={tooltipRef} className={styles.tooltip} style={{ display: "none" }} />
      <div ref={bandTooltipRef} className={styles.tooltip} style={{ display: "none" }} />
    </>
  );
};
