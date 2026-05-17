import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, Gauge, Subtitles, Volume2, Info,
  ChevronRight,
} from "lucide-react";
import { type Track, trackLabel } from "./types";

interface Props {
  hasFile: boolean;
  isPlaying: boolean;
  playbackSpeed: number;
  audioTracks: Track[];
  subtitleTracks: Track[];
  selectedAudioId: string;
  selectedSubId: string;
  disabled: boolean;
  onPlayPause: () => void;
  onSpeedChange: (speed: number) => void;
  onAudioTrackChange: (id: string) => void;
  onSubtitleTrackChange: (id: string) => void;
  onMediaInfo: () => void;
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export default function AppContextMenu({
  hasFile,
  isPlaying,
  playbackSpeed,
  audioTracks,
  subtitleTracks,
  selectedAudioId,
  selectedSubId,
  disabled,
  onPlayPause,
  onSpeedChange,
  onAudioTrackChange,
  onSubtitleTrackChange,
  onMediaInfo,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [submenu, setSubmenu] = useState<"speed" | "audio" | "subtitle" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) return;
    const handle = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-no-app-ctx]")) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
      setSubmenu(null);
    };
    document.addEventListener("contextmenu", handle);
    return () => document.removeEventListener("contextmenu", handle);
  }, [disabled]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const close = useCallback(() => setMenu(null), []);

  const act = useCallback((fn: () => void) => {
    fn();
    close();
  }, [close]);

  if (!menu) return null;

  return (
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        className="fixed z-[200] origin-top-left min-w-[180px] py-1 bg-[#1a1a1a]  
                   rounded-lg shadow-xl shadow-black/50 backdrop-blur-sm"
        style={{ left: menu.x, top: menu.y }}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.92 }}
        transition={{ duration: 0.1 }}
      >
        {hasFile && (
          <>
            <button
              onClick={() => act(onPlayPause)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[11px]
                         text-white/80 hover:bg-white/10 transition-colors duration-75 cursor-pointer"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 opacity-70" /> : <Play className="w-3.5 h-3.5 opacity-70" />}
              <span className="flex-1">{isPlaying ? "Pause" : "Play"}</span>
              <span className="text-[10px] text-white/30">Space</span>
            </button>

            <div className="h-px bg-white/8 my-1 mx-2" />

            {/* Speed submenu */}
            <div
              className="relative"
              onMouseEnter={() => setSubmenu("speed")}
              onMouseLeave={() => setSubmenu((s) => s === "speed" ? null : s)}
            >
              <div className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px]
                              text-white/80 hover:bg-white/10 transition-colors duration-75 cursor-pointer">
                <Gauge className="w-3.5 h-3.5 opacity-70" />
                <span className="flex-1">Speed</span>
                <span className="text-[10px] text-white/40">{playbackSpeed}x</span>
                <ChevronRight className="w-3 h-3 text-white/30" />
              </div>
              <AnimatePresence>
                {submenu === "speed" && (
                  <motion.div
                    className="absolute left-full top-0 ml-1 min-w-[100px] py-1 bg-[#1a1a1a]
                               border border-white/12 rounded-lg shadow-xl"
                    initial={{ opacity: 0, scale: 0.95, x: -4 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95, x: -4 }}
                    transition={{ duration: 0.12 }}
                  >
                    {SPEEDS.map((s) => (
                      <button
                        key={s}
                        onClick={() => act(() => onSpeedChange(s))}
                        className={`w-full px-3 py-1 text-left text-[11px] cursor-pointer
                                    transition-colors duration-75
                                    ${s === playbackSpeed ? "text-white bg-white/10" : "text-white/70 hover:bg-white/10"}`}
                      >
                        {s}x
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Audio submenu */}
            {audioTracks.length > 0 && (
              <div
                className="relative"
                onMouseEnter={() => setSubmenu("audio")}
                onMouseLeave={() => setSubmenu((s) => s === "audio" ? null : s)}
              >
                <div className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px]
                                text-white/80 hover:bg-white/10 transition-colors duration-75 cursor-pointer">
                  <Volume2 className="w-3.5 h-3.5 opacity-70" />
                  <span className="flex-1">Audio</span>
                  <ChevronRight className="w-3 h-3 text-white/30" />
                </div>
                <AnimatePresence>
                  {submenu === "audio" && (
                    <motion.div
                      className="absolute left-full top-0 ml-1 min-w-[140px] py-1 bg-[#1a1a1a]
                                 border border-white/12 rounded-lg shadow-xl max-h-60 overflow-y-auto"
                      initial={{ opacity: 0, scale: 0.95, x: -4 }}
                      animate={{ opacity: 1, scale: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95, x: -4 }}
                      transition={{ duration: 0.12 }}
                    >
                      {audioTracks.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => act(() => onAudioTrackChange(String(t.id)))}
                          className={`w-full px-3 py-1.5 text-left text-[11px] cursor-pointer
                                      transition-colors duration-75 truncate
                                      ${String(t.id) === selectedAudioId ? "text-white bg-white/10" : "text-white/70 hover:bg-white/10"}`}
                        >
                          {trackLabel(t)}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Subtitle submenu */}
            {subtitleTracks.length > 0 && (
              <div
                className="relative"
                onMouseEnter={() => setSubmenu("subtitle")}
                onMouseLeave={() => setSubmenu((s) => s === "subtitle" ? null : s)}
              >
                <div className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px]
                                text-white/80 hover:bg-white/10 transition-colors duration-75 cursor-pointer">
                  <Subtitles className="w-3.5 h-3.5 opacity-70" />
                  <span className="flex-1">Subtitles</span>
                  <ChevronRight className="w-3 h-3 text-white/30" />
                </div>
                <AnimatePresence>
                  {submenu === "subtitle" && (
                    <motion.div
                      className="absolute left-full top-0 ml-1 min-w-[140px] py-1 bg-[#1a1a1a]
                                 border border-white/12 rounded-lg shadow-xl max-h-60 overflow-y-auto"
                      initial={{ opacity: 0, scale: 0.95, x: -4 }}
                      animate={{ opacity: 1, scale: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95, x: -4 }}
                      transition={{ duration: 0.12 }}
                    >
                      <button
                        onClick={() => act(() => onSubtitleTrackChange("no"))}
                        className={`w-full px-3 py-1.5 text-left text-[11px] cursor-pointer
                                    transition-colors duration-75
                                    ${selectedSubId === "no" ? "text-white bg-white/10" : "text-white/70 hover:bg-white/10"}`}
                      >
                        None
                      </button>
                      {subtitleTracks.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => act(() => onSubtitleTrackChange(String(t.id)))}
                          className={`w-full px-3 py-1.5 text-left text-[11px] cursor-pointer
                                      transition-colors duration-75 truncate
                                      ${String(t.id) === selectedSubId ? "text-white bg-white/10" : "text-white/70 hover:bg-white/10"}`}
                        >
                          {trackLabel(t)}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <div className="h-px bg-white/8 my-1 mx-2" />

            <button
              onClick={() => act(onMediaInfo)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[11px]
                         text-white/80 hover:bg-white/10 transition-colors duration-75 cursor-pointer"
            >
              <Info className="w-3.5 h-3.5 opacity-70" />
              <span className="flex-1">Properties</span>
              <span className="text-[10px] text-white/30">Ctrl+I</span>
            </button>
          </>
        )}

        {!hasFile && (
          <div className="px-3 py-2 text-[11px] text-white/40">
            No file loaded
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
