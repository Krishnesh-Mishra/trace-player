// Lightweight logger for the React side.
//
// Format: `[NP <elapsed-since-start, s.mmm> <LEVEL> <tag>] <message>`. Goes
// through console.{log,warn,error,debug} so DevTools applies its level
// filter. Pair the elapsed-seconds with the backend's elapsed-ms in
// `src-tauri/src/log.rs` to correlate frontend and backend events.

const t0 =
  typeof performance !== "undefined" ? performance.now() : Date.now();

function elapsedSeconds(): string {
  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  return ((now - t0) / 1000).toFixed(3).padStart(8, " ");
}

function prefix(level: string, tag: string): string {
  return `[NP ${elapsedSeconds()}s ${level} ${tag}]`;
}

export const log = {
  info: (tag: string, ...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.log(prefix("INFO", tag), ...args);
  },
  warn: (tag: string, ...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.warn(prefix("WARN", tag), ...args);
  },
  err: (tag: string, ...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.error(prefix("ERR ", tag), ...args);
  },
  debug: (tag: string, ...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.debug(prefix("DBG ", tag), ...args);
  },
};
