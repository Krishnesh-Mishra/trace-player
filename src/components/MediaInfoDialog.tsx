import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { fmtTime } from "./types";

interface MediaInfo {
  filename: string;
  path: string;
  video_codec: string;
  audio_codec: string;
  container: string;
  video_w: number | null;
  video_h: number | null;
  video_fps: number | null;
  video_bitrate: number | null;
  audio_bitrate: number | null;
  audio_channels: string;
  audio_sample_rate: number | null;
  file_size: number | null;
  duration: number | null;
}

function fmtSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtBitrate(bps: number | null): string {
  if (bps === null) return "—";
  return `${Math.round(bps / 1000)} kbps`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between py-1.5 border-b border-white/5 last:border-0">
      <span className="text-[11px] text-white/40 shrink-0 mr-4">{label}</span>
      <span className="text-[11px] text-white/80 text-right break-all">{value || "—"}</span>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function MediaInfoDialog({ open, onClose }: Props) {
  const [info, setInfo] = useState<MediaInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    invoke<MediaInfo>("get_media_info").then(setInfo).catch(() => setInfo(null));
  }, [open]);

  const baseName = info?.path.split(/[\\/]/).pop() ?? info?.filename ?? "";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="bg-[#111]/92 backdrop-blur-xl  rounded-2xl
                       shadow-2xl w-80 max-h-[70vh] flex flex-col overflow-hidden"
            initial={{ scale: 0.92, y: -8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 h-11 border-b border-white/8 shrink-0">
              <span className="text-xs font-medium text-white">Media Info</span>
              <button
                onClick={onClose}
                className="w-6 h-6 flex items-center justify-center text-white/40
                           hover:text-white rounded-md hover:bg-white/10 cursor-pointer
                           transition-colors duration-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {!info ? (
                <p className="text-[11px] text-white/30 text-center py-4">Loading…</p>
              ) : (
                <>
                  <p className="text-[11px] text-white/60 mb-3 break-all leading-snug">{baseName}</p>

                  <div className="mb-3">
                    <p className="text-[9px] text-white/25 uppercase tracking-wider mb-1">Video</p>
                    <Row label="Codec" value={info.video_codec} />
                    <Row
                      label="Resolution"
                      value={
                        info.video_w && info.video_h
                          ? `${info.video_w} × ${info.video_h}`
                          : "—"
                      }
                    />
                    <Row
                      label="Frame rate"
                      value={info.video_fps ? `${info.video_fps.toFixed(3)} fps` : "—"}
                    />
                    <Row label="Bitrate" value={fmtBitrate(info.video_bitrate)} />
                  </div>

                  <div className="mb-3">
                    <p className="text-[9px] text-white/25 uppercase tracking-wider mb-1">Audio</p>
                    <Row label="Codec" value={info.audio_codec} />
                    <Row label="Channels" value={info.audio_channels} />
                    <Row
                      label="Sample rate"
                      value={info.audio_sample_rate ? `${info.audio_sample_rate} Hz` : "—"}
                    />
                    <Row label="Bitrate" value={fmtBitrate(info.audio_bitrate)} />
                  </div>

                  <div>
                    <p className="text-[9px] text-white/25 uppercase tracking-wider mb-1">File</p>
                    <Row label="Container" value={info.container} />
                    <Row
                      label="Duration"
                      value={info.duration ? fmtTime(info.duration) : "—"}
                    />
                    <Row label="File size" value={fmtSize(info.file_size)} />
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
