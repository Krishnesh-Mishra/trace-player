// Multi-format archive support for the playlist (Slice 3).
//
// Supported formats: .zip, .7z, .rar. Each is read with a different crate
// (zip, sevenz-rust, unrar) — wrapped behind a common `ArchiveBackend` enum
// so the lazy-extract / LRU machinery downstream is format-agnostic.
//
// Lifetime per opened archive:
//   1. `open_archive(path)` → reads the central directory, enumerates video
//      entries, allocates a content-addressed cache directory under
//      %LOCALAPPDATA%\NewPlayer\archive-cache\<key>\, returns a handle.
//   2. The handle's videos list goes into mpv's playlist as deferred paths
//      (in cache_dir/<sanitized>). Only entry 0 is extracted up-front.
//   3. As the playlist advances, `ensure_entry(handle, idx)` extracts on
//      demand. After each extract, an LRU sweep deletes least-recently-used
//      entries that aren't currently bound to mpv.
//
// Active-paths set guards eviction: any path currently used by mpv (the
// playing entry + any prefetched entry) is exempt from LRU. Without this,
// fast playlist navigation on a tight budget would mid-stream-delete files.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use sha1::{Digest, Sha1};

const VIDEO_EXTS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "webm", "m4v", "ts", "flv", "wmv", "mpg", "mpeg", "ogv",
    "3gp", "m2ts", "mts",
];

/// 4 GiB. Tuned later via settings; for v1 a static cap keeps the LRU
/// arithmetic predictable.
const DEFAULT_CACHE_BUDGET_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct ArchiveEntry {
    /// Backend-internal index. For zip this is the central directory
    /// position used by `by_index`; for 7z/rar it's a sequential counter
    /// (those backends look up by name so the value isn't read directly).
    pub idx: usize,
    /// Sanitized path inside the cache directory. Mirrors the archive's
    /// internal directory structure but with `..`/absolute roots removed.
    pub rel_path: PathBuf,
    #[allow(dead_code)]
    pub size: u64,
}

/// Backend dispatch — keeps the rest of the module format-agnostic.
#[derive(Debug)]
enum ArchiveBackend {
    Zip,
    SevenZ,
    Rar,
}

pub struct ArchiveHandle {
    pub source_path: PathBuf,
    backend: ArchiveBackend,
    pub cache_dir: PathBuf,
    /// Video entries we'll surface to the playlist, sorted by filename.
    pub entries: Vec<ArchiveEntry>,
    /// Paths currently bound to mpv (playing or prefetched). LRU eviction
    /// MUST skip anything in here, otherwise a tight cache budget can race
    /// playback and mid-stream-delete the file mpv is reading.
    pub active_paths: Arc<Mutex<std::collections::HashSet<PathBuf>>>,
}


/// Format detection: extension match. zip-bombs disguised as `.mp4` are out
/// of scope — the user is explicitly opening this as an archive.
fn detect_backend(path: &Path) -> Result<ArchiveBackend, String> {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some("zip") => Ok(ArchiveBackend::Zip),
        Some("7z") => Ok(ArchiveBackend::SevenZ),
        Some("rar") => Ok(ArchiveBackend::Rar),
        Some(other) => Err(format!("unsupported archive extension: {other}")),
        None => Err("archive has no file extension".to_string()),
    }
}

/// `%LOCALAPPDATA%\NewPlayer\archive-cache\<sha1[..16]>\` — same convention
/// as torrent-session/. Key includes mtime + size so an archive that gets
/// replaced with a same-named-but-different file invalidates cleanly.
fn cache_dir_for(source: &Path) -> Result<PathBuf, String> {
    let abs = source
        .canonicalize()
        .map_err(|e| format!("canonicalize {}: {e}", source.display()))?;
    let meta = fs::metadata(&abs).map_err(|e| format!("metadata: {e}"))?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let size = meta.len();
    let mut hasher = Sha1::new();
    hasher.update(abs.to_string_lossy().as_bytes());
    hasher.update(b":");
    hasher.update(mtime.to_string().as_bytes());
    hasher.update(b":");
    hasher.update(size.to_string().as_bytes());
    let digest = hex::encode(hasher.finalize());
    let key = &digest[..16];
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    let dir = base.join("NewPlayer").join("archive-cache").join(key);
    fs::create_dir_all(&dir).map_err(|e| format!("create cache dir: {e}"))?;
    Ok(dir)
}

/// Strip absolute/parent components (zip-slip) and reject entries that would
/// escape the cache directory after normalization. Returns None when the
/// entry is dangerous and should be skipped entirely.
fn sanitize_rel_path(name: &str) -> Option<PathBuf> {
    let raw = Path::new(name);
    let mut out = PathBuf::new();
    for comp in raw.components() {
        match comp {
            Component::Normal(s) => {
                let s_str = s.to_string_lossy();
                // Reject alternate data stream names (e.g. "file:stream") on Windows.
                if s_str.contains(':') {
                    return None;
                }
                out.push(s);
            }
            // Drop everything else: prefix (C:\), root (/), CurDir (.),
            // ParentDir (..). This is the canonical zip-slip mitigation.
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        return None;
    }
    Some(out)
}

fn is_video_ext(name: &Path) -> bool {
    name.extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .map(|e| VIDEO_EXTS.contains(&e.as_str()))
        .unwrap_or(false)
}

/// Open an archive: read its central directory (or equivalent), filter to
/// video entries, allocate a cache dir. Does NOT extract anything yet.
///
/// All three underlying crates (zip, sevenz_rust, unrar) can panic on
/// pathologically malformed input (truncated central directory, invalid
/// huffman tables, etc.) — and a panic propagating out of a Tauri command
/// is process-fatal. catch_unwind converts that into a clean error that
/// surfaces as a toast instead of crashing the player.
pub fn open_archive(path: &Path) -> Result<ArchiveHandle, String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| open_archive_inner(path)))
        .unwrap_or_else(|_| {
            Err(format!(
                "archive {} appears corrupted (the parser panicked while reading it).",
                path.display()
            ))
        })
}

fn open_archive_inner(path: &Path) -> Result<ArchiveHandle, String> {
    let backend = detect_backend(path)?;
    let cache_dir = cache_dir_for(path)?;
    let entries = match &backend {
        ArchiveBackend::Zip => list_zip_entries(path)?,
        ArchiveBackend::SevenZ => list_sevenz_entries(path)?,
        ArchiveBackend::Rar => list_rar_entries(path)?,
    };
    if entries.is_empty() {
        return Err("archive contains no playable video files".to_string());
    }
    crate::np_info!(
        "archive",
        "{:?} {} → {} videos in {}",
        backend,
        path.display(),
        entries.len(),
        cache_dir.display()
    );
    Ok(ArchiveHandle {
        source_path: path.to_path_buf(),
        backend,
        cache_dir,
        entries,
        active_paths: Arc::new(Mutex::new(std::collections::HashSet::new())),
    })
}

/// Extract one entry to its destination inside the cache_dir if not already
/// present. Idempotent — second call is a stat() then return. Records
/// last-access by touching the file.
pub fn ensure_entry(handle: &ArchiveHandle, idx: usize) -> Result<PathBuf, String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ensure_entry_inner(handle, idx)))
        .unwrap_or_else(|_| {
            Err(format!(
                "archive entry {idx} could not be extracted (the parser panicked — the \
                 archive is likely corrupted or truncated)."
            ))
        })
}

fn ensure_entry_inner(handle: &ArchiveHandle, idx: usize) -> Result<PathBuf, String> {
    let entry = handle
        .entries
        .get(idx)
        .ok_or_else(|| format!("no archive entry at idx {idx}"))?;
    let dest = handle.cache_dir.join(&entry.rel_path);
    // Guard against symlink-based escapes: after joining, verify the canonical
    // path still lives inside the cache directory.
    let expected_base_dir = handle
        .cache_dir
        .canonicalize()
        .map_err(|e| format!("canonicalize cache_dir: {e}"))?;
    if dest.exists() {
        let canonical = dest
            .canonicalize()
            .map_err(|e| format!("canonicalize dest: {e}"))?;
        if !canonical.starts_with(&expected_base_dir) {
            return Err(format!(
                "archive entry path escapes cache directory: {}",
                dest.display()
            ));
        }
    }
    if dest.is_file() {
        // Touch for LRU. Best-effort; failures don't matter.
        let _ = filetime::set_file_mtime(&dest, filetime::FileTime::now());
        return Ok(dest);
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("create entry parent {}: {e}", parent.display()))?;
    }
    crate::np_info!(
        "archive",
        "extracting idx={idx} (zip-internal {}) → {}",
        entry.idx,
        dest.display()
    );
    match handle.backend {
        // For zip, `entry.idx` is the archive's internal index (set in
        // list_zip_entries before sorting by name), so we look up via
        // by_index. For 7z/rar we have to match by name since neither
        // crate exposes a stable random-access by index API.
        ArchiveBackend::Zip => extract_zip_entry(&handle.source_path, entry.idx, &dest)?,
        ArchiveBackend::SevenZ => extract_sevenz_entry(&handle.source_path, &entry.rel_path, &dest)?,
        ArchiveBackend::Rar => extract_rar_entry(&handle.source_path, &entry.rel_path, &dest)?,
    }
    // Eviction sweep: best-effort. Always after a successful extract so a
    // brand-new file can never get its own LRU timestamp beaten by stale
    // entries.
    if let Err(e) = lru_evict(&handle.cache_dir, &handle.active_paths) {
        crate::np_warn!("archive", "lru evict: {e}");
    }
    Ok(dest)
}

/// Walk the cache dir, sum sizes, evict by oldest mtime until under budget.
/// Skips paths in the active-paths set so we never delete the file mpv is
/// actively reading.
fn lru_evict(
    cache_dir: &Path,
    active: &Arc<Mutex<std::collections::HashSet<PathBuf>>>,
) -> io::Result<()> {
    #[derive(Debug)]
    struct EntryStat {
        path: PathBuf,
        size: u64,
        mtime: SystemTime,
    }

    fn walk(dir: &Path, acc: &mut Vec<EntryStat>) -> io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let meta = entry.metadata()?;
            if meta.is_dir() {
                walk(&path, acc)?;
            } else if meta.is_file() {
                acc.push(EntryStat {
                    path,
                    size: meta.len(),
                    mtime: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                });
            }
        }
        Ok(())
    }

    let mut stats: Vec<EntryStat> = Vec::new();
    walk(cache_dir, &mut stats)?;
    let total: u64 = stats.iter().map(|s| s.size).sum();
    if total <= DEFAULT_CACHE_BUDGET_BYTES {
        return Ok(());
    }
    // Oldest first.
    stats.sort_by_key(|s| s.mtime);
    let active_set = match active.lock() {
        Ok(g) => g.clone(),
        Err(_) => return Ok(()),
    };
    let mut to_free = total - DEFAULT_CACHE_BUDGET_BYTES;
    for s in stats {
        if to_free == 0 {
            break;
        }
        if active_set.contains(&s.path) {
            continue;
        }
        if fs::remove_file(&s.path).is_ok() {
            to_free = to_free.saturating_sub(s.size);
            crate::np_debug!("archive", "lru evicted {}", s.path.display());
        }
    }
    Ok(())
}

// ── ZIP backend ──────────────────────────────────────────────────────────────

fn list_zip_entries(path: &Path) -> Result<Vec<ArchiveEntry>, String> {
    let file = fs::File::open(path).map_err(|e| format!("open zip: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("read zip cd: {e}"))?;
    let mut out: Vec<ArchiveEntry> = Vec::new();
    for i in 0..zip.len() {
        let f = zip.by_index(i).map_err(|e| format!("zip entry {i}: {e}"))?;
        if f.is_dir() {
            continue;
        }
        let name = f.name();
        let rel = match sanitize_rel_path(name) {
            Some(p) => p,
            None => continue,
        };
        if !is_video_ext(&rel) {
            continue;
        }
        out.push(ArchiveEntry { idx: i, rel_path: rel, size: f.size() });
    }
    out.sort_by(|a, b| {
        a.rel_path
            .to_string_lossy()
            .to_ascii_lowercase()
            .cmp(&b.rel_path.to_string_lossy().to_ascii_lowercase())
    });
    // After sort the `idx` no longer matches output order — that's fine,
    // `idx` here is the zip's internal index used by extract_zip_entry. The
    // playlist indexes us by Vec position separately.
    Ok(out)
}

fn extract_zip_entry(source: &Path, idx: usize, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(source).map_err(|e| format!("open zip: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("read zip cd: {e}"))?;
    let mut entry = zip
        .by_index(idx)
        .map_err(|e| format!("zip by_index({idx}): {e}"))?;
    // Atomic write via temp file + rename so a partial write can't be
    // mistaken for a successful cache hit by ensure_entry.
    let tmp = dest.with_extension("part");
    {
        let mut out = fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
        io::copy(&mut entry, &mut out).map_err(|e| format!("zip copy: {e}"))?;
    }
    fs::rename(&tmp, dest).map_err(|e| format!("rename tmp: {e}"))?;
    Ok(())
}

// ── 7z backend ──────────────────────────────────────────────────────────────

fn list_sevenz_entries(path: &Path) -> Result<Vec<ArchiveEntry>, String> {
    // sevenz-rust's `decompress_file` etc. operate on whole archives. To
    // enumerate without extracting we use the lower-level reader.
    use sevenz_rust::SevenZReader;
    let mut reader = SevenZReader::open(path, sevenz_rust::Password::empty())
        .map_err(|e| format!("open 7z: {e}"))?;
    let mut out: Vec<ArchiveEntry> = Vec::new();
    let mut counter: usize = 0;
    reader
        .for_each_entries(|entry, _reader| {
            let idx = counter;
            counter += 1;
            if entry.is_directory() {
                return Ok(true);
            }
            if let Some(rel) = sanitize_rel_path(&entry.name) {
                if is_video_ext(&rel) {
                    out.push(ArchiveEntry {
                        idx,
                        rel_path: rel,
                        size: entry.size,
                    });
                }
            }
            Ok(true)
        })
        .map_err(|e| format!("7z list: {e}"))?;
    out.sort_by(|a, b| {
        a.rel_path
            .to_string_lossy()
            .to_ascii_lowercase()
            .cmp(&b.rel_path.to_string_lossy().to_ascii_lowercase())
    });
    Ok(out)
}

fn extract_sevenz_entry(source: &Path, rel_path: &Path, dest: &Path) -> Result<(), String> {
    use sevenz_rust::SevenZReader;
    // We match by name (sevenz-rust doesn't expose stable indices for
    // single-entry extract). Streams the matched entry to a temp file then
    // renames atomically.
    let target = rel_path.to_string_lossy().replace('\\', "/");
    let mut reader = SevenZReader::open(source, sevenz_rust::Password::empty())
        .map_err(|e| format!("open 7z: {e}"))?;
    let tmp = dest.with_extension("part");
    let tmp_path = tmp.clone();
    let target_string = target.clone();
    let mut hit = false;
    reader
        .for_each_entries(|entry, reader| {
            if entry.is_directory() {
                return Ok(true);
            }
            if entry.name.replace('\\', "/") == target_string {
                let mut out = fs::File::create(&tmp_path)
                    .map_err(|e| sevenz_rust::Error::other(format!("create tmp: {e}")))?;
                io::copy(reader, &mut out)
                    .map_err(|e| sevenz_rust::Error::other(format!("7z copy: {e}")))?;
                hit = true;
                return Ok(false); // stop iterating
            }
            Ok(true)
        })
        .map_err(|e| format!("7z extract: {e}"))?;
    if !hit {
        return Err(format!("7z entry not found: {target}"));
    }
    fs::rename(&tmp, dest).map_err(|e| format!("rename tmp: {e}"))?;
    Ok(())
}

// ── RAR backend ──────────────────────────────────────────────────────────────

fn list_rar_entries(path: &Path) -> Result<Vec<ArchiveEntry>, String> {
    let archive = unrar::Archive::new(path)
        .open_for_listing()
        .map_err(|e| format!("open rar: {e}"))?;
    let mut out: Vec<ArchiveEntry> = Vec::new();
    let mut counter: usize = 0;
    for header in archive {
        let header = header.map_err(|e| format!("rar header: {e}"))?;
        let idx = counter;
        counter += 1;
        if header.is_directory() {
            continue;
        }
        let name_raw = header.filename.to_string_lossy().into_owned();
        let rel = match sanitize_rel_path(&name_raw) {
            Some(p) => p,
            None => continue,
        };
        if !is_video_ext(&rel) {
            continue;
        }
        out.push(ArchiveEntry {
            idx,
            rel_path: rel,
            size: header.unpacked_size,
        });
    }
    out.sort_by(|a, b| {
        a.rel_path
            .to_string_lossy()
            .to_ascii_lowercase()
            .cmp(&b.rel_path.to_string_lossy().to_ascii_lowercase())
    });
    Ok(out)
}

fn extract_rar_entry(source: &Path, rel_path: &Path, dest: &Path) -> Result<(), String> {
    let target = rel_path.to_string_lossy().replace('\\', "/");
    let mut archive = unrar::Archive::new(source)
        .open_for_processing()
        .map_err(|e| format!("open rar: {e}"))?;
    loop {
        let next = archive
            .read_header()
            .map_err(|e| format!("rar header: {e}"))?;
        let header = match next {
            Some(h) => h,
            None => break,
        };
        let name = header.entry().filename.to_string_lossy().replace('\\', "/");
        if name == target {
            let tmp = dest.with_extension("part");
            // unrar's API is a state machine: each header → process / skip
            // call returns the next archive state. We extract straight to
            // tmp then rename atomically so partial writes can't masquerade
            // as cache hits. Match found → done; the leftover state is
            // dropped.
            let _next_state = header
                .extract_to(&tmp)
                .map_err(|e| format!("rar extract: {e}"))?;
            fs::rename(&tmp, dest).map_err(|e| format!("rename tmp: {e}"))?;
            return Ok(());
        }
        archive = header
            .skip()
            .map_err(|e| format!("rar skip: {e}"))?;
    }
    Err(format!("rar entry not found: {target}"))
}

/// Maps cache file paths back to the archive handle they belong to. Used by
/// the events-side hook so we can extract-on-demand when mpv tries to load
/// a cache path that hasn't been extracted yet (manual playlist skip past
/// the prefetch window).
#[derive(Default)]
pub struct ArchiveRegistry {
    /// Keyed by cache_dir; each value is the open handle so we know how to
    /// extract entries for it.
    by_cache_dir: HashMap<PathBuf, Arc<ArchiveHandle>>,
}

impl ArchiveRegistry {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn register(&mut self, handle: Arc<ArchiveHandle>) {
        self.by_cache_dir
            .insert(handle.cache_dir.clone(), handle);
    }
    /// Look up the archive whose cache_dir contains `path`.
    pub fn lookup_by_path(&self, path: &Path) -> Option<Arc<ArchiveHandle>> {
        for (cache, handle) in &self.by_cache_dir {
            if path.starts_with(cache) {
                return Some(handle.clone());
            }
        }
        None
    }
}
