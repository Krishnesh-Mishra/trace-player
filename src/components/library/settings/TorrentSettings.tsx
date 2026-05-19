import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { Select, ListBox } from "@heroui/react";
import type { Key } from "react";

const CACHE_PRESETS: { label: string; value: string; bytes: number }[] = [
  { label: "Off", value: "0", bytes: 0 },
  { label: "500 MB", value: String(500 * 1024 * 1024), bytes: 500 * 1024 * 1024 },
  { label: "1 GB", value: String(1024 ** 3), bytes: 1024 ** 3 },
  { label: "5 GB", value: String(5 * 1024 ** 3), bytes: 5 * 1024 ** 3 },
  { label: "10 GB", value: String(10 * 1024 ** 3), bytes: 10 * 1024 ** 3 },
  { label: "25 GB", value: String(25 * 1024 ** 3), bytes: 25 * 1024 ** 3 },
  { label: "50 GB", value: String(50 * 1024 ** 3), bytes: 50 * 1024 ** 3 },
  { label: "100 GB", value: String(100 * 1024 ** 3), bytes: 100 * 1024 ** 3 },
];

const UPLOAD_SPEED_PRESETS: { label: string; value: string; bytes: number }[] = [
  { label: "Unlimited", value: "0", bytes: 0 },
  { label: "256 KB/s", value: "262144", bytes: 262144 },
  { label: "512 KB/s", value: "524288", bytes: 524288 },
  { label: "1 MB/s", value: "1048576", bytes: 1048576 },
  { label: "2 MB/s", value: "2097152", bytes: 2097152 },
  { label: "5 MB/s", value: "5242880", bytes: 5242880 },
];

const DOWNLOAD_SPEED_PRESETS: { label: string; value: string; bytes: number }[] = [
  { label: "Unlimited", value: "0", bytes: 0 },
  { label: "1 MB/s", value: "1048576", bytes: 1048576 },
  { label: "5 MB/s", value: "5242880", bytes: 5242880 },
  { label: "10 MB/s", value: "10485760", bytes: 10485760 },
  { label: "25 MB/s", value: "26214400", bytes: 26214400 },
  { label: "50 MB/s", value: "52428800", bytes: 52428800 },
];

const MAX_CONNECTIONS_PRESETS: { label: string; value: string; count: number }[] = [
  { label: "Default", value: "0", count: 0 },
  { label: "50", value: "50", count: 50 },
  { label: "100", value: "100", count: 100 },
  { label: "200", value: "200", count: 200 },
  { label: "500", value: "500", count: 500 },
];

export default function TorrentSettings() {
  const [cacheLimit, setCacheLimit] = useState(0);
  const [uploadLimit, setUploadLimit] = useState(0);
  const [downloadLimit, setDownloadLimit] = useState(0);
  const [maxConnections, setMaxConnections] = useState(0);

  useEffect(() => {
    Store.load("trace-player-settings.json")
      .then(async (s) => {
        const cache = await s.get<number>("torrentCacheLimitBytes");
        if (typeof cache === "number") setCacheLimit(cache);
        const upload = await s.get<number>("torrentUploadLimitBytes");
        if (typeof upload === "number") setUploadLimit(upload);
        const download = await s.get<number>("torrentDownloadLimitBytes");
        if (typeof download === "number") setDownloadLimit(download);
        const conns = await s.get<number>("torrentMaxConnections");
        if (typeof conns === "number") setMaxConnections(conns);
      })
      .catch(() => {});
  }, []);

  const applyCache = (bytes: number) => {
    setCacheLimit(bytes);
    Store.load("trace-player-settings.json")
      .then((s) => s.set("torrentCacheLimitBytes", bytes).then(() => s.save()))
      .catch(() => {});
    invoke("set_torrent_cache_limit", { bytes }).catch(() => {});
  };

  const applyUploadLimit = (bytes: number) => {
    setUploadLimit(bytes);
    Store.load("trace-player-settings.json")
      .then((s) => s.set("torrentUploadLimitBytes", bytes).then(() => s.save()))
      .catch(() => {});
    invoke("set_torrent_upload_limit", { bytes }).catch(() => {});
  };

  const applyDownloadLimit = (bytes: number) => {
    setDownloadLimit(bytes);
    Store.load("trace-player-settings.json")
      .then((s) => s.set("torrentDownloadLimitBytes", bytes).then(() => s.save()))
      .catch(() => {});
    invoke("set_torrent_download_limit", { bytes }).catch(() => {});
  };

  const applyMaxConnections = (count: number) => {
    setMaxConnections(count);
    Store.load("trace-player-settings.json")
      .then((s) => s.set("torrentMaxConnections", count).then(() => s.save()))
      .catch(() => {});
    invoke("set_torrent_max_connections", { count }).catch(() => {});
  };

  return (
    <>
      {/* Max disc cache */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Max Disc Cache</div>
        <Select
          aria-label="Max Disc Cache"
          selectedKey={String(cacheLimit)}
          onSelectionChange={(key: Key | null) => {
            if (key != null) {
              const preset = CACHE_PRESETS.find((p) => p.value === String(key));
              if (preset) applyCache(preset.bytes);
            }
          }}
          className="w-full"
        >
          <Select.Trigger className="w-full bg-[var(--np-hover)] hover:bg-[var(--np-active)] rounded-lg px-3 py-2 text-[12px] text-[var(--np-text)] cursor-pointer transition-colors duration-100">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="bg-[var(--np-overlay-heavy)] backdrop-blur-xl rounded-lg shadow-2xl overflow-hidden">
            <ListBox className="p-1 outline-none">
              {CACHE_PRESETS.map((preset) => (
                <ListBox.Item
                  key={preset.value}
                  id={preset.value}
                  className="px-3 py-2 text-[12px] text-[var(--np-text)] rounded-md cursor-pointer outline-none hover:bg-[var(--np-hover)] data-[selected]:bg-[var(--np-selected)] transition-colors duration-100"
                >
                  {preset.label}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <p className="text-[9px] text-[var(--np-text-muted)] mt-2 leading-snug">
          Oldest torrent data is deleted when this limit is exceeded.
        </p>
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      {/* Upload Speed Limit */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Upload Speed Limit</div>
        <Select
          aria-label="Upload Speed Limit"
          selectedKey={String(uploadLimit)}
          onSelectionChange={(key: Key | null) => {
            if (key != null) {
              const preset = UPLOAD_SPEED_PRESETS.find((p) => p.value === String(key));
              if (preset) applyUploadLimit(preset.bytes);
            }
          }}
          className="w-full"
        >
          <Select.Trigger className="w-full bg-[var(--np-hover)] hover:bg-[var(--np-active)] rounded-lg px-3 py-2 text-[12px] text-[var(--np-text)] cursor-pointer transition-colors duration-100">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="bg-[var(--np-overlay-heavy)] backdrop-blur-xl rounded-lg shadow-2xl overflow-hidden">
            <ListBox className="p-1 outline-none">
              {UPLOAD_SPEED_PRESETS.map((preset) => (
                <ListBox.Item
                  key={preset.value}
                  id={preset.value}
                  className="px-3 py-2 text-[12px] text-[var(--np-text)] rounded-md cursor-pointer outline-none hover:bg-[var(--np-hover)] data-[selected]:bg-[var(--np-selected)] transition-colors duration-100"
                >
                  {preset.label}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      {/* Download Speed Limit */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Download Speed Limit</div>
        <Select
          aria-label="Download Speed Limit"
          selectedKey={String(downloadLimit)}
          onSelectionChange={(key: Key | null) => {
            if (key != null) {
              const preset = DOWNLOAD_SPEED_PRESETS.find((p) => p.value === String(key));
              if (preset) applyDownloadLimit(preset.bytes);
            }
          }}
          className="w-full"
        >
          <Select.Trigger className="w-full bg-[var(--np-hover)] hover:bg-[var(--np-active)] rounded-lg px-3 py-2 text-[12px] text-[var(--np-text)] cursor-pointer transition-colors duration-100">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="bg-[var(--np-overlay-heavy)] backdrop-blur-xl rounded-lg shadow-2xl overflow-hidden">
            <ListBox className="p-1 outline-none">
              {DOWNLOAD_SPEED_PRESETS.map((preset) => (
                <ListBox.Item
                  key={preset.value}
                  id={preset.value}
                  className="px-3 py-2 text-[12px] text-[var(--np-text)] rounded-md cursor-pointer outline-none hover:bg-[var(--np-hover)] data-[selected]:bg-[var(--np-selected)] transition-colors duration-100"
                >
                  {preset.label}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      {/* Max Connections */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Max Connections</div>
        <Select
          aria-label="Max Connections"
          selectedKey={String(maxConnections)}
          onSelectionChange={(key: Key | null) => {
            if (key != null) {
              const preset = MAX_CONNECTIONS_PRESETS.find((p) => p.value === String(key));
              if (preset) applyMaxConnections(preset.count);
            }
          }}
          className="w-full"
        >
          <Select.Trigger className="w-full bg-[var(--np-hover)] hover:bg-[var(--np-active)] rounded-lg px-3 py-2 text-[12px] text-[var(--np-text)] cursor-pointer transition-colors duration-100">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="bg-[var(--np-overlay-heavy)] backdrop-blur-xl rounded-lg shadow-2xl overflow-hidden">
            <ListBox className="p-1 outline-none">
              {MAX_CONNECTIONS_PRESETS.map((preset) => (
                <ListBox.Item
                  key={preset.value}
                  id={preset.value}
                  className="px-3 py-2 text-[12px] text-[var(--np-text)] rounded-md cursor-pointer outline-none hover:bg-[var(--np-hover)] data-[selected]:bg-[var(--np-selected)] transition-colors duration-100"
                >
                  {preset.label}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
    </>
  );
}
