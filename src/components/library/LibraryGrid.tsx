import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-react";
import { motion } from "framer-motion";
import type { FolderEntry, LibraryItem } from "./types";
import type { ClipboardEntry } from "./LibraryContent";
import LibraryCard from "./LibraryCard";

function FolderPreview({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      paths.slice(0, 4).map((p) =>
        invoke<string>("read_thumb_base64", { path: p })
          .then((b64) => `data:image/jpeg;base64,${b64}`)
          .catch(() => null),
      ),
    ).then((results) => {
      if (!cancelled) setUrls(results.filter((r): r is string => r !== null));
    });
    return () => { cancelled = true; };
  }, [paths]);

  if (urls.length === 0) return <FolderOpen className="w-8 h-8 text-white/30 group-hover:text-white/50 transition-colors" />;

  return (
    <div className="w-full h-full grid grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-lg">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bg-white/5 overflow-hidden">
          {urls[i] ? (
            <img src={urls[i]} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full" />
          )}
        </div>
      ))}
    </div>
  );
}

interface Props {
  folders: FolderEntry[];
  items: LibraryItem[];
  loading: boolean;
  onFolderOpen: (id: number) => void;
  onItemPlay: (item: LibraryItem) => void;
  onItemDelete: (item: LibraryItem) => void;
  onFolderContext?: (e: React.MouseEvent, folder: FolderEntry) => void;
  onItemContext?: (e: React.MouseEvent, item: LibraryItem) => void;
  onEmptyContext?: (e: React.MouseEvent) => void;
  renamingFolderId?: number | null;
  renamingItemId?: number | null;
  onRenameSubmit?: (name: string) => void;
  onRenameCancel?: () => void;
  clipboard?: ClipboardEntry | null;
  folderPreviews?: Record<number, string[]>;
}

export default function LibraryGrid({
  folders,
  items,
  loading,
  onFolderOpen,
  onItemPlay,
  onItemDelete,
  onFolderContext,
  onItemContext,
  onEmptyContext,
  renamingFolderId,
  renamingItemId,
  onRenameSubmit,
  onRenameCancel,
  clipboard,
  folderPreviews,
}: Props) {
  if (!loading && folders.length === 0 && items.length === 0) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        onContextMenu={(e) => {
          e.preventDefault();
          onEmptyContext?.(e);
        }}
      >
        <p className="text-sm text-white/30">
          No items yet. Import files or torrents to get started.
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-y-auto px-4 pb-4"
      onContextMenu={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).closest("[data-grid-area]")) {
          e.preventDefault();
          onEmptyContext?.(e);
        }
      }}
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3" data-grid-area>
        {folders.map((folder) => {
          const hasPreviews = !!folderPreviews?.[folder.id]?.length;
          return (
            <motion.div
              key={`f-${folder.id}`}
              className={`group cursor-pointer
                         ${clipboard?.action === "cut" && clipboard.type === "folder" && clipboard.id === folder.id ? "opacity-40 grayscale" : ""}`}
              whileTap={{ scale: 0.97 }}
              onClick={() => onFolderOpen(folder.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onFolderContext?.(e, folder);
              }}
            >
              <div className={`aspect-video rounded-lg overflow-hidden bg-white/[0.04]
                              hover:bg-white/[0.08] transition-all duration-100
                              ${hasPreviews ? "" : "flex flex-col items-center justify-center"}`}>
                {hasPreviews ? (
                  <FolderPreview paths={folderPreviews![folder.id]} />
                ) : (
                  <FolderOpen className="w-8 h-8 text-white/30 group-hover:text-white/50 transition-colors" />
                )}
              </div>
              <div className="mt-1.5 px-0.5">
                {renamingFolderId === folder.id ? (
                  <input
                    type="text"
                    defaultValue={folder.name}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onRenameSubmit?.((e.target as HTMLInputElement).value);
                      if (e.key === "Escape") onRenameCancel?.();
                    }}
                    onBlur={(e) => onRenameSubmit?.(e.target.value)}
                    className="w-full bg-white/10 rounded px-1.5 py-0.5
                               text-xs text-white outline-none"
                  />
                ) : (
                  <p className="text-xs text-white/60 group-hover:text-white/80 truncate">
                    {folder.name}
                  </p>
                )}
              </div>
            </motion.div>
          );
        })}

        {items.map((item) => (
          <div
            key={`i-${item.id}`}
            className={clipboard?.action === "cut" && clipboard.type === "item" && clipboard.id === item.id ? "opacity-40 grayscale" : ""}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onItemContext?.(e, item);
            }}
          >
            <LibraryCard
              item={item}
              onPlay={() => onItemPlay(item)}
              onDelete={() => onItemDelete(item)}
              renaming={renamingItemId === item.id}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
            />
          </div>
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
