CREATE TABLE IF NOT EXISTS folders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  parent_id     INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  tab           TEXT NOT NULL CHECK(tab IN ('torrents','local')),
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX idx_folders_parent ON folders(parent_id, tab);

CREATE TABLE IF NOT EXISTS items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id     INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  tab           TEXT NOT NULL CHECK(tab IN ('torrents','local')),
  title         TEXT NOT NULL,
  path          TEXT,
  magnet_uri    TEXT,
  file_size     INTEGER,
  duration      REAL,
  thumb_path    TEXT,
  last_played   INTEGER,
  play_count    INTEGER NOT NULL DEFAULT 0,
  added_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX idx_items_folder ON items(folder_id);
CREATE INDEX idx_items_tab ON items(tab);

CREATE TABLE IF NOT EXISTS pinned (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL CHECK(kind IN ('folder','filesystem')),
  folder_id     INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  fs_path       TEXT,
  label         TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
