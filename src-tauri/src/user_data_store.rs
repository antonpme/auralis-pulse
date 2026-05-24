//! Persistent user data store for things that live in the JS frontend's
//! `localStorage` but also need to be readable from the Rust side (so MCP
//! tools can surface them to external agents).
//!
//! Today this holds presets, custom commands, per-session preset assignments,
//! and per-session auto-compact overrides. The shape is a free-form
//! `serde_json::Value` because:
//!   1. The frontend is the source of truth for the schema
//!   2. New fields can be added by the frontend without a Rust release
//!   3. MCP clients don't need any of this to be strongly typed
//!
//! Path: `%LOCALAPPDATA%\auralis-pulse\user-data.json`
//!
//! The file is rewritten in full on every `sync_user_data` invocation. We
//! tolerate read errors silently and return `{}` so MCP tools degrade
//! gracefully (empty array on `pulse_list_presets`, etc.) until the frontend
//! syncs once.

use serde_json::Value;
use std::{fs, path::PathBuf};

fn user_data_path() -> Result<PathBuf, String> {
    let base = dirs::data_local_dir().ok_or("Cannot find local data dir")?;
    let dir = base.join("auralis-pulse");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("user-data.json"))
}

/// Load persisted user data, or return an empty object on any failure.
/// Empty object means MCP tools return empty arrays for presets/commands,
/// which is the right default before the frontend has booted at least once.
pub fn load_user_data() -> Value {
    match user_data_path() {
        Ok(path) if path.exists() => match fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_else(|e| {
                crate::pulse_log!("user_data", "user-data.json corrupt, defaulting to {{}}: {}", e);
                serde_json::json!({})
            }),
            Err(e) => {
                crate::pulse_log!("user_data", "Failed to read user-data.json: {}", e);
                serde_json::json!({})
            }
        },
        _ => serde_json::json!({}),
    }
}

/// Persist user data to disk. Best-effort: log on failure but never propagate
/// an error (callers shouldn't fail their sync just because disk write hiccupped).
pub fn save_user_data(data: &Value) {
    let path = match user_data_path() {
        Ok(p) => p,
        Err(e) => {
            crate::pulse_log!("user_data", "Cannot resolve user-data.json path: {}", e);
            return;
        }
    };
    let json = match serde_json::to_string_pretty(data) {
        Ok(j) => j,
        Err(e) => {
            crate::pulse_log!("user_data", "Failed to serialize user data: {}", e);
            return;
        }
    };
    if let Err(e) = fs::write(&path, json) {
        crate::pulse_log!("user_data", "Failed to write user-data.json: {}", e);
    }
}
