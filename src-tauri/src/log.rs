//! Lightweight logging facade for Trace Player's backend.
//!
//! Format: `[NP <elapsed-since-start, ms> <LEVEL> <tag>] <message>`
//!
//! `np_info!`, `np_warn!`, `np_err!`, `np_debug!` write to stderr. We use
//! `eprintln!` rather than the `log` crate so the dev console picks it up
//! without an extra subscriber/setup step.

use std::sync::OnceLock;
use std::time::Instant;

static START: OnceLock<Instant> = OnceLock::new();

/// Milliseconds since process start. The first call seeds the clock.
pub fn elapsed_ms() -> u128 {
    START.get_or_init(Instant::now).elapsed().as_millis()
}

#[macro_export]
macro_rules! np_info {
    ($tag:expr, $($arg:tt)*) => {{
        eprintln!(
            "[NP {:>8}ms INFO {}] {}",
            $crate::log::elapsed_ms(),
            $tag,
            format!($($arg)*)
        );
    }};
}

#[macro_export]
macro_rules! np_warn {
    ($tag:expr, $($arg:tt)*) => {{
        eprintln!(
            "[NP {:>8}ms WARN {}] {}",
            $crate::log::elapsed_ms(),
            $tag,
            format!($($arg)*)
        );
    }};
}

#[macro_export]
macro_rules! np_err {
    ($tag:expr, $($arg:tt)*) => {{
        eprintln!(
            "[NP {:>8}ms ERR  {}] {}",
            $crate::log::elapsed_ms(),
            $tag,
            format!($($arg)*)
        );
    }};
}

#[macro_export]
macro_rules! np_debug {
    ($tag:expr, $($arg:tt)*) => {{
        eprintln!(
            "[NP {:>8}ms DBG  {}] {}",
            $crate::log::elapsed_ms(),
            $tag,
            format!($($arg)*)
        );
    }};
}
