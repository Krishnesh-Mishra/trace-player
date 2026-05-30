import { motion } from "framer-motion";
import { THEME_OPTIONS, type ThemeChoice } from "../../../hooks/useTheme";
import { BackHeader, TrackOption, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  theme: ThemeChoice;
  onChange: (t: ThemeChoice) => void;
  onBack: () => void;
}

export default function AppearanceThemePage({
  direction,
  theme,
  onChange,
  onBack,
}: Props) {
  return (
    <motion.div
      key="appearance_theme"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Theme" onClick={onBack} />

      <div className="px-1 pb-2">
        {THEME_OPTIONS.map((opt) => (
          <TrackOption
            key={opt.value}
            label={opt.label}
            selected={theme === opt.value}
            onClick={() => onChange(opt.value)}
          />
        ))}
      </div>
    </motion.div>
  );
}
