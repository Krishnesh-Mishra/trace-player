import { motion } from "framer-motion";
import RangeSlider from "../ui/RangeSlider";
import Toggle from "../ui/Toggle";
import ColorPicker from "./ColorPicker";
import { type SubtitleStyle, FONTS } from "./presets";

interface Props {
  style: SubtitleStyle;
  onChange: (style: SubtitleStyle) => void;
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-[var(--np-text-secondary)]">{label}</span>
        {hint !== undefined && (
          <span className="text-[11px] text-[var(--np-text)] tabular-nums">{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

export default function StyleControls({ style, onChange }: Props) {
  const update = (patch: Partial<SubtitleStyle>) => onChange({ ...style, ...patch });

  return (
    <div className="space-y-5">
      <Row label="Font">
        <select
          value={style.font}
          onChange={(e) => update({ font: e.target.value })}
          className="w-full px-2.5 py-1.5 text-[12px] text-[var(--np-text)]
                     bg-[var(--np-hover)]  rounded-md cursor-pointer
                     outline-none"
        >
          {FONTS.map((f) => (
            <option key={f} value={f} className="bg-[var(--np-surface)]">
              {f}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Size" hint={`${style.size}px`}>
        <RangeSlider
          value={style.size}
          min={20}
          max={120}
          step={1}
          onChange={(size) => update({ size })}
        />
      </Row>

      <Row label="Text Color">
        <ColorPicker value={style.color} onChange={(color) => update({ color })} />
      </Row>

      <Row label="Border" hint={`${style.borderSize.toFixed(1)}px`}>
        <RangeSlider
          value={style.borderSize}
          min={0}
          max={10}
          step={0.5}
          onChange={(borderSize) => update({ borderSize })}
        />
      </Row>

      <Row label="Border Color">
        <ColorPicker
          value={style.borderColor}
          onChange={(borderColor) => update({ borderColor })}
        />
      </Row>

      <Row label="Shadow Offset" hint={`${style.shadowOffset.toFixed(1)}`}>
        <RangeSlider
          value={style.shadowOffset}
          min={0}
          max={5}
          step={0.5}
          onChange={(shadowOffset) => update({ shadowOffset })}
        />
      </Row>

      <Row label="Margin (vertical)" hint={`${style.marginY}px`}>
        <RangeSlider
          value={style.marginY}
          min={0}
          max={120}
          step={1}
          onChange={(marginY) => update({ marginY })}
        />
      </Row>

      <div className="flex items-center justify-between">
        <span className="text-[12px] text-[var(--np-text-secondary)]">Bold</span>
        <Toggle enabled={style.bold} onToggle={() => update({ bold: !style.bold })} size="md" />
      </div>

      <Row label="Position">
        <div className="flex gap-1">
          {(["top", "center", "bottom"] as const).map((pos) => (
            <motion.button
              key={pos}
              className={`flex-1 px-2 py-1.5 text-[11px] capitalize rounded-md
                          cursor-pointer transition-colors duration-100 ${
                            style.alignY === pos
                              ? "bg-[var(--np-active)] text-[var(--np-text)]"
                              : "bg-[var(--np-hover)] text-[var(--np-text-secondary)] hover:bg-[var(--np-active)]"
                          }`}
              whileTap={{ scale: 0.96 }}
              onClick={() => update({ alignY: pos })}
            >
              {pos}
            </motion.button>
          ))}
        </div>
      </Row>
    </div>
  );
}
