import { atom, createStore } from "jotai";
import { ColorMap } from "../core/colormaps";

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

export type SpectrumStore = ReturnType<typeof createStore>;
export { createStore as createSpectrumStore };
