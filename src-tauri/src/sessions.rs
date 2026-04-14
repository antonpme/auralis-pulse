use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use sysinfo::System;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub pid: u32,
    pub session_id: String,
    pub cwd: String,
    pub started_at: u64,
    pub alive: bool,
    pub name: String,
    pub duration_mins: u64,
}

#[derive(Debug, Deserialize)]
struct SessionFile {
    pid: u32,
    #[serde(rename = "sessionId")]
    session_id: String,
    cwd: String,
    #[serde(rename = "startedAt")]
    started_at: u64,
    name: Option<String>,
    entrypoint: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SessionsIndex {
    entries: Vec<SessionsIndexEntry>,
}

#[derive(Debug, Deserialize)]
struct SessionsIndexEntry {
    #[serde(rename = "sessionId")]
    session_id: String,
    summary: Option<String>,
}

/// JSONL first line with custom title
#[derive(Debug, Deserialize)]
struct CustomTitleLine {
    #[serde(rename = "type")]
    line_type: Option<String>,
    #[serde(rename = "customTitle")]
    custom_title: Option<String>,
}

fn sessions_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let dir = home.join(".claude").join("sessions");
    if dir.exists() { Some(dir) } else { None }
}

fn cwd_to_project_dir(cwd: &str) -> String {
    // Convert cwd like "E:\" to project dir name "E--"
    // E:\ -> E-- ; E:\foo\ -> E--foo (trim trailing dash except for root)
    let raw = cwd.replace(":", "-").replace("\\", "-").replace("/", "-");
    let trimmed = raw.trim_end_matches('-').to_string();
    // For root drives like "E:\" the trimmed would be "E" but dir is "E--"
    // Check if trimmed version exists, else try raw
    trimmed
}

/// Try to get session name from JSONL customTitle (first line)
fn read_custom_title(session_id: &str, cwd: &str) -> Option<String> {
    let home = dirs::home_dir()?;
    let projects_base = home.join(".claude").join("projects");
    let jsonl_name = format!("{}.jsonl", session_id);

    // Try exact cwd_to_project_dir mapping
    let project_dir_name = cwd_to_project_dir(cwd);
    let mut jsonl_path = projects_base.join(&project_dir_name).join(&jsonl_name);

    // If not found, scan all project dirs for this session
    if !jsonl_path.exists() {
        let mut found = false;
        if let Ok(entries) = std::fs::read_dir(&projects_base) {
            for entry in entries.flatten() {
                let candidate = entry.path().join(&jsonl_name);
                if candidate.exists() {
                    jsonl_path = candidate;
                    found = true;
                    break;
                }
            }
        }
        if !found {
            return None;
        }
    }

    // Read first few lines looking for custom-title
    let file = std::fs::File::open(&jsonl_path).ok()?;
    let reader = std::io::BufReader::new(file);
    use std::io::BufRead;
    for line in reader.lines().take(5).flatten() {
        if let Ok(parsed) = serde_json::from_str::<CustomTitleLine>(&line) {
            if parsed.line_type.as_deref() == Some("custom-title") {
                if let Some(title) = parsed.custom_title {
                    if !title.is_empty() {
                        return Some(title);
                    }
                }
            }
        }
    }

    None
}

/// Build a map of sessionId -> name from all sessions-index.json files
fn load_session_names() -> HashMap<String, String> {
    let mut names = HashMap::new();
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return names,
    };
    let projects_dir = home.join(".claude").join("projects");
    if !projects_dir.exists() {
        return names;
    }

    if let Ok(entries) = std::fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            let idx_path = entry.path().join("sessions-index.json");
            if idx_path.exists() {
                if let Ok(content) = std::fs::read_to_string(&idx_path) {
                    if let Ok(index) = serde_json::from_str::<SessionsIndex>(&content) {
                        for e in index.entries {
                            if let Some(summary) = e.summary {
                                if !summary.is_empty() && summary != "No prompt" {
                                    names.insert(e.session_id, summary);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    names
}

fn short_path(cwd: &str, entrypoint: Option<&str>) -> String {
    let path = std::path::Path::new(cwd);
    match path.file_name() {
        Some(name) => name.to_string_lossy().to_string(),
        None => {
            // Root drive like "E:\" - add entrypoint context
            let drive = cwd.chars().take(2).collect::<String>(); // "E:"
            match entrypoint {
                Some("claude-desktop") => format!("Desktop ({})", drive),
                Some("cli") => format!("CLI ({})", drive),
                Some(ep) => format!("{} ({})", ep, drive),
                None => format!("{}", drive),
            }
        }
    }
}

pub fn list_sessions() -> Vec<SessionInfo> {
    let dir = match sessions_dir() {
        Some(d) => d,
        None => return vec![],
    };

    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let session_names = load_session_names();
    let mut sessions = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(sf) = serde_json::from_str::<SessionFile>(&content) {
                        let pid = sysinfo::Pid::from_u32(sf.pid);
                        let alive = sys.process(pid)
                            .map(|p| {
                                let pname = p.name().to_string_lossy().to_lowercase();
                                pname.contains("node") || pname.contains("claude")
                            })
                            .unwrap_or(false);

                        let now_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;
                        let duration_mins = if now_ms > sf.started_at {
                            (now_ms - sf.started_at) / 60000
                        } else {
                            0
                        };

                        // Priority: 0) session file name, 1) sessions-index summary, 2) JSONL customTitle, 3) path+entrypoint
                        let name = sf.name
                            .filter(|n| !n.is_empty())
                            .or_else(|| session_names.get(&sf.session_id).cloned())
                            .or_else(|| read_custom_title(&sf.session_id, &sf.cwd))
                            .unwrap_or_else(|| short_path(&sf.cwd, sf.entrypoint.as_deref()));

                        sessions.push(SessionInfo {
                            pid: sf.pid,
                            session_id: sf.session_id,
                            cwd: sf.cwd,
                            started_at: sf.started_at,
                            alive,
                            name,
                            duration_mins,
                        });
                    }
                }
            }
        }
    }

    sessions.retain(|s| s.alive);
    sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    sessions
}
