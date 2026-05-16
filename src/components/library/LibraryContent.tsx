import { useState, useCallback } from "react";
import { Plus, Search, FolderPlus } from "lucide-react";
import type { BreadcrumbEntry, FolderEntry, LibraryItem, LibraryTab } from "./types";
import LibraryBreadcrumb from "./LibraryBreadcrumb";
import LibraryGrid from "./LibraryGrid";

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
  onThumbGenerated?: (id: number, thumbPath: string) => void;
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
  onThumbGenerated,
}: Props) {
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const handleCreateFolder = useCallback(() => {
    const name = newFolderName.trim();
    if (!name) return;
    onCreateFolder(name);
    setNewFolderName("");
    setCreatingFolder(false);
  }, [newFolderName, onCreateFolder]);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
        <div className="flex items-center gap-2">
          <button
            onClick={onImport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                       text-black bg-white rounded-lg hover:bg-white/90
                       active:scale-95 transition-all duration-100 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Import
          </button>
          {tab !== "explore" && (
            <>
              {creatingFolder ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder();
                      if (e.key === "Escape") setCreatingFolder(false);
                    }}
                    placeholder="Folder name"
                    autoFocus
                    className="w-32 bg-white/8 border border-white/10 rounded-md px-2 py-1
                               text-[11px] text-white placeholder:text-white/25 outline-none
                               focus:border-white/30 transition-colors"
                  />
                  <button
                    onClick={handleCreateFolder}
                    className="px-2 py-1 text-[11px] text-white/70 hover:text-white
                               rounded-md hover:bg-white/10 cursor-pointer transition-colors"
                  >
                    Create
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCreatingFolder(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-white/50
                             hover:text-white/80 rounded-lg hover:bg-white/8 cursor-pointer
                             transition-colors duration-100"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  Folder
                </button>
              )}
            </>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="w-48 bg-white/5 border border-white/8 rounded-lg pl-8 pr-3 py-1.5
                       text-[11px] text-white placeholder:text-white/25 outline-none
                       focus:border-white/20 transition-colors duration-100"
          />
        </div>
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
        onItemDelete={onItemDelete}
        onThumbGenerated={onThumbGenerated}
      />
    </div>
  );
}
