import { useAtomValue } from "jotai";
import { useRef } from "react";
import type { SpectrumCore } from "../core/SpectrumCore";
import * as styles from "./SpectrumRows.css";
import { historyPositionAtom } from "./store";

const pad2 = (n: number) => String(n).padStart(2, "0");

const formatClock = (ms: number): string => {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

type Props = { core: SpectrumCore; live?: boolean };

/**
 * Follow/pause readout and history scrollbar.
 *
 * Not decoration: with time scroll behind shift+wheel, the scrollbar is the
 * only discoverable entry point to history — a user who never guesses the
 * modifier reaches it through this and nothing else.
 */
export const HistoryControls = ({ core, live = true }: Props) => {
  const position = useAtomValue(historyPositionAtom);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  if (!position || position.totalWritten === 0) return null;

  const { following, atOldest, timestampMs, loading, scrollTop, scrollSize, totalWritten, oldestAbs } =
    position;
  const retained = Math.max(1, totalWritten - oldestAbs);

  // Track runs live (top) → oldest retained (bottom), matching the waterfall.
  const seekToClientY = (clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.height <= 0) return;
    const thumbHeight = scrollSize * rect.height;
    const travel = Math.max(1, rect.height - thumbHeight);
    const frac = (clientY - rect.top - thumbHeight / 2) / travel;
    const maxDistance = Math.max(0, retained - position.displayRows);
    const distanceFromLive = Math.round(Math.min(1, Math.max(0, frac)) * maxDistance);
    if (distanceFromLive <= 0) core.scrollHistoryToLive();
    else core.scrollHistoryTo(totalWritten - 1 - distanceFromLive);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    core.beginHistoryGesture();
    seekToClientY(e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    seekToClientY(e.clientY);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    core.endHistoryGesture();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Keyboard equivalents so the feature is reachable without a wheel or drag.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(1, position.displayRows - 1);
    switch (e.key) {
      case "ArrowDown":
        core.scrollHistoryByRows(-1);
        break;
      case "ArrowUp":
        core.scrollHistoryByRows(1);
        break;
      case "PageDown":
        core.scrollHistoryByRows(-page);
        break;
      case "PageUp":
        core.scrollHistoryByRows(page);
        break;
      case "Home":
        core.scrollHistoryToLive();
        break;
      case "End":
        core.scrollHistoryToOldest();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const label = following
    ? live
      ? "● LIVE"
      : `● LATEST · ${formatClock(timestampMs)}`
    : loading
      ? "⏸ LOADING…"
      : atOldest
      ? `⏸ OLDEST · ${formatClock(timestampMs)}`
      : `⏸ ${formatClock(timestampMs)}`;

  return (
    <>
      <button
        type="button"
        className={`${styles.historyIndicator} ${
          following && live ? styles.historyIndicatorLive : styles.historyIndicatorPaused
        }`}
        title={
          following
            ? live
              ? "Following live data"
              : "Showing newest recorded data"
            : live
              ? "Paused — click to return to live"
              : "Click to return to newest recorded data"
        }
        onClick={() => core.scrollHistoryToLive()}
      >
        {label}
      </button>
      <div
        ref={trackRef}
        className={styles.historyScrollbar}
        role="slider"
        tabIndex={0}
        aria-label="History position"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(scrollTop * 100)}
        aria-valuetext={
          following
            ? live
              ? "Live"
              : "Latest recorded data"
            : loading
              ? "Loading history"
              : formatClock(timestampMs)
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <div
          className={`${styles.historyScrollbarThumb} ${
            following ? "" : styles.historyScrollbarThumbPaused
          }`}
          style={{ top: `${scrollTop * 100}%`, height: `${scrollSize * 100}%` }}
        />
      </div>
      {atOldest && <div className={styles.historyExpiringEdge} />}
    </>
  );
};
