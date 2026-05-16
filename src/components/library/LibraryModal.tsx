import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useLibrary } from "./useLibrary";
import LibrarySidebar from "./LibrarySidebar";
import LibraryContent from "./LibraryContent";
import LibraryExploreView from "./LibraryExploreView";
import ImportDialog from "./ImportDialog";
import TorrentActionDialog from "./TorrentActionDialog";
import type { LibraryItem, PinnedEntry } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  onPlayFile: (path: string) => void;
  onPlayTorrent: (magnet: string) => void;
}

export default function LibraryModal({
  open,
  onClose,
  onPlayFile,
  onPlayTorrent,
}: Props) {
  const lib = useLibrary(open);
  const [importOpen, setImportOpen] = useState(false);
  const [torrentAction, setTorrentAction] = useState<LibraryItem | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !importOpen && !torrentAction) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, importOpen, torrentAction]);

  const handleItemPlay = useCallback(
    (item: LibraryItem) => {
      void lib.markPlayed(item.id);
      if (item.tab === "torrents" && item.magnet_uri) {
        setTorrentAction(item);
      } else if (item.path) {
        onPlayFile(item.path);
      }
    },
    [lib, onPlayFile],
  );

  const handleStream = useCallback(
    (item: LibraryItem) => {
      if (item.magnet_uri) onPlayTorrent(item.magnet_uri);
    },
    [onPlayTorrent],
  );

  const handleDownload = useCallback(
    (item: LibraryItem) => {
      if (item.magnet_uri) onPlayTorrent(item.magnet_uri);
    },
    [onPlayTorrent],
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

  const handleThumbGenerated = useCallback(
    (id: number, thumbPath: string) => {
      void lib.updateItemThumb(id, thumbPath);
    },
    [lib],
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/80" onClick={onClose} />

          <motion.div
            ref={modalRef}
            className="relative w-[90vw] h-[90vh] bg-[#0c0c0c] rounded-2xl border border-white/8
                       shadow-2xl overflow-hidden flex"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
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
                onThumbGenerated={handleThumbGenerated}
              />
            )}

            <ImportDialog
              open={importOpen}
              onClose={() => setImportOpen(false)}
              onImportLocal={(path, title) => void lib.addLocalItem(path, title)}
              onImportTorrent={(uri, title) => void lib.addTorrentItem(uri, title)}
            />

            <TorrentActionDialog
              open={torrentAction !== null}
              item={torrentAction}
              onClose={() => setTorrentAction(null)}
              onStream={handleStream}
              onDownload={handleDownload}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
