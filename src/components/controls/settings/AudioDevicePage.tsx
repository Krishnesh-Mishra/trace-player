import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import type { AudioDevice } from "../../types";
import { BackHeader, TrackOption, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  currentDevice: string;
  onDeviceChange: (name: string) => void;
  onBack: () => void;
}

export default function AudioDevicePage({ direction, currentDevice, onDeviceChange, onBack }: Props) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);

  useEffect(() => {
    invoke<AudioDevice[]>("get_audio_devices")
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  return (
    <motion.div
      key="audio_device"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Audio Output" onClick={onBack} />
      <div className="px-1 py-1 max-h-72 overflow-y-auto">
        {devices.length === 0 ? (
          <p className="text-[11px] text-white/30 px-3 py-3">Loading devices…</p>
        ) : (
          devices.map((d) => (
            <TrackOption
              key={d.name}
              label={d.description || d.name}
              description={d.name !== "auto" ? d.name : undefined}
              selected={currentDevice === d.name}
              onClick={() => onDeviceChange(d.name)}
            />
          ))
        )}
      </div>
    </motion.div>
  );
}
