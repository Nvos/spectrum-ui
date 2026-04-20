import { useRef } from "react";
import type { ProfileRange } from "../core/ProfileTypes";

type Props = {
  ranges: ProfileRange[];
  freqStartMHz: number;
  freqEndMHz: number;
  onChange: (ranges: ProfileRange[]) => void;
};

export const ProfilePanel = ({ ranges, freqStartMHz, freqEndMHz, onChange }: Props) => {
  const nextNumericId = useRef(1);

  const add = () => {
    const center = (freqStartMHz + freqEndMHz) / 2;
    const half = (freqEndMHz - freqStartMHz) / 20;
    onChange([
      ...ranges,
      {
        id: crypto.randomUUID(),
        numericId: nextNumericId.current,
        name: "",
        freqStartMHz: center - half,
        freqEndMHz: center + half,
        powerDbm: -80,
      },
    ]);

    nextNumericId.current++;
  };

  const update = <K extends keyof ProfileRange>(id: string, field: K, value: ProfileRange[K]) => {
    onChange(ranges.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const updateFreq = (id: string, field: "freqStartMHz" | "freqEndMHz", raw: string) => {
    const v = parseFloat(raw);
    if (isNaN(v)) return;
    update(
      id,
      field,
      Math.max(freqStartMHz, Math.min(freqEndMHz, v)) as ProfileRange[typeof field],
    );
  };

  const remove = (id: string) => onChange(ranges.filter((r) => r.id !== id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {ranges.map((r) => (
        <div key={r.id} style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span
              style={{
                fontSize: "0.75rem",
                opacity: 0.4,
                fontVariantNumeric: "tabular-nums",
                flexShrink: 0,
              }}
            >
              #{r.numericId}
            </span>
            <input
              type="text"
              value={r.name}
              placeholder="name"
              onChange={(e) => update(r.id, "name", e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button type="button" onClick={() => remove(r.id)}>
              ✕
            </button>
          </div>
          <div
            style={{ display: "flex", gap: "0.5rem", alignItems: "center", paddingLeft: "1.25rem" }}
          >
            <input
              type="number"
              value={r.freqStartMHz}
              step="0.001"
              onChange={(e) => updateFreq(r.id, "freqStartMHz", e.target.value)}
              style={{ width: "6rem" }}
            />
            <span>—</span>
            <input
              type="number"
              value={r.freqEndMHz}
              step="0.001"
              onChange={(e) => updateFreq(r.id, "freqEndMHz", e.target.value)}
              style={{ width: "6rem" }}
            />
            <span style={{ opacity: 0.4 }}>MHz</span>
          </div>
          <div
            style={{ display: "flex", gap: "0.5rem", alignItems: "center", paddingLeft: "1.25rem" }}
          >
            <input
              type="number"
              value={r.powerDbm}
              step="1"
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) update(r.id, "powerDbm", v as ProfileRange["powerDbm"]);
              }}
              style={{ width: "6rem" }}
            />
            <span style={{ opacity: 0.4 }}>dBm</span>
          </div>
        </div>
      ))}
      <button type="button" onClick={add}>
        Add range
      </button>
    </div>
  );
};
