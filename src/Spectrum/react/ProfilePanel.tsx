import type { ProfileRange } from "../core/ProfileTypes";

type Props = {
  ranges: ProfileRange[];
  freqStartMHz: number;
  freqEndMHz: number;
  onChange: (ranges: ProfileRange[]) => void;
};

export const ProfilePanel = ({ ranges, freqStartMHz, freqEndMHz, onChange }: Props) => {
  const add = () => {
    const center = (freqStartMHz + freqEndMHz) / 2;
    const half = (freqEndMHz - freqStartMHz) / 20;
    onChange([...ranges, { id: crypto.randomUUID(), freqStartMHz: center - half, freqEndMHz: center + half }]);
  };

  const update = (id: string, field: "freqStartMHz" | "freqEndMHz", raw: string) => {
    const v = parseFloat(raw);
    if (isNaN(v)) return;
    const clamped = Math.max(freqStartMHz, Math.min(freqEndMHz, v));
    onChange(ranges.map((r) => (r.id === id ? { ...r, [field]: clamped } : r)));
  };

  const remove = (id: string) => onChange(ranges.filter((r) => r.id !== id));

  return (
    <div>
      {ranges.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.25rem" }}>
          <input
            type="number"
            value={r.freqStartMHz}
            step="0.001"
            onChange={(e) => update(r.id, "freqStartMHz", e.target.value)}
            style={{ width: "7rem" }}
          />
          <span>—</span>
          <input
            type="number"
            value={r.freqEndMHz}
            step="0.001"
            onChange={(e) => update(r.id, "freqEndMHz", e.target.value)}
            style={{ width: "7rem" }}
          />
          <span>MHz</span>
          <button type="button" onClick={() => remove(r.id)}>✕</button>
        </div>
      ))}
      <button type="button" onClick={add}>Add range</button>
    </div>
  );
};
