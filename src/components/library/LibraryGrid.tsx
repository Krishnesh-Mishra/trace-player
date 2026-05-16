import { FolderOpen } from "lucide-react";
import { motion } from "framer-motion";
import type { FolderEntry, LibraryItem } from "./types";
import LibraryCard from "./LibraryCard";

interface Props {
  folders: FolderEntry[];
  items: LibraryItem[];
  loading: boolean;
  onFolderOpen: (id: number) => void;
  onItemPlay: (item: LibraryItem) => void;
  onItemDelete: (item: LibraryItem) => void;
  onThumbGenerated?: (id: number, thumbPath: string) => void;
}

export default function LibraryGrid({
  folders,
  items,
  loading,
  onFolderOpen,
  onItemPlay,
  onItemDelete,
  onThumbGenerated,
}: Props) {
  if (!loading && folders.length === 0 && items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-white/30">
          No items yet. Import files or torrents to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {folders.map((folder) => (
          <motion.button
            key={`f-${folder.id}`}
            className="group aspect-video rounded-lg bg-white/[0.04] border border-white/8
                       hover:bg-white/[0.08] hover:border-white/15
                       flex flex-col items-center justify-center gap-2
                       cursor-pointer transition-colors duration-100"
            whileTap={{ scale: 0.97 }}
            onClick={() => onFolderOpen(folder.id)}
          >
            <FolderOpen className="w-8 h-8 text-white/30 group-hover:text-white/50 transition-colors" />
            <span className="text-xs text-white/60 group-hover:text-white/80 truncate max-w-[90%]">
              {folder.name}
            </span>
          </motion.button>
        ))}

        {items.map((item) => (
          <LibraryCard
            key={`i-${item.id}`}
            item={item}
            onPlay={() => onItemPlay(item)}
            onDelete={() => onItemDelete(item)}
            onThumbGenerated={onThumbGenerated}
          />
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
