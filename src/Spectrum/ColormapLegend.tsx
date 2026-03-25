import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as styles from "./ColormapLegend.css";
import { COLORMAPS } from "./colormaps";
import { POWER_CEILING, POWER_FLOOR } from "./constants";
import { computePowerTicks } from "./powerAxisUtils";
import { colorMapAtom, displayMaxAtom, displayMinAtom } from "./store";

const TOTAL_RANGE = POWER_CEILING - POWER_FLOOR;

const buildCSSGradient = (colorMap: number): string => {
  const fn = COLORMAPS[colorMap];
  const N = 64;
  const stops: string[] = [];
  for (let i = 0; i <= N; i++) {
    // t=1 at top (displayMax), t=0 at bottom (displayMin)
    const t = 1 - i / N;
    const [r, g, b] = fn(t);
    stops.push(
      `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) ${((i / N) * 100).toFixed(2)}%`,
    );
  }
  return `linear-gradient(to bottom, ${stops.join(",")})`;
}

const dbmToPct = (dbm: number): number => {
  return ((POWER_CEILING - dbm) / TOTAL_RANGE) * 100;
}

const lockCursor = (cursor: string): () => void => {
  const el = document.createElement("style");
  el.textContent = `* { cursor: ${cursor} !important; }`;
  document.head.appendChild(el);
  return () => document.head.removeChild(el);
}

const useDrag = (
  containerRef: React.RefObject<HTMLDivElement | null>,
  onMove: (value: number) => void,
  deps: React.DependencyList,
) => {
  const dragging = useRef(false);
  const unlock = useRef<(() => void) | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    unlock.current = lockCursor("ns-resize");
    e.preventDefault();
  }, []);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      onMove(Math.round(POWER_CEILING - pct * TOTAL_RANGE));
    };
    const onUp = () => {
      dragging.current = false;
      unlock.current?.();
      unlock.current = null;
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, ...deps]);

  return onMouseDown;
}

const useGradientDrag = (
  containerRef: React.RefObject<HTMLDivElement | null>,
  displayMin: number,
  displayMax: number,
  onChangeMin: (v: number) => void,
  onChangeMax: (v: number) => void,
) => {
  const drag = useRef<{ startY: number; startMin: number; startMax: number } | null>(null);
  const unlock = useRef<(() => void) | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      drag.current = { startY: e.clientY, startMin: displayMin, startMax: displayMax };
      unlock.current = lockCursor("grabbing");
      e.preventDefault();
    },
    [displayMin, displayMax],
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!drag.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dbmDelta = -((e.clientY - drag.current.startY) / rect.height) * TOTAL_RANGE;
      const range = drag.current.startMax - drag.current.startMin;
      const newMax = Math.round(
        Math.max(POWER_FLOOR + range, Math.min(POWER_CEILING, drag.current.startMax + dbmDelta)),
      );
      const newMin = newMax - range;
      onChangeMax(newMax);
      onChangeMin(newMin);
    };
    const onUp = () => {
      drag.current = null;
      unlock.current?.();
      unlock.current = null;
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, displayMin, displayMax, onChangeMin, onChangeMax]);

  return onMouseDown;
}

const useDisplayMaxDrag = (
  containerRef: React.RefObject<HTMLDivElement | null>,
  displayMin: number,
  onChange: (v: number) => void,
) => {
  return useDrag(
    containerRef,
    (value) => {
      onChange(Math.max(displayMin + 1, Math.min(POWER_CEILING, value)));
    },
    [displayMin, onChange],
  );
}

const useDisplayMinDrag = (
  containerRef: React.RefObject<HTMLDivElement | null>,
  displayMax: number,
  onChange: (v: number) => void,
) => {
  return useDrag(
    containerRef,
    (value) => {
      onChange(Math.max(POWER_FLOOR, Math.min(displayMax - 1, value)));
    },
    [displayMax, onChange],
  );
}

type TicksProps = { ticks: { dbm: number; pct: number }[] };

const LegendTicks = ({ ticks }: TicksProps) => {
  return (
    <>
      {ticks.map(({ dbm, pct }) => (
        <div
          key={dbm}
          className={styles.tickRow}
          style={{ top: `${pct}%`, transform: "translateY(-50%)" }}
        >
          <span
            className={styles.tickText}
            style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 -1px 3px rgba(0,0,0,0.9)" }}
          >
            {dbm}
          </span>
        </div>
      ))}
    </>
  );
}

type HandleProps = { pct: number; displayMax: number; onMouseDown: (e: React.MouseEvent) => void };

const DisplayMaxHandle = ({ pct, displayMax, onMouseDown }: HandleProps) => {
  return (
    <div
      role="slider"
      aria-valuenow={displayMax}
      aria-valuemin={POWER_FLOOR}
      aria-valuemax={POWER_CEILING}
      className={styles.handle}
      style={{ bottom: `${100 - pct}%` }}
      onMouseDown={onMouseDown}
    >
      <div className={styles.handleBadge}>
        <span className={styles.handleBadgeText}>{displayMax}</span>
      </div>
    </div>
  );
}

type MinHandleProps = {
  pct: number;
  displayMin: number;
  onMouseDown: (e: React.MouseEvent) => void;
};

const DisplayMinHandle = ({ pct, displayMin, onMouseDown }: MinHandleProps) => {
  return (
    <div
      role="slider"
      aria-valuenow={displayMin}
      aria-valuemin={POWER_FLOOR}
      aria-valuemax={POWER_CEILING}
      className={styles.handle}
      style={{ top: `${pct}%` }}
      onMouseDown={onMouseDown}
    >
      <div className={styles.handleBadge}>
        <span className={styles.handleBadgeText}>{displayMin}</span>
      </div>
    </div>
  );
}

export const ColormapLegend = () => {
  const colorMap = useAtomValue(colorMapAtom);
  const displayMin = useAtomValue(displayMinAtom);
  const displayMax = useAtomValue(displayMaxAtom);
  const setDisplayMin = useSetAtom(displayMinAtom);
  const setDisplayMax = useSetAtom(displayMaxAtom);

  const containerRef = useRef<HTMLDivElement>(null);
  const onMaxMouseDown = useDisplayMaxDrag(containerRef, displayMin, setDisplayMax);
  const onMinMouseDown = useDisplayMinDrag(containerRef, displayMax, setDisplayMin);
  const onGradientMouseDown = useGradientDrag(
    containerRef,
    displayMin,
    displayMax,
    setDisplayMin,
    setDisplayMax,
  );

  const gradient = useMemo(() => buildCSSGradient(colorMap), [colorMap]);
  const displayMaxPct = dbmToPct(displayMax);
  const displayMinPct = dbmToPct(displayMin);
  const ticks = computePowerTicks(POWER_FLOOR, POWER_CEILING);

  return (
    <div ref={containerRef} className={styles.container}>
      <div
        className={styles.gradientArea}
        style={{
          top: `${displayMaxPct}%`,
          height: `${displayMinPct - displayMaxPct}%`,
          background: gradient,
          cursor: "grab",
        }}
        onMouseDown={onGradientMouseDown}
      />
      <LegendTicks ticks={ticks} />
      <DisplayMaxHandle pct={displayMaxPct} displayMax={displayMax} onMouseDown={onMaxMouseDown} />
      <DisplayMinHandle pct={displayMinPct} displayMin={displayMin} onMouseDown={onMinMouseDown} />
    </div>
  );
}
