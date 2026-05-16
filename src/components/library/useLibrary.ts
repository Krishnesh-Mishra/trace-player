import { useState, useEffect, useCallback, useRef } from "react";
import Database from "@tauri-apps/plugin-sql";
import type {
  LibraryTab,
  LibraryItem,
  FolderEntry,
  BreadcrumbEntry,
  PinnedEntry,
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

  const navigateToFolder = useCallback((id: number | null) => {
    setFolderId(id);
    setSearchQuery("");
  }, []);

  const addLocalItem = useCallback(
    async (path: string, title: string) => {
      try {
        const db = await getDb();
        await db.execute(
          "INSERT INTO items (tab, title, path, folder_id) VALUES ('local', $1, $2, $3)",
          [title, path, folderId],
        );
        void fetchContents();
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
    async (id: number) => {
      try {
        const db = await getDb();
        await db.execute("DELETE FROM folders WHERE id = $1", [id]);
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
    deleteItem,
    createFolder,
    deleteFolder,
    renameFolder,
    pinItem,
    unpinItem,
    updateItemThumb,
    markPlayed,
    getRecentItems,
    refresh: fetchContents,
  };
}
