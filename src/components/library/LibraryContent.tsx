import { useState, useCallback, useRef } from "react";
import {
  Plus, Search, FolderPlus, Play, Pencil, Copy, Scissors,
  ClipboardPaste, Trash2, Info, FolderOpen, Pin, Download,
} from "lucide-react";
import type { BreadcrumbEntry, FolderEntry, LibraryItem, LibraryTab, PinnedEntry } from "./types";
import LibraryBreadcrumb from "./LibraryBreadcrumb";
import LibraryGrid from "./LibraryGrid";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import PropertiesDialog from "./PropertiesDialog";
import DeleteConfirmDialog from "./DeleteConfirmDialog";
import NewFolderDialog from "./NewFolderDialog";

export interface ClipboardEntry {
  type: "item" | "folder";
  id: number;
  action: "copy" | "cut";
}

interface Props {
  tab: LibraryTab;
  breadcrumb: BreadcrumbEntry[];
  folders: FolderEntry[];
  items: LibraryItem[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onNavigateFolder: (id: number | null) => void;
  onFolderOpen: (id: number) => void;
  onItemPlay: (item: LibraryItem) => void;
  onItemDelete: (item: LibraryItem) => void;
  onImport: () => void;
  onCreateFolder: (name: string) => void;
  onRenameItem: (id: number, title: string) => void;
  onRenameFolder: (id: number, name: string) => void;
  onDeleteFolder: (id: number, mode: "deleteAll" | "moveToParent") => void;
  onMoveItem: (id: number, targetFolderId: number | null) => void;
  onMoveFolder: (id: number, targetParentId: number | null) => void;
  onCopyItem: (id: number, targetFolderId: number | null) => void;
  onCopyFolder: (id: number, targetParentId: number | null) => void;
  currentFolderId: number | null;
  pinned: PinnedEntry[];
  onPinFolder: (folderId: number, name: string) => void;
  onUnpinFolder: (pinnedId: number) => void;
  folderPreviews?: Record<number, string[]>;
  onDownloadTorrent?: (item: LibraryItem) => void;
}

export default function LibraryContent({
  tab,
  breadcrumb,
  folders,
  items,
  loading,
  searchQuery,
  onSearchChange,
  onNavigateFolder,
  onFolderOpen,
  onItemPlay,
  onItemDelete,
  onImport,
  onCreateFolder,
  onRenameItem,
  onRenameFolder,
  onDeleteFolder,
  onMoveItem,
  onMoveFolder,
  onCopyItem,
  onCopyFolder,
  currentFolderId,
  pinned,
  onPinFolder,
  onUnpinFolder,
  folderPreviews,
  onDownloadTorrent,
}: Props) {
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardEntry | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [renamingItemId, setRenamingItemId] = useState<number | null>(null);
  const [propsItem, setPropsItem] = useState<LibraryItem | null>(null);
  const [propsFolder, setPropsFolder] = useState<FolderEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "item" | "folder"; id: number; name: string } | null>(null);

  const handleSearchInput = useCallback((value: string) => {
    setLocalSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearchChange(value), 100);
  }, [onSearchChange]);

  const handlePaste = useCallback(() => {
    if (!clipboard) return;
    if (clipboard.type === "item") {
      if (clipboard.action === "cut") {
        onMoveItem(clipboard.id, currentFolderId);
      } else {
        onCopyItem(clipboard.id, currentFolderId);
      }
    } else {
      if (clipboard.action === "cut") {
        onMoveFolder(clipboard.id, currentFolderId);
      } else {
        onCopyFolder(clipboard.id, currentFolderId);
      }
    }
    if (clipboard.action === "cut") setClipboard(null);
  }, [clipboard, currentFolderId, onMoveItem, onCopyItem, onMoveFolder, onCopyFolder]);

  const handleFolderContext = useCallback(
    (e: React.MouseEvent, folder: FolderEntry) => {
      const existingPin = pinned.find((p) => p.kind === "folder" && p.folder_id === folder.id);
      const menuItems: ContextMenuItem[] = [
        { label: "Open", icon: <FolderOpen className="w-3.5 h-3.5" />, onClick: () => onFolderOpen(folder.id) },
        { label: "Rename", icon: <Pencil className="w-3.5 h-3.5" />, shortcut: "F2", onClick: () => setRenamingFolderId(folder.id) },
        { label: "", separator: true, onClick: () => {} },
        {
          label: existingPin ? "Unpin from Quick Access" : "Pin to Quick Access",
          icon: <Pin className="w-3.5 h-3.5" />,
          onClick: () => existingPin ? onUnpinFolder(existingPin.id) : onPinFolder(folder.id, folder.name),
        },
        { label: "", separator: true, onClick: () => {} },
        { label: "Copy", icon: <Copy className="w-3.5 h-3.5" />, shortcut: "Ctrl+C", onClick: () => setClipboard({ type: "folder", id: folder.id, action: "copy" }) },
        { label: "Cut", icon: <Scissors className="w-3.5 h-3.5" />, shortcut: "Ctrl+X", onClick: () => setClipboard({ type: "folder", id: folder.id, action: "cut" }) },
        { label: "", separator: true, onClick: () => {} },
        { label: "Properties", icon: <Info className="w-3.5 h-3.5" />, onClick: () => setPropsFolder(folder) },
        { label: "", separator: true, onClick: () => {} },
        { label: "Delete", icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => setDeleteTarget({ type: "folder", id: folder.id, name: folder.name }) },
      ];
      setCtxMenu({ x: e.clientX, y: e.clientY, items: menuItems });
    },
    [onFolderOpen, pinned, onPinFolder, onUnpinFolder],
  );

  const handleItemContext = useCallback(
    (e: React.MouseEvent, item: LibraryItem) => {
      const menuItems: ContextMenuItem[] = [
        { label: "Play", icon: <Play className="w-3.5 h-3.5" />, onClick: () => onItemPlay(item) },
        ...(item.tab === "torrents" && item.magnet_uri && onDownloadTorrent ? [
          { label: "Download", icon: <Download className="w-3.5 h-3.5" />, onClick: () => onDownloadTorrent(item) },
        ] : []),
        { label: "Rename", icon: <Pencil className="w-3.5 h-3.5" />, shortcut: "F2", onClick: () => setRenamingItemId(item.id) },
        { label: "", separator: true, onClick: () => {} },
        { label: "Copy", icon: <Copy className="w-3.5 h-3.5" />, shortcut: "Ctrl+C", onClick: () => setClipboard({ type: "item", id: item.id, action: "copy" }) },
        { label: "Cut", icon: <Scissors className="w-3.5 h-3.5" />, shortcut: "Ctrl+X", onClick: () => setClipboard({ type: "item", id: item.id, action: "cut" }) },
        { label: "", separator: true, onClick: () => {} },
        { label: "Properties", icon: <Info className="w-3.5 h-3.5" />, onClick: () => setPropsItem(item) },
        { label: "", separator: true, onClick: () => {} },
        { label: "Delete", icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => setDeleteTarget({ type: "item", id: item.id, name: item.title }) },
      ];
      setCtxMenu({ x: e.clientX, y: e.clientY, items: menuItems });
    },
    [onItemPlay, onDownloadTorrent],
  );

  const handleEmptyContext = useCallback(
    (e: React.MouseEvent) => {
      const menuItems: ContextMenuItem[] = [
        { label: "Paste", icon: <ClipboardPaste className="w-3.5 h-3.5" />, shortcut: "Ctrl+V", disabled: !clipboard, onClick: handlePaste },
        { label: "", separator: true, onClick: () => {} },
        { label: "Import", icon: <Plus className="w-3.5 h-3.5" />, onClick: onImport },
        { label: "New Folder", icon: <FolderPlus className="w-3.5 h-3.5" />, onClick: () => setNewFolderOpen(true) },
      ];
      setCtxMenu({ x: e.clientX, y: e.clientY, items: menuItems });
    },
    [clipboard, handlePaste, onImport],
  );

  const handleRenameSubmit = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (renamingFolderId !== null && trimmed) {
        onRenameFolder(renamingFolderId, trimmed);
      }
      if (renamingItemId !== null && trimmed) {
        onRenameItem(renamingItemId, trimmed);
      }
      setRenamingFolderId(null);
      setRenamingItemId(null);
    },
    [renamingFolderId, renamingItemId, onRenameFolder, onRenameItem],
  );

  const handleRenameCancel = useCallback(() => {
    setRenamingFolderId(null);
    setRenamingItemId(null);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-black/20">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder="Search..."
            className="w-full bg-white/5 rounded-lg pl-8 pr-3 py-1.5
                       text-[11px] text-white placeholder:text-white/25 outline-none
                       transition-colors duration-100"
          />
        </div>

        <button
          onClick={onImport}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                     text-black bg-white rounded-lg hover:bg-white/90
                     active:scale-95 transition-all duration-100 cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Import
        </button>
      </div>

      {tab !== "explore" && (
        <LibraryBreadcrumb entries={breadcrumb} onNavigate={onNavigateFolder} />
      )}

      <LibraryGrid
        folders={tab === "explore" ? [] : folders}
        items={items}
        loading={loading}
        onFolderOpen={onFolderOpen}
        onItemPlay={onItemPlay}
        onItemDelete={(item) => setDeleteTarget({ type: "item", id: item.id, name: item.title })}
        onFolderContext={handleFolderContext}
        onItemContext={handleItemContext}
        onEmptyContext={handleEmptyContext}
        renamingFolderId={renamingFolderId}
        renamingItemId={renamingItemId}
        onRenameSubmit={handleRenameSubmit}
        onRenameCancel={handleRenameCancel}
        clipboard={clipboard}
        folderPreviews={folderPreviews}
      />

      <ContextMenu
        open={ctxMenu !== null}
        x={ctxMenu?.x ?? 0}
        y={ctxMenu?.y ?? 0}
        items={ctxMenu?.items ?? []}
        onClose={() => setCtxMenu(null)}
      />

      <PropertiesDialog
        open={propsItem !== null || propsFolder !== null}
        item={propsItem}
        folder={propsFolder}
        onClose={() => { setPropsItem(null); setPropsFolder(null); }}
      />

      <DeleteConfirmDialog
        open={deleteTarget !== null}
        name={deleteTarget?.name ?? ""}
        isFolder={deleteTarget?.type === "folder"}
        onConfirm={(mode) => {
          if (deleteTarget) {
            if (deleteTarget.type === "item") {
              const item = items.find((i) => i.id === deleteTarget.id);
              if (item) onItemDelete(item);
            } else {
              onDeleteFolder(deleteTarget.id, mode);
            }
          }
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <NewFolderDialog
        open={newFolderOpen}
        onConfirm={(name) => {
          onCreateFolder(name);
          setNewFolderOpen(false);
        }}
        onCancel={() => setNewFolderOpen(false)}
      />
    </div>
  );
}
