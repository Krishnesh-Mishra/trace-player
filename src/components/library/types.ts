export type LibraryTab = "torrents" | "local" | "explore" | "downloads" | "settings";

export interface LibraryItem {
  id: number;
  folder_id: number | null;
  tab: "torrents" | "local";
  title: string;
  path: string | null;
  magnet_uri: string | null;
  file_index: number | null;
  file_size: number | null;
  duration: number | null;
  thumb_path: string | null;
  last_played: number | null;
  play_count: number;
  added_at: number;
}

export interface TorrentVideoInfo {
  idx: number;
  name: string;
  length: number;
}

export interface FolderEntry {
  id: number;
  name: string;
  parent_id: number | null;
  tab: string;
  created_at: number;
}

export interface BreadcrumbEntry {
  id: number | null;
  name: string;
}

export interface PinnedEntry {
  id: number;
  kind: "folder" | "filesystem";
  folder_id: number | null;
  fs_path: string | null;
  label: string;
  sort_order: number;
}

export interface ExploreVideo {
  name: string;
  path: string;
  size: number;
}
