// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// mimalloc — the system allocator on Windows is heap-fragmentation-prone and
// adds tens of MB of overhead on libmpv-heavy workloads. mimalloc trims the
// resident set significantly and is faster on multi-thread allocation.
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() {
    media_player_lib::run()
}
