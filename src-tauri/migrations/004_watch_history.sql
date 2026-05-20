CREATE TABLE IF NOT EXISTS watch_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  path          TEXT NOT NULL UNIQUE,
  position      REAL NOT NULL DEFAULT 0,
  duration      REAL NOT NULL DEFAULT 0,
  subtitle_path TEXT,
  played_at     INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
