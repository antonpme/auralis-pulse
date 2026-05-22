//! Pulse-managed user preferences that need to survive reinstalls.
//!
//! Stored at `%LOCALAPPDATA%\auralis-pulse\settings.json`. The NSIS uninstaller
//! does not clean this directory, so values here persist across upgrades.
//!
//! Currently holds just `autostart_pref` (user's "Start with Windows" intent),
//! kept here rather than in the OS registry because the registry can lie:
//! tauri-plugin-autostart compares `current_exe()` to the registered value to
//! determine "enabled" state, and the registered value can be stale (e.g.,
//! when a debug build registered first and the user then switched to a
//! prod build at a different path).
//!
//! Source of truth: the user's recorded intent here. The registry is just the
//! mechanism we (re)write to keep Windows happy.

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct PulseSettings {
    /// Whether the user wants Pulse to launch with Windows. Persisted across
    /// reinstalls in settings.json (the registry value can drift).
    pub autostart_pref: bool,
}

fn settings_path() -> Option<PathBuf> {
    let base = dirs::data_local_dir()?;
    let dir = base.join("auralis-pulse");
    let _ = fs::create_dir_all(&dir);
    Some(dir.join("settings.json"))
}

/// Load settings from disk. Returns defaults on any error (missing file,
/// corrupt JSON, IO failure). Never panics.
pub fn load_settings() -> PulseSettings {
    let Some(p) = settings_path() else {
        return PulseSettings::default();
    };
    let Ok(content) = fs::read_to_string(&p) else {
        return PulseSettings::default();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

/// Persist settings to disk. Best-effort: logs on failure but never errors up.
pub fn save_settings(settings: &PulseSettings) {
    let Some(p) = settings_path() else { return };
    let Ok(json) = serde_json::to_string_pretty(settings) else {
        return;
    };
    if let Err(e) = fs::write(&p, json) {
        crate::pulse_log!("settings", "Failed to write settings.json: {}", e);
    }
}
