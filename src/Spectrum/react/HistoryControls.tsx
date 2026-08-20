import { useAtomValue } from "jotai";
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
 * Follow/pause readout and passive history position rail.
 *
 * Neither takes pointer input. History is scrolled on the time gutter
 * (`TimeGutterInput`), which is the full-height left column and therefore has
 * no small target to acquire — the scrollbar this replaced could render a
 * 4px thumb on a deep session, which is unusable on a touchpad in the field.
 *
 * The rail stays because it answers the one question the gutter cannot: where
 * this window sits in the whole retained session, at a glance.
 */
export const HistoryControls = ({ core, live = true }: Props) => {
  const position = useAtomValue(historyPositionAtom);

  if (!position || position.totalWritten === 0) return null;

  const { following, atOldest, timestampMs, loading, scrollTop, scrollSize } = position;

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
      <div className={styles.historyScrollbar} aria-hidden="true">
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
