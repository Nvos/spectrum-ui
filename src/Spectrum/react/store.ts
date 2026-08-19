import { atom, createStore } from "jotai";
import { ColorMap } from "../core/colormaps";
import type { Band } from "../core/BandTypes";
import type { HistoryState } from "../core/SpectrumCore";

export type LayerName = "live" | "avg" | "max" | "maxSnapshot" | "annotations";

export const displayMinAtom = atom(-92);
export const displayMaxAtom = atom(-62);
export const colorMapAtom = atom<number>(ColorMap.SDR);
export const layerVisibilityAtom = atom<Record<LayerName, boolean>>({
  live: true,
  avg: true,
  max: true,
  maxSnapshot: false,
  annotations: true,
});
export const avgTauAtom = atom(2000);
export const occupancyThresholdAtom = atom(-82);
export const bandsAtom = atom<Band[]>([]);

/** True while the waterfall is pinned to the newest row. */
export const followingAtom = atom(true);

/**
 * Latest time-cursor snapshot, for the position readout and scrollbar.
 * Null until the core has rendered its first frame.
 */
export const historyPositionAtom = atom<HistoryState | null>(null);

export type SpectrumStore = ReturnType<typeof createStore>;
export { createStore as createSpectrumStore };
