import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Play, GripVertical, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useLibrary } from "./useLibrary";
import LibrarySidebar from "./LibrarySidebar";
import LibraryContent from "./LibraryContent";
import LibraryExploreView from "./LibraryExploreView";
import DownloadsView from "./DownloadsView";
import ImportDialog from "./ImportDialog";
import type { LibraryItem, PinnedEntry } from "./types";
import type { PlaylistItem } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onPlayFile: (path: string) => void;
  onPlayTorrent: (magnet: string, fileIndex?: number) => void;
  playlist: PlaylistItem[];
  onPlaylistPlayIndex: (idx: number) => void;
  onPlaylistRemove: (idx: number) => void;
  onPlaylistClear: () => void;
  onPlaylistMove: (from: number, to: number) => void;
}

export default function LibraryModal({
  open,
  onClose,
  onPlayFile,
  onPlayTorrent,
  playlist,
  onPlaylistPlayIndex,
  onPlaylistRemove,
  onPlaylistClear,
  onPlaylistMove,
}: Props) {
  const lib = useLibrary(open);
  const [importOpen, setImportOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !importOpen) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, importOpen]);

  const handleItemPlay = useCallback(
    (item: LibraryItem) => {
      void lib.markPlayed(item.id);
      if (item.tab === "torrents" && item.magnet_uri) {
        onPlayTorrent(item.magnet_uri, item.file_index ?? undefined);
      } else if (item.path) {
        onPlayFile(item.path);
      }
    },
    [lib, onPlayFile, onPlayTorrent],
  );

  const handleDownloadTorrent = useCallback(
    (item: LibraryItem) => {
      if (item.magnet_uri) {
        invoke("start_download", {
          magnet: item.magnet_uri,
          fileIndex: item.file_index ?? null,
        }).catch(() => {});
      }
    },
    [],
  );

  const handlePinnedClick = useCallback(
    (pin: PinnedEntry) => {
      if (pin.kind === "folder" && pin.folder_id !== null) {
        lib.setTab("local");
        lib.navigateToFolder(pin.folder_id);
      }
    },
    [lib],
  );

  const handleRecentClick = useCallback(
    (item: LibraryItem) => {
      handleItemPlay(item);
    },
    [handleItemPlay],
  );

  const hasPlaylist = playlist.length > 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          data-no-app-ctx
        >
          <div className="absolute inset-0 bg-black/80" onClick={onClose} />

          <motion.div
            ref={modalRef}
            className="relative w-[90vw] h-[90vh] bg-[#0c0c0c] rounded-2xl
                       shadow-2xl overflow-hidden flex"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              onClick={onClose}
              className={`absolute top-3 z-10 w-7 h-7 flex items-center justify-center
                         text-white/30 hover:text-white/70 rounded-lg hover:bg-white/10
                         cursor-pointer transition-colors duration-100
                         ${hasPlaylist ? "right-[282px]" : "right-3"}`}
            >
              <X className="w-4 h-4" />
            </button>

            <LibrarySidebar
              activeTab={lib.tab}
              onTabChange={(t) => {
                lib.setTab(t);
                lib.navigateToFolder(null);
              }}
              pinned={lib.pinned}
              onPinnedClick={handlePinnedClick}
              onUnpin={(id) => void lib.unpinItem(id)}
              getRecentItems={lib.getRecentItems}
              onRecentClick={handleRecentClick}
            />

            {lib.tab === "explore" ? (
              <LibraryExploreView onPlayFile={onPlayFile} />
            ) : lib.tab === "downloads" ? (
              <DownloadsView />
            ) : (
              <LibraryContent
                tab={lib.tab}
                breadcrumb={lib.breadcrumb}
                folders={lib.folders}
                items={lib.items}
                loading={lib.loading}
                searchQuery={lib.searchQuery}
                onSearchChange={lib.setSearchQuery}
                onNavigateFolder={lib.navigateToFolder}
                onFolderOpen={(id) => lib.navigateToFolder(id)}
                onItemPlay={handleItemPlay}
                onItemDelete={(item) => void lib.deleteItem(item.id)}
                onImport={() => setImportOpen(true)}
                onCreateFolder={(name) => void lib.createFolder(name)}
                onRenameItem={(id, title) => void lib.renameItem(id, title)}
                onRenameFolder={(id, name) => void lib.renameFolder(id, name)}
                onDeleteFolder={(id, mode) => void lib.deleteFolder(id, mode)}
                onMoveItem={(id, target) => void lib.moveItem(id, target)}
                onMoveFolder={(id, target) => void lib.moveFolder(id, target)}
                onCopyItem={(id, target) => void lib.copyItem(id, target)}
                onCopyFolder={(id, target) => void lib.copyFolder(id, target)}
                currentFolderId={lib.folderId}
                pinned={lib.pinned}
                onPinFolder={(folderId, name) => void lib.pinItem("folder", name, folderId)}
                onUnpinFolder={(pinnedId) => void lib.unpinItem(pinnedId)}
                folderPreviews={lib.folderPreviews}
                onDownloadTorrent={handleDownloadTorrent}
              />
            )}

            {hasPlaylist && (
              <PlaylistSidePanel
                items={playlist}
                onPlayIndex={onPlaylistPlayIndex}
                onRemove={onPlaylistRemove}
                onClear={onPlaylistClear}
                onMove={onPlaylistMove}
              />
            )}

            <ImportDialog
              open={importOpen}
              onClose={() => setImportOpen(false)}
              onImportLocal={(path, title) => void lib.addLocalItem(path, title)}
              onImportTorrentResolved={(uri, name, videos) => void lib.addTorrentAsFolder(uri, name, videos)}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Embedded Playlist Panel ──────────────────────────────────────────────────

interface PlaylistSidePanelProps {
  items: PlaylistItem[];
  onPlayIndex: (idx: number) => void;
  onRemove: (idx: number) => void;
  onClear: () => void;
  onMove: (from: number, to: number) => void;
}

function PlaylistSidePanel({
  items,
  onPlayIndex,
  onRemove,
  onClear,
  onMove,
}: PlaylistSidePanelProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Two-click clear: first click shows "Confirm?", revert after 3s
  const handleClear = useCallback(() => {
    if (clearConfirm) {
      onClear();
      setClearConfirm(false);
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    } else {
      setClearConfirm(true);
      clearTimerRef.current = setTimeout(() => {
        setClearConfirm(false);
        clearTimerRef.current = null;
      }, 3000);
    }
  }, [clearConfirm, onClear]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  const handleDrop = (toIdx: number) => {
    if (dragIdx === null || dragIdx === toIdx) {
      setDragIdx(null);
      setDropIdx(null);
      return;
    }
    // Pass raw indices — App.tsx handlePlaylistMove does the mpv adjustment
    onMove(dragIdx, toIdx);
    setDragIdx(null);
    setDropIdx(null);
  };

  return (
    <div className="w-[270px] h-full bg-[#0a0a0a] flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 shrink-0">
        <h2 className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">
          Playlist
          <span className="ml-2 text-[10px] text-white/30 tabular-nums normal-case">
            {items.length}
          </span>
        </h2>
        <button
          onClick={handleClear}
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] cursor-pointer
                     transition-colors duration-100 ${
                       clearConfirm
                         ? "bg-red-500/15 text-red-400"
                         : "text-white/40 hover:text-red-300 hover:bg-red-500/10"
                     }`}
        >
          <Trash2 className="w-3 h-3" />
          <span>{clearConfirm ? "Confirm?" : "Clear"}</span>
        </button>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto py-1 px-1.5">
        <ul className="space-y-px">
          {items.map((item, i) => (
            <li
              key={`${item.index}-${i}`}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dropIdx !== i) setDropIdx(i);
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setDropIdx(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(i);
              }}
              className={`group relative flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer
                          transition-colors duration-100 select-none
                          ${item.current
                            ? "bg-[var(--np-accent-soft)]"
                            : "hover:bg-white/6"
                          }
                          ${dropIdx === i && dragIdx !== i
                            ? "bg-white/8"
                            : ""
                          }
                          ${dragIdx === i ? "opacity-40" : ""}`}
              onClick={() => onPlayIndex(item.index)}
            >
              <GripVertical className="w-3 h-3 text-white/20 shrink-0 cursor-grab" />
              <div className="w-4 h-4 flex items-center justify-center shrink-0">
                {item.current ? (
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--np-accent)]" />
                ) : (
                  <Play className="w-3 h-3 text-white/30 opacity-0 group-hover:opacity-100 transition-opacity duration-100" />
                )}
              </div>
              <p
                className={`flex-1 min-w-0 text-[11px] truncate ${
                  item.current ? "text-white font-medium" : "text-white/70"
                }`}
                title={item.filename}
              >
                {item.title || displayName(item.filename)}
              </p>
              <button
                className="w-4 h-4 flex items-center justify-center text-white/20
                           hover:text-red-400 opacity-0 group-hover:opacity-100
                           transition-opacity duration-100 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(i);
                }}
                title="Remove"
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Last path segment, decoded if URL-encoded. */
function displayName(p: string): string {
  if (!p) return "(unknown)";
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const tail = slash >= 0 ? p.slice(slash + 1) : p;
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}
