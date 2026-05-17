import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useLibrary } from "./useLibrary";
import LibrarySidebar from "./LibrarySidebar";
import LibraryContent from "./LibraryContent";
import LibraryExploreView from "./LibraryExploreView";
import DownloadsView from "./DownloadsView";
import ImportDialog from "./ImportDialog";
import type { LibraryItem, PinnedEntry } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  onPlayFile: (path: string) => void;
  onPlayTorrent: (magnet: string, fileIndex?: number) => void;
}

export default function LibraryModal({
  open,
  onClose,
  onPlayFile,
  onPlayTorrent,
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
              className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center
                         text-white/30 hover:text-white/70 rounded-lg hover:bg-white/10
                         cursor-pointer transition-colors duration-100"
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
