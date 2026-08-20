// Public API
export { Spectrum } from "./react/Spectrum";
export { ProfilePanel } from "./react/ProfilePanel";
export type { ProfileRange } from "./core/ProfileTypes";
export { SpectrumCore } from "./core/SpectrumCore";
export type { SpectrumCoreOptions, SpectrumInitialData, SpectrumMountRefs, LayerVisibility, HistoryState, LaneDef } from "./core/SpectrumCore";
export { LaneCore } from "./core/LaneCore";
export type { LaneSettings } from "./core/LaneCore";
export { FrameBuffer } from "./core/FrameBuffer";
export { ColorMap, COLORMAP_NAMES } from "./core/colormaps";
export { POWER_FLOOR, POWER_CEILING, HISTORY_ROWS, MAX_LANES } from "./core/constants";
export { createSpectrumStore } from "./react/store";
export type { SpectrumStore } from "./react/store";
export type { LayerName } from "./react/store";
export {
  displayMinAtom,
  displayMaxAtom,
  colorMapAtom,
  layerVisibilityAtom,
  avgTauAtom,
  occupancyThresholdAtom,
  bandsAtom,
  followingAtom,
  historyPositionAtom,
} from "./react/store";
export type { Band } from "./core/BandTypes";
