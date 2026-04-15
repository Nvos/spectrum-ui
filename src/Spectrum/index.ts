// Public API
export { Spectrum } from "./react/Spectrum";
export { SpectrumSubview } from "./react/SpectrumSubview";
export type { SubviewHandle, SubviewRefs } from "./core/SpectrumSubviewCore";
export { SpectrumCore } from "./core/SpectrumCore";
export type { SpectrumCoreOptions, SpectrumInitialData, SpectrumMountRefs, LayerVisibility } from "./core/SpectrumCore";
export type { HighlightRange } from "./core/SubviewHighlightController";
export { FrameBuffer } from "./core/FrameBuffer";
export { ColorMap, COLORMAP_NAMES } from "./core/colormaps";
export { POWER_FLOOR, POWER_CEILING } from "./core/constants";
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
} from "./react/store";
