interface Props {
  value: string;
  onChange: (v: string) => void;
}

/** Native <input type="color"> wrapped with a custom swatch + hex label. */
export default function ColorPicker({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2">
      <label
        className="relative w-7 h-7 rounded-md overflow-hidden
                    cursor-pointer block"
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: value }}
        />
      </label>
      <span className="text-[11px] text-white/70 tabular-nums">{value}</span>
    </div>
  );
}
