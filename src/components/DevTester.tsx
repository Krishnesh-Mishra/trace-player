import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { Bug, Play, X, Check, AlertTriangle } from "lucide-react";

/**
 * Dev-only smoke test panel. Mounted by App.tsx behind `import.meta.env.DEV`
 * so it only appears in `npm run dev` builds. Click "Run all" and the panel
 * iterates through every documented value of every command and reports
 * pass/fail. The goal is to catch backend errors (like "af: invalid
 * parameter") in one click instead of clicking through the menu by hand.
 */

type TestStep = {
  group: string;
  name: string;
  cmd: string;
  args?: Record<string, unknown>;
};

type TestResult = TestStep & {
  status: "ok" | "fail";
  error?: string;
};

const STEPS: TestStep[] = [
  // Performance profiles (each one resolves the underlying knobs)
  ...["auto", "battery_saver", "balanced", "best_quality", "custom"].map((p) => ({
    group: "perf",
    name: p,
    cmd: "set_perf_profile",
    args: { profile: p },
  })),
  // HDR
  ...["auto", "passthrough", "tone_map", "sdr"].map((m) => ({
    group: "hdr",
    name: m,
    cmd: "set_hdr_mode",
    args: { mode: m },
  })),
  // Upscaling
  ...["off", "low", "medium", "high"].map((p) => ({
    group: "upscaling",
    name: p,
    cmd: "set_upscaling",
    args: { profile: p },
  })),
  // Interpolation
  ...["off", "smooth", "cinematic"].map((m) => ({
    group: "interp",
    name: m,
    cmd: "set_interpolation",
    args: { mode: m },
  })),
  { group: "vsync", name: "on", cmd: "set_vsync", args: { enabled: true } },
  { group: "vsync", name: "off", cmd: "set_vsync", args: { enabled: false } },
  // Aspect
  ...["auto", "16:9", "4:3", "21:9", "fill"].map((r) => ({
    group: "aspect",
    name: r,
    cmd: "set_aspect",
    args: { ratio: r },
  })),
  { group: "zoom", name: "0", cmd: "set_zoom", args: { zoom: 0 } },
  { group: "rotate", name: "0", cmd: "set_rotate", args: { degrees: 0 } },
  // Image params reset
  {
    group: "image",
    name: "reset",
    cmd: "set_image_params",
    args: { params: { brightness: 0, contrast: 0, saturation: 0, gamma: 0, hue: 0 } },
  },
  // Audio FX matrix — empty + each toggle individually
  ...[
    { name: "all-off", payload: { mono: false, dynamicEnabled: false, normalize: false, nightMode: false, pitchCorrection: false } },
    { name: "mono",     payload: { mono: true,  dynamicEnabled: false, normalize: false, nightMode: false, pitchCorrection: false } },
    { name: "dynamic",  payload: { mono: false, dynamicEnabled: true,  normalize: false, nightMode: false, pitchCorrection: false } },
    { name: "normalize",payload: { mono: false, dynamicEnabled: false, normalize: true,  nightMode: false, pitchCorrection: false } },
    { name: "night",    payload: { mono: false, dynamicEnabled: false, normalize: false, nightMode: true,  pitchCorrection: false } },
    { name: "pitch",    payload: { mono: false, dynamicEnabled: false, normalize: false, nightMode: false, pitchCorrection: true  } },
  ].map((c) => ({
    group: "audio_fx",
    name: c.name,
    cmd: "set_audio_fx",
    args: { ...c.payload, minDb: -30, maxDb: -6, audioDelayMs: 0, eqEnabled: false, eqBands: [0,0,0,0,0,0,0,0,0,0] },
  })),
  { group: "screenshot", name: "take", cmd: "take_screenshot" },
  { group: "ab-loop", name: "cycle", cmd: "ab_loop_cycle" },
  { group: "ab-loop", name: "cycle", cmd: "ab_loop_cycle" },
  { group: "ab-loop", name: "clear", cmd: "ab_loop_clear" },
  { group: "pipeline", name: "info", cmd: "get_pipeline_info" },
];

export default function DevTester() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);

  const run = async () => {
    setRunning(true);
    setResults([]);
    const out: TestResult[] = [];
    for (const step of STEPS) {
      try {
        await invoke(step.cmd, step.args);
        out.push({ ...step, status: "ok" });
      } catch (e) {
        out.push({ ...step, status: "fail", error: String(e) });
      }
      // small delay so mpv has time to apply each step before the next
      await new Promise((r) => setTimeout(r, 50));
      setResults([...out]);
    }
    setRunning(false);
  };

  const passed = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "fail").length;

  return (
    <>
      <button
        className="fixed top-3 right-3 z-[100] w-8 h-8 rounded-full
                   bg-violet-600/80 hover:bg-violet-500 text-white
                   flex items-center justify-center shadow-lg cursor-pointer"
        onClick={() => setOpen((o) => !o)}
        title="Dev: command tester"
      >
        <Bug className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed top-14 right-3 z-[100] w-96 max-h-[70vh]
                       bg-[#101010]/95 backdrop-blur-xl 
                       rounded-xl shadow-2xl overflow-hidden flex flex-col"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
              <span className="text-xs font-medium text-white/85">
                Dev tester
                {results.length > 0 && (
                  <span className="ml-2 text-[10px] text-white/50">
                    {passed} ✓ · {failed} ✗ · {results.length}/{STEPS.length}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1">
                <button
                  className={`px-2 py-1 text-[10px] rounded cursor-pointer flex items-center gap-1 ${
                    running
                      ? "bg-white/10 text-white/40 cursor-wait"
                      : "bg-white/15 hover:bg-white/25 text-white/85"
                  }`}
                  disabled={running}
                  onClick={run}
                >
                  <Play className="w-3 h-3" /> Run all
                </button>
                <button
                  className="w-6 h-6 flex items-center justify-center text-white/60
                             hover:text-white rounded hover:bg-white/10 cursor-pointer"
                  onClick={() => setOpen(false)}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 px-2 py-1 space-y-px">
              {results.length === 0 && !running && (
                <div className="text-[11px] text-white/40 px-2 py-4 text-center">
                  Click "Run all" to test {STEPS.length} command paths.
                </div>
              )}
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`text-[10px] flex items-start gap-2 px-2 py-1 rounded ${
                    r.status === "ok"
                      ? "text-white/80"
                      : "bg-rose-900/30 text-rose-200"
                  }`}
                >
                  {r.status === "ok" ? (
                    <Check className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 text-rose-400 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white/55">{r.group}</span>
                      <span className="font-medium">{r.name}</span>
                      <span className="text-white/40 ml-auto truncate">{r.cmd}</span>
                    </div>
                    {r.error && (
                      <div className="text-[9px] text-rose-300/90 mt-0.5 break-words">
                        {r.error}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
