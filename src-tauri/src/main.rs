// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// mimalloc — the system allocator on Windows is heap-fragmentation-prone and
// adds tens of MB of overhead on libmpv-heavy workloads. mimalloc trims the
// resident set significantly and is faster on multi-thread allocation.
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() {
    // CLI mode: when invoked as `trace-player.exe --thumbnail-gen <video>`,
    // run the headless thumb-extraction path and exit before Tauri spins up.
    // The Windows Shell extension DLL spawns us with this flag on Explorer
    // thumbnail-cache misses.
    if let Some(code) = media_player_lib::handle_cli() {
        std::process::exit(code);
    }
    media_player_lib::run()
}
