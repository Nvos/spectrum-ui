import { createContext, useContext } from "react";

export interface SpectrumDisplaySettings {
  colorMap: number;
  displayMin: number;
  displayMax: number;
  onDisplayMinChange: (v: number) => void;
  onDisplayMaxChange: (v: number) => void;
}

export const SpectrumDisplayContext = createContext<SpectrumDisplaySettings | null>(null);

export function useSpectrumDisplay(): SpectrumDisplaySettings {
  const ctx = useContext(SpectrumDisplayContext);
  if (!ctx)
    throw new Error("useSpectrumDisplay must be used within SpectrumDisplayContext.Provider");
  return ctx;
}
