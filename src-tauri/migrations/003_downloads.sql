CREATE TABLE IF NOT EXISTS downloads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  torrent_id    INTEGER NOT NULL,
  magnet_uri    TEXT NOT NULL,
  title         TEXT NOT NULL,
  file_index    INTEGER,
  progress_bytes INTEGER NOT NULL DEFAULT 0,
  total_bytes   INTEGER NOT NULL DEFAULT 0,
  state         TEXT NOT NULL DEFAULT 'queued',
  started_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
