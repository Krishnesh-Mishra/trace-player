import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Lock, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";

export interface AuthBrowserOption {
  id: string;
  label: string;
}

// yt-dlp's `--cookies-from-browser` accepts these names. We surface the same
// list in the picker; Safari is excluded on Windows since it isn't installable
// there and would only confuse the user.
export const AUTH_BROWSER_OPTIONS: AuthBrowserOption[] = [
  { id: "chrome", label: "Chrome" },
  { id: "edge", label: "Edge" },
  { id: "firefox", label: "Firefox" },
  { id: "brave", label: "Brave" },
  { id: "vivaldi", label: "Vivaldi" },
  { id: "opera", label: "Opera" },
  { id: "chromium", label: "Chromium" },
];

interface Props {
  open: boolean;
  url: string;
  ytdlLog: string[];
  /** Default browser picked by the parent (from settings store). */
  defaultBrowser: string | null;
  /** Persist + apply a new browser choice. Returns when applied. */
  onApplyBrowser: (browser: string) => Promise<void> | void;
  /** Re-issue `open_source` with the same URL. */
  onRetry: () => Promise<void> | void;
  /** User dismissed the modal. Parent should remember the domain so a
   *  subsequent failure for the same site falls back to the toast. */
  onCancel: () => void;
  onClose: () => void;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function AuthRequiredModal({
  open,
  url,
  ytdlLog,
  defaultBrowser,
  onApplyBrowser,
  onRetry,
  onCancel,
  onClose,
}: Props) {
  const [browser, setBrowser] = useState<string>(
    defaultBrowser || AUTH_BROWSER_OPTIONS[0].id
  );
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  const site = useMemo(() => domainOf(url), [url]);
  // First non-empty ytdl_hook line is usually the diagnostic the user wants
  // to see (e.g. "[hotstar] ...: This video is only available for registered
  // users. Use --cookies-from-browser …").
  const summary = useMemo(
    () =>
      ytdlLog
        .map((s) => s.trim())
        .find((s) => s.length > 0 && /[a-z]/i.test(s)) ?? "",
    [ytdlLog]
  );
  // Classify the failure so we can show actionable advice instead of a
  // generic "pick a browser" prompt:
  //   - "cookie-locked": the user already had a browser set, but its
  //     cookie database was locked (yt-dlp issue #7271 — Chrome / Edge /
  //     Brave do this on Windows while running). Suggest closing the
  //     browser, or using Firefox which doesn't take an exclusive lock.
  //   - "auth-required": fresh need for login. Default flow.
  const kind: "cookie-locked" | "auth-required" = useMemo(() => {
    const text = ytdlLog.join("\n").toLowerCase();
    if (
      text.includes("could not copy") ||
      text.includes("cookie database") ||
      text.includes("database is locked")
    ) {
      return "cookie-locked";
    }
    return "auth-required";
  }, [ytdlLog]);

  useEffect(() => {
    if (open) {
      // Pre-select Firefox when the failure was a cookie-DB lock and the
      // user's previous pick was a Chromium-based browser — those all
      // share the locked-while-running issue. Firefox doesn't, so it's
      // the highest-success-rate retry.
      const chromiumLike = new Set([
        "chrome",
        "edge",
        "brave",
        "vivaldi",
        "opera",
        "chromium",
      ]);
      const initial =
        kind === "cookie-locked" &&
        (defaultBrowser === null || chromiumLike.has(defaultBrowser ?? ""))
          ? "firefox"
          : defaultBrowser || AUTH_BROWSER_OPTIONS[0].id;
      setBrowser(initial);
      setBusy(false);
      setShowLog(false);
      setError(null);
      const t = setTimeout(() => firstButtonRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open, defaultBrowser, kind]);

  const handleRetry = async () => {
    setBusy(true);
    try {
      await onApplyBrowser(browser);
      await onRetry();
      onClose();
    } catch (e) {
      setBusy(false);
      setError(String(e));
    }
  };

  const handleOpenInBrowser = async () => {
    try {
      await openUrl(url);
    } catch {
      // openUrl can fail for malformed URLs; fall back to invoking the
      // opener plugin directly through Tauri's command bus.
      try {
        await invoke("plugin:opener|open_url", { url });
      } catch {
        /* swallow — best-effort; user can copy the URL from the modal */
      }
    }
  };

  const handleCancel = () => {
    onCancel();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleCancel}
        >
          <motion.div
            className="bg-[#111]/95 backdrop-blur-xl  rounded-2xl
                       shadow-2xl p-5 w-[460px] max-w-[92vw] flex flex-col gap-4"
            initial={{ scale: 0.92, y: -8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className="shrink-0 w-9 h-9 rounded-full bg-amber-500/10
                              border border-amber-500/30 flex items-center justify-center"
              >
                <Lock className="w-4 h-4 text-amber-300" />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium text-white">
                  {kind === "cookie-locked"
                    ? "Browser is holding its cookies hostage"
                    : "This video requires login"}
                </span>
                <span className="text-[11px] text-white/55 truncate">{site}</span>
              </div>
            </div>

            <p className="text-[12px] text-white/65 leading-relaxed">
              {kind === "cookie-locked" ? (
                <>
                  <b>
                    {defaultBrowser
                      ? defaultBrowser[0].toUpperCase() + defaultBrowser.slice(1)
                      : "Your browser"}{" "}
                    is open
                  </b>
                  , so it’s holding an exclusive lock on its cookie database
                  and yt-dlp can’t read it. Either close{" "}
                  {defaultBrowser ?? "that browser"} completely (incl. system
                  tray) and hit Retry, or pick <b>Firefox</b> below — Firefox
                  doesn’t take an exclusive lock.
                </>
              ) : (
                <>
                  {site} won’t play without your account credentials. Pick the
                  browser you’re signed in with — yt-dlp will read its cookies
                  and retry. Cookies are only applied to {site} from now on,
                  not to every URL.
                </>
              )}
            </p>

            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-white/40">
                Cookies from browser
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {AUTH_BROWSER_OPTIONS.map((b, idx) => {
                  const active = browser === b.id;
                  return (
                    <button
                      key={b.id}
                      ref={idx === 0 ? firstButtonRef : undefined}
                      onClick={() => setBrowser(b.id)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs cursor-pointer
                                  transition-colors duration-100 border ${
                                    active
                                      ? "bg-white/15 border-white/30 text-white"
                                      : "bg-white/5 border-white/10 text-white/65 hover:text-white/90 hover:bg-white/10"
                                  }`}
                    >
                      {b.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {summary && (
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => setShowLog((v) => !v)}
                  className="self-start flex items-center gap-1 text-[10px] uppercase
                             tracking-wider text-white/40 hover:text-white/65 cursor-pointer"
                >
                  {showLog ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  Why?
                </button>
                {showLog && (
                  <pre
                    className="text-[10px] text-white/55 bg-black/40 
                                 rounded-md p-2 leading-snug whitespace-pre-wrap break-words"
                  >
                    {summary}
                  </pre>
                )}
              </div>
            )}

            {error && (
              <span className="text-[11px] text-red-400 leading-snug">
                {error}
              </span>
            )}

            <div className="flex gap-2 justify-between items-center pt-1">
              <button
                onClick={handleOpenInBrowser}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/65
                           hover:text-white/90 rounded-lg hover:bg-white/8 cursor-pointer
                           transition-colors duration-100 disabled:opacity-40"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open in browser
              </button>
              <div className="flex gap-2">
                <button
                  onClick={handleCancel}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs text-white/50 hover:text-white/80
                             rounded-lg hover:bg-white/8 cursor-pointer
                             transition-colors duration-100 disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRetry}
                  disabled={busy}
                  className="px-4 py-1.5 text-xs font-medium text-black bg-white
                             rounded-lg hover:bg-white/90 active:scale-95 cursor-pointer
                             transition-all duration-100 disabled:opacity-40"
                >
                  {busy ? "Retrying…" : "Retry"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
