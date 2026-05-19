// Sidecar lifecycle for `rqbit.exe` — the librqbit reference CLI bundled
// alongside the main exe. Spawned lazily on first magnet/torrent open with
// `--http-api-listen-addr 127.0.0.1:0` so it picks an ephemeral port; the
// port is parsed out of rqbit's first few lines of stdout/stderr. Once
// running we POST magnet/torrent payloads to it and hand mpv the
// per-file streaming URL it returns.
//
// The session stays alive for the rest of the process. Drop kills the child.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub struct StreamingSession {
    child: Child,
    base_url: String,
    http: ureq::Agent,
}

/// Lightweight, cloneable handle to the rqbit HTTP API. Callers can extract
/// this from a locked `StreamingSession`, drop the mutex guard, then perform
/// arbitrarily long HTTP requests without holding the streaming lock.
#[derive(Clone)]
pub struct SessionHandle {
    pub base_url: String,
    pub http: ureq::Agent,
}

// Subset of the JSON response from `POST /torrents`. rqbit may add fields,
// so we accept-and-ignore extras via serde defaults.
#[derive(Deserialize)]
struct TorrentAddResp {
    id: u32,
    #[serde(default)]
    details: TorrentDetails,
}

#[derive(Deserialize, Default)]
struct TorrentDetails {
    #[serde(default)]
    info_hash: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    files: Vec<TorrentFile>,
}

#[derive(Deserialize)]
struct TorrentFile {
    name: String,
    length: u64,
    #[serde(default)]
    #[allow(dead_code)]
    included: bool,
}

/// One playable video inside a torrent. `idx` is the file index inside the
/// torrent (matches rqbit's `/stream/{idx}` path); `stream_url` is the full
/// HTTP URL we hand to mpv.
#[derive(Clone, Debug)]
pub struct VideoFile {
    pub idx: usize,
    #[allow(dead_code)]
    pub name: String,
    #[allow(dead_code)]
    pub length: u64,
    pub stream_url: String,
}

/// Result of adding a magnet/torrent to rqbit. `videos` is sorted by filename
/// so the user's playlist order is stable across runs of the same torrent.
pub struct AddedTorrent {
    pub id: u32,
    pub info_hash: String,
    pub name: String,
    pub videos: Vec<VideoFile>,
}

/// Snapshot of a torrent's live state for the UI overlay. Populated by
/// polling rqbit's `/torrents/<id>/stats/v1` once a second; serialized
/// straight to the frontend as `mpv:torrent-stats`.
///
/// Field shapes are intentionally loose because rqbit's stats schema has
/// shifted between versions — `get_stats` parses defensively and any
/// missing field becomes 0/None rather than failing the whole call.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TorrentStats {
    pub torrent_id: u32,
    pub state: String, // "initializing" | "live" | "paused" | "error"
    pub progress_bytes: u64,
    pub total_bytes: u64,
    pub download_speed_bps: f64,
    pub upload_speed_bps: f64,
    pub peers_live: u32,
    pub peers_queued: u32,
    pub peers_seen: u32,
    pub eta_seconds: Option<u64>,
    /// 0..1 during the initial-checksum phase; None once init completes.
    pub init_progress: Option<f64>,
    pub name: Option<String>,
}

const VIDEO_EXTS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "webm", "m4v", "ts", "flv", "wmv", "mpg", "mpeg", "ogv", "3gp",
    "m2ts", "mts",
];

#[allow(dead_code)]
impl StreamingSession {
    /// Spawn rqbit.exe, wait up to 5 s for it to log its bound port. Output
    /// folder is `%LOCALAPPDATA%\NewPlayer\torrent-session\` — created if
    /// missing.
    ///
    /// `app` is used by the long-running stdout drainer to forward
    /// init-progress events to the frontend (`mpv:rqbit-init-progress`).
    /// rqbit prints `[N] initializing X.YY%` lines once per second during
    /// the initial-checksum phase; we pluck the percentage out and ship it
    /// so the loading overlay shows real progress instead of an
    /// indeterminate spinner.
    pub fn start(rqbit_exe: &Path, session_dir: &Path, app: AppHandle) -> Result<Self, String> {
        if !rqbit_exe.is_file() {
            return Err(format!(
                "rqbit.exe not found at {} — installer should place it in bin/",
                rqbit_exe.display()
            ));
        }
        std::fs::create_dir_all(session_dir).ok();

        // rqbit CLI surface (verified against the bundled binary):
        //   rqbit [GLOBAL OPTIONS] server start [SERVER OPTIONS] <FOLDER>
        //
        // GLOBAL options (before `server`):
        //   --http-api-listen-addr   bind the API on an ephemeral port
        //   --disable-dht-persistence
        //       rqbit otherwise restores the previous DHT UDP port from
        //       %LOCALAPPDATA%\rqbit\dht\cache\dht.json. If a prior rqbit
        //       process didn't fully exit (or the user opened multiple
        //       NewPlayer instances), that port is taken and rqbit dies
        //       with "Only one usage of each socket address (os error
        //       10048)". Disabling persistence lets it pick a fresh port.
        // SERVER-START options (after `start`):
        //   --disable-persistence    don't write torrent session JSON
        let mut cmd = Command::new(rqbit_exe);
        cmd.arg("--http-api-listen-addr")
            .arg("127.0.0.1:0")
            .arg("--disable-dht-persistence")
            // Throttle upload so the player doesn't saturate the user's
            // upstream bandwidth. rqbit's --upload-rate-limit-mibps caps
            // upload to the given MiB/s. 0.5 MiB/s (~4 Mbit/s) is enough
            // to be a good peer without starving the user's connection.
            // TODO: rqbit does not currently support --disable-upload or an
            // upload ratio limit; revisit when rqbit adds those options.
            .arg("--upload-rate-limit-mibps")
            .arg("0.5")
            .arg("server")
            .arg("start")
            .arg("--disable-persistence")
            .arg(session_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| format!("spawn rqbit.exe: {e}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "rqbit stdout pipe missing".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "rqbit stderr pipe missing".to_string())?;

        let (tx, rx) = mpsc::channel::<String>();
        let tx2 = tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().flatten() {
                let _ = tx.send(line);
            }
        });
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().flatten() {
                let _ = tx2.send(line);
            }
        });

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut port: Option<u16> = None;
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match rx.recv_timeout(remaining) {
                Ok(line) => {
                    crate::np_debug!("rqbit", "{line}");
                    if let Some(p) = parse_port_from_line(&line) {
                        port = Some(p);
                        break;
                    }
                }
                Err(_) => break,
            }
        }

        // Drain remaining log lines on a separate thread so the pipes don't
        // back up. rqbit's logging is verbose under load. Same thread
        // doubles as the init-progress source — we plonk the percent value
        // out of `[N] initializing X.YY%` lines and forward it to the
        // frontend so the loading overlay shows real progress.
        let app_for_drain = app.clone();
        std::thread::spawn(move || {
            let mut last_pct: Option<u8> = None;
            while let Ok(line) = rx.recv() {
                if let Some(pct) = parse_init_progress(&line) {
                    // Throttle: only emit on whole-percent change so we
                    // don't fire ~30 events for the same 14% reading.
                    let bucket = (pct * 100.0) as u8;
                    if last_pct != Some(bucket) {
                        last_pct = Some(bucket);
                        let _ = app_for_drain.emit("mpv:rqbit-init-progress", pct);
                    }
                }
                crate::np_debug!("rqbit", "{line}");
            }
        });

        let port = port.ok_or_else(|| {
            "rqbit didn't print a 127.0.0.1:<port> line within 5s — try a fresh build".to_string()
        })?;
        crate::np_info!("rqbit", "HTTP API bound at 127.0.0.1:{port}");

        let http = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout_read(Duration::from_secs(120))
            .build();

        Ok(Self {
            child,
            base_url: format!("http://127.0.0.1:{port}"),
            http,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Clone the ureq agent so callers can perform HTTP requests after
    /// dropping the streaming mutex guard. This avoids holding the lock
    /// across potentially slow network I/O.
    pub fn http_agent(&self) -> ureq::Agent {
        self.http.clone()
    }

    /// Return a lightweight, cloneable handle suitable for performing HTTP
    /// requests without holding the streaming mutex.
    pub fn handle(&self) -> SessionHandle {
        SessionHandle {
            base_url: self.base_url.clone(),
            http: self.http.clone(),
        }
    }

    pub fn add_magnet(&self, uri: &str) -> Result<AddedTorrent, String> {
        self.add_payload(uri.as_bytes(), "text/plain")
    }

    pub fn add_torrent_bytes(&self, bytes: &[u8]) -> Result<AddedTorrent, String> {
        self.add_payload(bytes, "application/octet-stream")
    }

    fn add_payload(&self, body: &[u8], ctype: &str) -> Result<AddedTorrent, String> {
        let url = format!("{}/torrents?overwrite=true", self.base_url);
        // rqbit logs "started HTTP API" a beat before the listener is
        // actually accepting connections. The first POST after spawn often
        // hits a TCP timeout (os error 10060). Retry up to ~3s with a
        // short backoff so the user doesn't see a spurious "Network
        // Error" toast on a perfectly good magnet.
        let mut last_err: String = String::new();
        let mut resp_opt: Option<ureq::Response> = None;
        for attempt in 0..20 {
            match self
                .http
                .post(&url)
                .set("Content-Type", ctype)
                .send_bytes(body)
            {
                Ok(r) => {
                    resp_opt = Some(r);
                    break;
                }
                Err(e) => {
                    last_err = e.to_string();
                    // Only retry on transport-level / connection errors;
                    // a 4xx/5xx from rqbit is a real problem we should
                    // surface immediately.
                    let transient = matches!(&e, ureq::Error::Transport(_));
                    if !transient {
                        return Err(format!("rqbit POST /torrents: {e}"));
                    }
                    if attempt >= 19 {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
            }
        }
        let resp =
            resp_opt.ok_or_else(|| format!("rqbit POST /torrents (after retries): {last_err}"))?;

        // Read the response body in chunks up to the 4 MiB limit. We read
        // incrementally and bail as soon as we exceed the cap, rather than
        // reading the entire response into memory first — a malicious or
        // misbehaving rqbit could otherwise OOM us.
        const MAX_BODY: usize = 4 * 1024 * 1024;
        let body_str = {
            let mut reader = resp.into_reader();
            let mut buf = Vec::with_capacity(8192);
            let mut chunk = [0u8; 8192];
            loop {
                let n = std::io::Read::read(&mut reader, &mut chunk)
                    .map_err(|e| format!("rqbit response read: {e}"))?;
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
                if buf.len() > MAX_BODY {
                    eprintln!(
                        "[streaming] response too large (>{MAX_BODY} bytes), skipping"
                    );
                    return Err(format!(
                        "rqbit response too large (>{MAX_BODY} bytes)"
                    ));
                }
            }
            String::from_utf8(buf)
                .map_err(|e| format!("rqbit response not UTF-8: {e}"))?
        };
        crate::np_debug!("rqbit", "add response: {}", body_str);
        let parsed: TorrentAddResp = serde_json::from_str(&body_str)
            .map_err(|e| format!("rqbit JSON parse: {e} — body: {body_str}"))?;

        let idxs = pick_all_videos(&parsed.details.files);
        if idxs.is_empty() {
            // Distinguish "torrent has only archives" from "torrent has
            // nothing playable at all" — the former is a real format we
            // could in principle support (download the .zip, then run it
            // through open_archive) but don't yet, and the user is more
            // helped by a specific message than a generic one.
            let archive_count = parsed
                .details
                .files
                .iter()
                .filter(|f| {
                    let ext = std::path::Path::new(&f.name)
                        .extension()
                        .and_then(|s| s.to_str())
                        .map(|s| s.to_ascii_lowercase());
                    matches!(ext.as_deref(), Some("zip" | "7z" | "rar"))
                })
                .count();
            if archive_count > 0 {
                return Err(format!(
                    "torrent contains {archive_count} archive(s) (.zip/.7z/.rar) but no \
                     direct video files — archive-streaming over torrent isn't supported yet. \
                     Download the archive first, then open it from disk."
                ));
            }
            return Err(
                "no playable video file found in torrent (expected mp4/mkv/avi/...)".to_string(),
            );
        }
        let videos: Vec<VideoFile> = idxs
            .into_iter()
            .map(|idx| {
                let f = &parsed.details.files[idx];
                VideoFile {
                    idx,
                    name: f.name.clone(),
                    length: f.length,
                    stream_url: format!("{}/torrents/{}/stream/{}", self.base_url, parsed.id, idx),
                }
            })
            .collect();
        let torrent_name = parsed.details.name.unwrap_or_else(|| format!("Torrent #{}", parsed.id));
        Ok(AddedTorrent {
            id: parsed.id,
            info_hash: parsed.details.info_hash,
            name: torrent_name,
            videos,
        })
    }

    /// Mark exactly the listed file indices as "wanted" (rqbit's `included=true`).
    /// Anything not in `idxs` is set to `included=false` and stops downloading.
    /// Used for lazy per-file fetch: only the currently-playing file (and its
    /// near-future neighbours) are wanted at any given time.
    ///
    /// rqbit returns HTTP 500 for this endpoint while the torrent is in its
    /// initial-checksum phase. Init time scales with torrent SIZE (rqbit
    /// SHA1's the whole on-disk allocation): empirically a 9 GiB torrent
    /// takes ~17 s, a 30 GiB pack closer to a minute. The caller uses
    /// success here as the "torrent is ready to stream" gate, so we have
    /// to keep retrying until init actually completes — bailing early
    /// causes mpv to hit 500 on its first loadfile, error out the whole
    /// playlist, and leave the user staring at a transparent window while
    /// rqbit happily downloads in the background.
    ///
    /// Budget: 120 s with progressive backoff (fast at first so a small
    /// torrent doesn't pay full cost, slower once we know we're waiting).
    pub fn set_only_files(&self, id: u32, idxs: &[usize]) -> Result<(), String> {
        let url = format!("{}/torrents/{}/update_only_files", self.base_url, id);
        let body = serde_json::json!({ "only_files": idxs });
        let body_bytes =
            serde_json::to_vec(&body).map_err(|e| format!("set_only_files json: {e}"))?;
        let mut last_status: u16 = 0;
        let deadline = Instant::now() + Duration::from_secs(120);
        let mut delay_ms: u64 = 150;
        let mut attempt: u32 = 0;
        while Instant::now() < deadline {
            attempt += 1;
            match self
                .http
                .post(&url)
                .set("Content-Type", "application/json")
                .send_bytes(&body_bytes)
            {
                Ok(_) => {
                    crate::np_debug!(
                        "rqbit",
                        "torrent {id} only_files={idxs:?} (attempt {attempt})"
                    );
                    return Ok(());
                }
                Err(ureq::Error::Status(code, _)) if code == 500 => {
                    last_status = 500;
                    std::thread::sleep(Duration::from_millis(delay_ms));
                    // Progressive backoff: 150 → 250 → 500 → 1000 ms.
                    // Quick early polls catch small torrents fast; slower
                    // polls keep CPU/log noise down on long initial checks.
                    delay_ms = (delay_ms + 100).min(1000);
                    continue;
                }
                Err(e) => {
                    return Err(format!("rqbit POST update_only_files: {e}"));
                }
            }
        }
        Err(format!(
            "torrent didn't finish initial checksum within 120 s \
             (last rqbit status: {last_status}). Try a smaller / better-seeded torrent, \
             or wait and re-open."
        ))
    }

    /// Snapshot the rqbit stats for one torrent. Parses the JSON loosely so
    /// schema drift between rqbit versions doesn't break the overlay.
    pub fn get_stats(&self, id: u32) -> Result<TorrentStats, String> {
        fetch_stats(&self.http, &self.base_url, id)
    }

    /// Remove a torrent from rqbit's session. Files on disk remain (we keep
    /// the partial download in `torrent-session/` for resume; startup
    /// housekeeping prunes old entries).
    pub fn forget(&self, id: u32) -> Result<(), String> {
        let url = format!("{}/torrents/{}/forget", self.base_url, id);
        self.http
            .post(&url)
            .send_string("")
            .map_err(|e| format!("rqbit POST forget: {e}"))?;
        crate::np_debug!("rqbit", "torrent {id} forgotten");
        Ok(())
    }

    pub fn pause_torrent(&self, id: u32) -> Result<(), String> {
        let url = format!("{}/torrents/{}/pause", self.base_url, id);
        self.http
            .post(&url)
            .send_string("")
            .map_err(|e| format!("rqbit POST pause: {e}"))?;
        Ok(())
    }

    pub fn resume_torrent(&self, id: u32) -> Result<(), String> {
        let url = format!("{}/torrents/{}/start", self.base_url, id);
        self.http
            .post(&url)
            .send_string("")
            .map_err(|e| format!("rqbit POST start: {e}"))?;
        Ok(())
    }
}

impl SessionHandle {
    pub fn add_magnet(&self, uri: &str) -> Result<AddedTorrent, String> {
        self.add_payload(uri.as_bytes(), "text/plain")
    }

    pub fn add_torrent_bytes(&self, bytes: &[u8]) -> Result<AddedTorrent, String> {
        self.add_payload(bytes, "application/octet-stream")
    }

    fn add_payload(&self, body: &[u8], ctype: &str) -> Result<AddedTorrent, String> {
        let url = format!("{}/torrents?overwrite=true", self.base_url);
        let mut last_err: String = String::new();
        let mut resp_opt: Option<ureq::Response> = None;
        for attempt in 0..20 {
            match self
                .http
                .post(&url)
                .set("Content-Type", ctype)
                .send_bytes(body)
            {
                Ok(r) => {
                    resp_opt = Some(r);
                    break;
                }
                Err(e) => {
                    last_err = e.to_string();
                    let transient = matches!(&e, ureq::Error::Transport(_));
                    if !transient {
                        return Err(format!("rqbit POST /torrents: {e}"));
                    }
                    if attempt >= 19 {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
            }
        }
        let resp =
            resp_opt.ok_or_else(|| format!("rqbit POST /torrents (after retries): {last_err}"))?;

        const MAX_BODY: usize = 4 * 1024 * 1024;
        let body_str = {
            let mut reader = resp.into_reader();
            let mut buf = Vec::with_capacity(8192);
            let mut chunk = [0u8; 8192];
            loop {
                let n = std::io::Read::read(&mut reader, &mut chunk)
                    .map_err(|e| format!("rqbit response read: {e}"))?;
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
                if buf.len() > MAX_BODY {
                    return Err(format!("rqbit response too large (>{MAX_BODY} bytes)"));
                }
            }
            String::from_utf8(buf)
                .map_err(|e| format!("rqbit response not UTF-8: {e}"))?
        };
        crate::np_debug!("rqbit", "add response: {}", body_str);
        let parsed: TorrentAddResp = serde_json::from_str(&body_str)
            .map_err(|e| format!("rqbit JSON parse: {e} — body: {body_str}"))?;

        let idxs = pick_all_videos(&parsed.details.files);
        if idxs.is_empty() {
            let archive_count = parsed
                .details
                .files
                .iter()
                .filter(|f| {
                    let ext = std::path::Path::new(&f.name)
                        .extension()
                        .and_then(|s| s.to_str())
                        .map(|s| s.to_ascii_lowercase());
                    matches!(ext.as_deref(), Some("zip" | "7z" | "rar"))
                })
                .count();
            if archive_count > 0 {
                return Err(format!(
                    "torrent contains {archive_count} archive(s) (.zip/.7z/.rar) but no \
                     direct video files — archive-streaming over torrent isn't supported yet. \
                     Download the archive first, then open it from disk."
                ));
            }
            return Err(
                "no playable video file found in torrent (expected mp4/mkv/avi/...)".to_string(),
            );
        }
        let videos: Vec<VideoFile> = idxs
            .into_iter()
            .map(|idx| {
                let f = &parsed.details.files[idx];
                VideoFile {
                    idx,
                    name: f.name.clone(),
                    length: f.length,
                    stream_url: format!("{}/torrents/{}/stream/{}", self.base_url, parsed.id, idx),
                }
            })
            .collect();
        let torrent_name = parsed.details.name.unwrap_or_else(|| format!("Torrent #{}", parsed.id));
        Ok(AddedTorrent {
            id: parsed.id,
            info_hash: parsed.details.info_hash,
            name: torrent_name,
            videos,
        })
    }

    pub fn set_only_files(&self, id: u32, idxs: &[usize]) -> Result<(), String> {
        let url = format!("{}/torrents/{}/update_only_files", self.base_url, id);
        let body = serde_json::json!({ "only_files": idxs });
        let body_bytes =
            serde_json::to_vec(&body).map_err(|e| format!("set_only_files json: {e}"))?;
        let mut last_status: u16 = 0;
        let deadline = Instant::now() + Duration::from_secs(120);
        let mut delay_ms: u64 = 150;
        let mut attempt: u32 = 0;
        while Instant::now() < deadline {
            attempt += 1;
            match self
                .http
                .post(&url)
                .set("Content-Type", "application/json")
                .send_bytes(&body_bytes)
            {
                Ok(_) => {
                    crate::np_debug!(
                        "rqbit",
                        "torrent {id} only_files={idxs:?} (attempt {attempt})"
                    );
                    return Ok(());
                }
                Err(ureq::Error::Status(code, _)) if code == 500 => {
                    last_status = 500;
                    std::thread::sleep(Duration::from_millis(delay_ms));
                    delay_ms = (delay_ms + 100).min(1000);
                    continue;
                }
                Err(e) => {
                    return Err(format!("rqbit POST update_only_files: {e}"));
                }
            }
        }
        Err(format!(
            "torrent didn't finish initial checksum within 120 s \
             (last rqbit status: {last_status}). Try a smaller / better-seeded torrent, \
             or wait and re-open."
        ))
    }

    pub fn forget(&self, id: u32) -> Result<(), String> {
        let url = format!("{}/torrents/{}/forget", self.base_url, id);
        self.http
            .post(&url)
            .send_string("")
            .map_err(|e| format!("rqbit POST forget: {e}"))?;
        crate::np_debug!("rqbit", "torrent {id} forgotten");
        Ok(())
    }

    pub fn get_stats(&self, id: u32) -> Result<TorrentStats, String> {
        fetch_stats(&self.http, &self.base_url, id)
    }
}

/// Standalone stats fetch usable without holding the `StreamingSession` mutex.
/// Callers clone the `http` agent and `base_url` out of the guard, drop it,
/// then call this function so the HTTP GET runs lock-free.
pub fn fetch_stats(http: &ureq::Agent, base_url: &str, id: u32) -> Result<TorrentStats, String> {
    let url = format!("{}/torrents/{}/stats/v1", base_url, id);
    let resp = http
        .get(&url)
        .call()
        .map_err(|e| format!("rqbit GET stats: {e}"))?;
    let body = resp
        .into_string()
        .map_err(|e| format!("rqbit stats body: {e}"))?;
    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("rqbit stats json: {e}"))?;

    let u64_at = |paths: &[&str]| -> u64 {
        for p in paths {
            if let Some(n) = v.pointer(p).and_then(|n| n.as_u64()) {
                return n;
            }
        }
        0
    };
    let f64_at = |paths: &[&str]| -> f64 {
        for p in paths {
            if let Some(n) = v.pointer(p).and_then(|n| n.as_f64()) {
                return n;
            }
        }
        0.0
    };

    let state = v
        .get("state")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    let progress_bytes = u64_at(&[
        "/snapshot/have_bytes",
        "/snapshot/downloaded_and_checked_bytes",
        "/live/snapshot/have_bytes",
        "/live/snapshot/downloaded_and_checked_bytes",
        "/progress_bytes",
    ]);
    let total_bytes = u64_at(&["/snapshot/total_bytes", "/total_bytes"]);
    let download_speed_bps = {
        let mbps = f64_at(&["/download_speed/mbps", "/live/download_speed/mbps"]);
        if mbps > 0.0 {
            mbps * 1024.0 * 1024.0
        } else {
            f64_at(&["/download_speed/bps", "/live/download_speed/bps"])
        }
    };
    let upload_speed_bps = {
        let mbps = f64_at(&["/upload_speed/mbps", "/live/upload_speed/mbps"]);
        if mbps > 0.0 {
            mbps * 1024.0 * 1024.0
        } else {
            f64_at(&["/upload_speed/bps", "/live/upload_speed/bps"])
        }
    };
    let peers_live = u64_at(&["/live/snapshot/peer_stats/live", "/live/peers/live"]) as u32;
    let peers_queued =
        u64_at(&["/live/snapshot/peer_stats/queued", "/live/peers/queued"]) as u32;
    let peers_seen = u64_at(&["/live/snapshot/peer_stats/seen", "/live/peers/seen"]) as u32;
    let eta_seconds = v
        .pointer("/time_remaining/duration/secs")
        .and_then(|n| n.as_u64());
    let init_progress = if state == "initializing" {
        v.pointer("/initialization_progress")
            .and_then(|n| n.as_f64())
    } else {
        None
    };
    let name = v
        .get("name")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());

    Ok(TorrentStats {
        torrent_id: id,
        state,
        progress_bytes,
        total_bytes,
        download_speed_bps,
        upload_speed_bps,
        peers_live,
        peers_queued,
        peers_seen,
        eta_seconds,
        init_progress,
        name,
    })
}

impl Drop for StreamingSession {
    fn drop(&mut self) {
        let _ = self.child.kill();
        // Give the child 3 seconds to exit cleanly before we give up.
        use std::time::Instant;
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => break, // exited
                Ok(None) => {
                    if Instant::now() >= deadline {
                        eprintln!("[streaming] rqbit did not exit in 3s, abandoning");
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => {
                    eprintln!("[streaming] rqbit wait error: {e}");
                    break;
                }
            }
        }
        crate::np_info!("rqbit", "sidecar terminated");
    }
}

/// Return all video-file indices in the torrent, sorted by filename
/// (case-insensitive). The sort is what makes a series-pack land in episode
/// order regardless of how the original creator ordered the manifest.
fn pick_all_videos(files: &[TorrentFile]) -> Vec<usize> {
    let mut idxs: Vec<usize> = files
        .iter()
        .enumerate()
        .filter(|(_, f)| {
            let ext = std::path::Path::new(&f.name)
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase());
            ext.map(|e| VIDEO_EXTS.contains(&e.as_str()))
                .unwrap_or(false)
        })
        .map(|(i, _)| i)
        .collect();
    idxs.sort_by(|&a, &b| {
        files[a]
            .name
            .to_ascii_lowercase()
            .cmp(&files[b].name.to_ascii_lowercase())
    });
    idxs
}

/// Parse rqbit's "[N] initializing X.XX%" stdout into a 0..1 progress.
/// Returns None for any line that doesn't match — including the
/// post-init `[0]: 0.16% (4.00Mi / ...)` lines, which use a different
/// shape (no "initializing" word) so we won't accidentally treat the
/// download progress as init progress.
fn parse_init_progress(line: &str) -> Option<f32> {
    let needle = "] initializing ";
    let i = line.find(needle)?;
    let rest = &line[i + needle.len()..];
    let pct_end = rest.find('%')?;
    let pct: f32 = rest[..pct_end].parse().ok()?;
    Some((pct / 100.0).clamp(0.0, 1.0))
}

/// Try to parse a torrent stream URL (e.g.
/// `http://127.0.0.1:46211/torrents/0/stream/3`) into `(torrent_id, file_idx)`.
/// Returns `None` for any non-torrent URL (file paths, http(s) streams, etc.).
pub fn parse_stream_url(url: &str) -> Option<(u32, usize)> {
    let after_scheme = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    if !after_scheme.starts_with("127.0.0.1:") {
        return None;
    }
    let path = after_scheme.split_once('/').map(|(_, p)| p)?;
    // Expected: torrents/<id>/stream/<idx>[?...] → 4 segments.
    let mut parts = path.split(['/', '?']);
    if parts.next()? != "torrents" {
        return None;
    }
    let id: u32 = parts.next()?.parse().ok()?;
    if parts.next()? != "stream" {
        return None;
    }
    let idx: usize = parts.next()?.parse().ok()?;
    Some((id, idx))
}

/// Find the first `127.0.0.1:<port>` token in a log line. rqbit logs e.g.
/// `starting HTTP API at http://127.0.0.1:46211` — this pulls 46211 out.
fn parse_port_from_line(line: &str) -> Option<u16> {
    let needle = "127.0.0.1:";
    let i = line.find(needle)?;
    let rest = &line[i + needle.len()..];
    let port_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if port_str.is_empty() {
        return None;
    }
    port_str.parse().ok()
}

/// Resolve rqbit.exe shipped by the installer. Multi-candidate so the
/// same code works for production NSIS installs, Tauri's resource layout,
/// and `cargo tauri dev` from the source tree.
pub fn locate_rqbit() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    const NAME: &str = "rqbit.exe";
    #[cfg(not(target_os = "windows"))]
    const NAME: &str = "rqbit";
    crate::find_bundled_binary(NAME)
}

/// `%LOCALAPPDATA%\NewPlayer\torrent-session\` (created on demand). Falls
/// back to a temp dir if the env var is missing — shouldn't happen on
/// Windows but keeps the code total in dev/CI.
pub fn session_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    let dir = base.join("NewPlayer").join("torrent-session");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Delete the oldest top-level entries from the torrent session directory until
/// the total occupied space is at or below `limit_bytes`. Intended to be
/// called on a background thread after sources are dropped so rqbit is no
/// longer writing to those paths.
pub fn run_cache_eviction(limit_bytes: u64) {
    if limit_bytes == 0 {
        return;
    }
    let dir = session_dir();
    let read = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(e) => {
            crate::np_warn!("cache", "eviction: can't read session dir: {e}");
            return;
        }
    };
    let mut entries: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let mut total: u64 = 0;
    for entry in read.flatten() {
        let path = entry.path();
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let size = if meta.is_dir() {
            dir_size_recursive(&path)
        } else {
            meta.len()
        };
        total += size;
        entries.push((path, size, mtime));
    }
    if total <= limit_bytes {
        return;
    }
    entries.sort_by_key(|(_, _, mtime)| *mtime);
    for (path, size, _) in &entries {
        if total <= limit_bytes {
            break;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("?")
            .to_string();
        let removed = if path.is_dir() {
            std::fs::remove_dir_all(path).is_ok()
        } else {
            std::fs::remove_file(path).is_ok()
        };
        if removed {
            total = total.saturating_sub(*size);
            crate::np_info!("cache", "evicted {} ({} MiB freed)", name, size / 1_048_576);
        }
    }
    crate::np_info!(
        "cache",
        "after eviction: {} MiB in session dir",
        total / 1_048_576
    );
}

fn dir_size_recursive(dir: &Path) -> u64 {
    let Ok(read) = std::fs::read_dir(dir) else {
        return 0;
    };
    read.flatten()
        .map(|e| {
            let p = e.path();
            if p.is_dir() {
                dir_size_recursive(&p)
            } else {
                e.metadata().map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}
