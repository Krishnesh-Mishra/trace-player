import { useState, useEffect, useCallback, useRef } from "react";
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import type {
  LibraryTab,
  LibraryItem,
  FolderEntry,
  BreadcrumbEntry,
  PinnedEntry,
  TorrentVideoInfo,
} from "./types";

let dbPromise: Promise<Awaited<ReturnType<typeof Database.load>>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:library.db");
  }
  return dbPromise;
}

export function useLibrary(open: boolean) {
  const [tab, setTab] = useState<LibraryTab>("local");
  const [folderId, setFolderId] = useState<number | null>(null);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbEntry[]>([
    { id: null, name: "Home" },
  ]);
  const [pinned, setPinned] = useState<PinnedEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [folderPreviews, setFolderPreviews] = useState<Record<number, string[]>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchContents = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const db = await getDb();
      const tabFilter = tab === "explore" ? "local" : tab;

      let folderRows: FolderEntry[];
      if (folderId === null) {
        folderRows = await db.select<FolderEntry[]>(
          "SELECT * FROM folders WHERE parent_id IS NULL AND tab = $1 ORDER BY name",
          [tabFilter],
        );
      } else {
        folderRows = await db.select<FolderEntry[]>(
          "SELECT * FROM folders WHERE parent_id = $1 AND tab = $2 ORDER BY name",
          [folderId, tabFilter],
        );
      }

      let itemRows: LibraryItem[];
      if (searchQuery) {
        const like = `%${searchQuery}%`;
        if (folderId === null) {
          itemRows = await db.select<LibraryItem[]>(
            "SELECT * FROM items WHERE tab = $1 AND folder_id IS NULL AND title LIKE $2 ORDER BY added_at DESC",
            [tabFilter, like],
          );
        } else {
          itemRows = await db.select<LibraryItem[]>(
            "SELECT * FROM items WHERE tab = $1 AND folder_id = $2 AND title LIKE $3 ORDER BY added_at DESC",
            [tabFilter, folderId, like],
          );
        }
      } else {
        if (folderId === null) {
          itemRows = await db.select<LibraryItem[]>(
            "SELECT * FROM items WHERE tab = $1 AND folder_id IS NULL ORDER BY added_at DESC",
            [tabFilter],
          );
        } else {
          itemRows = await db.select<LibraryItem[]>(
            "SELECT * FROM items WHERE tab = $1 AND folder_id = $2 ORDER BY added_at DESC",
            [tabFilter, folderId],
          );
        }
      }

      if (mountedRef.current) {
        setFolders(folderRows);
        setItems(itemRows);
      }

      if (folderRows.length > 0) {
        const previews: Record<number, string[]> = {};
        for (const f of folderRows) {
          const thumbRows = await db.select<{ thumb_path: string }[]>(
            "SELECT thumb_path FROM items WHERE folder_id = $1 AND thumb_path IS NOT NULL LIMIT 4",
            [f.id],
          );
          if (thumbRows.length > 0) {
            previews[f.id] = thumbRows.map((r) => r.thumb_path);
          }
        }
        if (mountedRef.current) setFolderPreviews(previews);
      }
    } catch (e) {
      console.error("library fetch:", e);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [open, tab, folderId, searchQuery]);

  const fetchBreadcrumb = useCallback(async () => {
    const crumbs: BreadcrumbEntry[] = [{ id: null, name: "Home" }];
    if (folderId === null) {
      setBreadcrumb(crumbs);
      return;
    }
    try {
      const db = await getDb();
      let currentId: number | null = folderId;
      const chain: BreadcrumbEntry[] = [];
      while (currentId !== null) {
        const rows: FolderEntry[] = await db.select<FolderEntry[]>(
          "SELECT * FROM folders WHERE id = $1",
          [currentId],
        );
        if (rows.length === 0) break;
        chain.unshift({ id: rows[0].id, name: rows[0].name });
        currentId = rows[0].parent_id;
      }
      setBreadcrumb([...crumbs, ...chain]);
    } catch (e) {
      console.error("breadcrumb:", e);
    }
  }, [folderId]);

  const fetchPinned = useCallback(async () => {
    try {
      const db = await getDb();
      const rows = await db.select<PinnedEntry[]>(
        "SELECT * FROM pinned ORDER BY sort_order",
      );
      if (mountedRef.current) setPinned(rows);
    } catch (e) {
      console.error("pinned:", e);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchContents();
      void fetchBreadcrumb();
      void fetchPinned();
    }
  }, [open, fetchContents, fetchBreadcrumb, fetchPinned]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await getDb();
        const rows = await db.select<{ id: number; path: string }[]>(
          "SELECT id, path FROM items WHERE thumb_path IS NULL AND path IS NOT NULL",
        );
        for (const row of rows) {
          if (cancelled) break;
          try {
            const thumbPath = await invoke<string>("generate_library_thumb", { path: row.path });
            await db.execute("UPDATE items SET thumb_path = $1 WHERE id = $2", [thumbPath, row.id]);
          } catch {}
        }
        if (!cancelled) void fetchContents();
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [open, fetchContents]);

  const navigateToFolder = useCallback((id: number | null) => {
    setFolderId(id);
    setSearchQuery("");
  }, []);

  const addLocalItem = useCallback(
    async (path: string, title: string) => {
      try {
        const db = await getDb();
        const res = await db.execute(
          "INSERT INTO items (tab, title, path, folder_id) VALUES ('local', $1, $2, $3)",
          [title, path, folderId],
        );
        void fetchContents();
        const newId = res.lastInsertId;
        if (newId) {
          invoke<string>("generate_library_thumb", { path })
            .then((thumbPath) => {
              void db.execute("UPDATE items SET thumb_path = $1 WHERE id = $2", [thumbPath, newId]);
              void fetchContents();
            })
            .catch(() => {});
        }
      } catch (e) {
        console.error("addLocal:", e);
      }
    },
    [folderId, fetchContents],
  );

  const addTorrentItem = useCallback(
    async (magnetUri: string, title: string) => {
      try {
        const db = await getDb();
        await db.execute(
          "INSERT INTO items (tab, title, magnet_uri, folder_id) VALUES ('torrents', $1, $2, $3)",
          [title, magnetUri, folderId],
        );
        void fetchContents();
      } catch (e) {
        console.error("addTorrent:", e);
      }
    },
    [folderId, fetchContents],
  );

  const addTorrentAsFolder = useCallback(
    async (magnetUri: string, torrentName: string, videos: TorrentVideoInfo[]) => {
      try {
        const db = await getDb();
        if (videos.length === 1) {
          await db.execute(
            "INSERT INTO items (tab, title, magnet_uri, folder_id, file_index, file_size) VALUES ('torrents', $1, $2, $3, $4, $5)",
            [videos[0].name, magnetUri, folderId, videos[0].idx, videos[0].length],
          );
        } else {
          const result = await db.execute(
            "INSERT INTO folders (name, parent_id, tab) VALUES ($1, $2, 'torrents')",
            [torrentName, folderId],
          );
          const newFolderId = result.lastInsertId;
          for (const v of videos) {
            await db.execute(
              "INSERT INTO items (tab, title, magnet_uri, folder_id, file_index, file_size) VALUES ('torrents', $1, $2, $3, $4, $5)",
              [v.name, magnetUri, newFolderId, v.idx, v.length],
            );
          }
        }
        void fetchContents();
      } catch (e) {
        console.error("addTorrentAsFolder:", e);
      }
    },
    [folderId, fetchContents],
  );

  const deleteItem = useCallback(
    async (id: number) => {
      try {
        const db = await getDb();
        await db.execute("DELETE FROM items WHERE id = $1", [id]);
        void fetchContents();
      } catch (e) {
        console.error("deleteItem:", e);
      }
    },
    [fetchContents],
  );

  const createFolder = useCallback(
    async (name: string) => {
      try {
        const db = await getDb();
        const tabValue = tab === "explore" ? "local" : tab;
        await db.execute(
          "INSERT INTO folders (name, parent_id, tab) VALUES ($1, $2, $3)",
          [name, folderId, tabValue],
        );
        void fetchContents();
      } catch (e) {
        console.error("createFolder:", e);
      }
    },
    [tab, folderId, fetchContents],
  );

  const deleteFolder = useCallback(
    async (id: number, mode: "deleteAll" | "moveToParent") => {
      try {
        const db = await getDb();
        if (mode === "deleteAll") {
          await db.execute("DELETE FROM items WHERE folder_id = $1", [id]);
          await db.execute("DELETE FROM folders WHERE id = $1", [id]);
        } else {
          const rows = await db.select<{ parent_id: number | null }[]>(
            "SELECT parent_id FROM folders WHERE id = $1",
            [id],
          );
          const parentId = rows[0]?.parent_id ?? null;
          await db.execute(
            "UPDATE items SET folder_id = $1 WHERE folder_id = $2",
            [parentId, id],
          );
          await db.execute(
            "UPDATE folders SET parent_id = $1 WHERE parent_id = $2",
            [parentId, id],
          );
          await db.execute("DELETE FROM folders WHERE id = $1", [id]);
        }
        void fetchContents();
      } catch (e) {
        console.error("deleteFolder:", e);
      }
    },
    [fetchContents],
  );

  const renameFolder = useCallback(
    async (id: number, name: string) => {
      try {
        const db = await getDb();
        await db.execute("UPDATE folders SET name = $1 WHERE id = $2", [
          name,
          id,
        ]);
        void fetchContents();
      } catch (e) {
        console.error("renameFolder:", e);
      }
    },
    [fetchContents],
  );

  const renameItem = useCallback(
    async (id: number, title: string) => {
      try {
        const db = await getDb();
        await db.execute("UPDATE items SET title = $1 WHERE id = $2", [title, id]);
        void fetchContents();
      } catch (e) {
        console.error("renameItem:", e);
      }
    },
    [fetchContents],
  );

  const moveItem = useCallback(
    async (id: number, targetFolderId: number | null) => {
      try {
        const db = await getDb();
        await db.execute("UPDATE items SET folder_id = $1 WHERE id = $2", [targetFolderId, id]);
        void fetchContents();
      } catch (e) {
        console.error("moveItem:", e);
      }
    },
    [fetchContents],
  );

  const moveFolder = useCallback(
    async (id: number, targetParentId: number | null) => {
      try {
        const db = await getDb();
        await db.execute("UPDATE folders SET parent_id = $1 WHERE id = $2", [targetParentId, id]);
        void fetchContents();
      } catch (e) {
        console.error("moveFolder:", e);
      }
    },
    [fetchContents],
  );

  const copyItem = useCallback(
    async (id: number, targetFolderId: number | null) => {
      try {
        const db = await getDb();
        const rows = await db.select<LibraryItem[]>("SELECT * FROM items WHERE id = $1", [id]);
        if (rows.length === 0) return;
        const src = rows[0];
        await db.execute(
          "INSERT INTO items (tab, title, path, magnet_uri, folder_id, file_index, file_size) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [src.tab, src.title, src.path, src.magnet_uri, targetFolderId, src.file_index, src.file_size],
        );
        void fetchContents();
      } catch (e) {
        console.error("copyItem:", e);
      }
    },
    [fetchContents],
  );

  const copyFolder = useCallback(
    async (id: number, targetParentId: number | null) => {
      try {
        const db = await getDb();
        const folderRows = await db.select<FolderEntry[]>("SELECT * FROM folders WHERE id = $1", [id]);
        if (folderRows.length === 0) return;
        const src = folderRows[0];
        const result = await db.execute(
          "INSERT INTO folders (name, parent_id, tab) VALUES ($1, $2, $3)",
          [src.name + " (copy)", targetParentId, src.tab],
        );
        const newId = result.lastInsertId;
        const childItems = await db.select<LibraryItem[]>("SELECT * FROM items WHERE folder_id = $1", [id]);
        for (const item of childItems) {
          await db.execute(
            "INSERT INTO items (tab, title, path, magnet_uri, folder_id, file_index, file_size) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [item.tab, item.title, item.path, item.magnet_uri, newId, item.file_index, item.file_size],
          );
        }
        void fetchContents();
      } catch (e) {
        console.error("copyFolder:", e);
      }
    },
    [fetchContents],
  );

  const pinItem = useCallback(
    async (
      kind: "folder" | "filesystem",
      label: string,
      fId?: number,
      fsPath?: string,
    ) => {
      try {
        const db = await getDb();
        await db.execute(
          "INSERT INTO pinned (kind, folder_id, fs_path, label) VALUES ($1, $2, $3, $4)",
          [kind, fId ?? null, fsPath ?? null, label],
        );
        void fetchPinned();
      } catch (e) {
        console.error("pin:", e);
      }
    },
    [fetchPinned],
  );

  const unpinItem = useCallback(
    async (id: number) => {
      try {
        const db = await getDb();
        await db.execute("DELETE FROM pinned WHERE id = $1", [id]);
        void fetchPinned();
      } catch (e) {
        console.error("unpin:", e);
      }
    },
    [fetchPinned],
  );

  const updateItemThumb = useCallback(
    async (id: number, thumbPath: string) => {
      try {
        const db = await getDb();
        await db.execute("UPDATE items SET thumb_path = $1 WHERE id = $2", [
          thumbPath,
          id,
        ]);
      } catch (e) {
        console.error("updateThumb:", e);
      }
    },
    [],
  );

  const markPlayed = useCallback(async (id: number) => {
    try {
      const db = await getDb();
      await db.execute(
        "UPDATE items SET last_played = strftime('%s','now'), play_count = play_count + 1 WHERE id = $1",
        [id],
      );
    } catch (e) {
      console.error("markPlayed:", e);
    }
  }, []);

  const getRecentItems = useCallback(async (): Promise<LibraryItem[]> => {
    try {
      const db = await getDb();
      return await db.select<LibraryItem[]>(
        "SELECT * FROM items WHERE last_played IS NOT NULL ORDER BY last_played DESC LIMIT 5",
      );
    } catch {
      return [];
    }
  }, []);

  return {
    tab,
    setTab,
    folderId,
    navigateToFolder,
    folders,
    items,
    breadcrumb,
    pinned,
    searchQuery,
    setSearchQuery,
    loading,
    addLocalItem,
    addTorrentItem,
    addTorrentAsFolder,
    deleteItem,
    createFolder,
    deleteFolder,
    renameFolder,
    renameItem,
    moveItem,
    moveFolder,
    copyItem,
    copyFolder,
    pinItem,
    unpinItem,
    updateItemThumb,
    markPlayed,
    getRecentItems,
    folderPreviews,
    refresh: fetchContents,
  };
}
