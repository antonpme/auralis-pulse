//! Lightweight file logger.
//!
//! Pulse builds with `windows_subsystem = "windows"` in release, which means
//! eprintln! / println! go nowhere visible. When something silently breaks
//! (server bind failure, panic in spawn, etc.) we have no way to see it.
//!
//! This module writes timestamped lines to `%LOCALAPPDATA%\auralis-pulse\pulse.log`
//! and rolls the file at 1 MB so it never grows unbounded.
//!
//! Use as a sibling to eprintln! at critical points: server bind, MCP startup,
//! threshold-related decisions. Not for hot paths.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

const MAX_LOG_BYTES: u64 = 1_048_576; // 1 MB

fn log_path() -> Option<PathBuf> {
    let base = dirs::data_local_dir()?;
    let dir = base.join("auralis-pulse");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("pulse.log"))
}

/// Write a single timestamped line to pulse.log. Roll the file if over 1 MB
/// by truncating in place (we keep the latest writes; we don't preserve
/// history beyond the rotation point). Best-effort: never panics, never errors
/// up the call stack.
pub fn log(tag: &str, msg: &str) {
    let Some(path) = log_path() else { return };

    // Roll if oversized
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_LOG_BYTES {
            let _ = File::create(&path); // truncate
        }
    }

    let mut file = match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(f) => f,
        Err(_) => return,
    };

    let ts = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
    let _ = writeln!(file, "{} [{}] {}", ts, tag, msg);
}

/// Convenience macro: `pulse_log!("server", "bind failed: {}", err)`.
#[macro_export]
macro_rules! pulse_log {
    ($tag:expr, $($arg:tt)*) => {
        $crate::pulse_log::log($tag, &format!($($arg)*))
    };
}
