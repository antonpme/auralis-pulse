use serde::Serialize;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct ContextInfo {
    pub session_id: String,
    pub used_tokens: u64,
    pub max_tokens: u64,
    pub pct: f64,
    pub model: String,
    pub output_tokens: u64,
    pub turn_count: u32,
    pub compaction_count: u32,
}

fn find_session_jsonl(session_id: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let projects_dir = home.join(".claude").join("projects");

    if !projects_dir.exists() {
        return None;
    }

    let filename = format!("{}.jsonl", session_id);

    for entry in walkdir(&projects_dir) {
        if let Some(name) = entry.file_name() {
            if name.to_string_lossy() == filename {
                return Some(entry);
            }
        }
    }

    None
}

fn walkdir(dir: &PathBuf) -> Vec<PathBuf> {
    let mut results = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                results.extend(walkdir(&path));
            } else {
                results.push(path);
            }
        }
    }
    results
}

/// Count total compaction boundaries in the ENTIRE file (not just post-compaction).
fn count_compactions(path: &PathBuf) -> u32 {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return 0,
    };
    let reader = BufReader::new(file);
    let mut count = 0u32;
    for line in reader.lines().flatten() {
        if line.contains("\"subtype\":\"compact_boundary\"") {
            count += 1;
        }
    }
    count
}

/// Find the byte offset of the last compact_boundary marker in the file.
fn find_last_compaction_offset(path: &PathBuf) -> Option<u64> {
    let file = std::fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut last_offset: Option<u64> = None;
    let mut current_offset: u64 = 0;

    for line in reader.lines() {
        let line = line.ok()?;
        if line.contains("\"subtype\":\"compact_boundary\"") {
            last_offset = Some(current_offset);
        }
        current_offset += line.len() as u64 + 1;
    }

    last_offset
}

/// Read lines from the file starting after the last compaction boundary.
fn read_post_compaction_lines(path: &PathBuf) -> Vec<String> {
    let offset = find_last_compaction_offset(path);

    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return vec![],
    };

    if let Some(off) = offset {
        let _ = file.seek(SeekFrom::Start(off));
        let reader = BufReader::new(file);
        let mut lines: Vec<String> = reader.lines().flatten().collect();
        if !lines.is_empty() && lines[0].contains("\"subtype\":\"compact_boundary\"") {
            lines.remove(0);
        }
        lines
    } else {
        let reader = BufReader::new(file);
        reader.lines().flatten().collect()
    }
}

/// Parse a raw model string like "claude-opus-4-6-7-20250904" into a display label
/// and max token context. Handles both modern (family-version-date) and legacy
/// (version-family-date, e.g. "claude-3-5-sonnet-20240620") formats.
fn parse_model_string(raw: &str) -> (String, u64) {
    let lower = raw.to_lowercase();
    let family = if lower.contains("opus") {
        "opus"
    } else if lower.contains("sonnet") {
        "sonnet"
    } else if lower.contains("haiku") {
        "haiku"
    } else {
        // Unknown family - show raw (stripped of "claude-" prefix)
        let stripped = raw.strip_prefix("claude-").unwrap_or(raw);
        return (stripped.to_string(), 200_000);
    };

    // Max context per family. Opus 4+ is 1M (beta); earlier Opus were 200K.
    // We pick 1M for opus since modern builds are all 4+. For sonnet/haiku always 200K.
    let max_tokens = if family == "opus" { 1_000_000 } else { 200_000 };

    // Walk the dash-separated parts to extract version numbers.
    let parts: Vec<&str> = raw.split('-').collect();
    let family_idx = parts.iter().position(|p| p.to_lowercase() == family);

    let is_date = |s: &str| s.len() == 8 && s.chars().all(|c| c.is_ascii_digit());
    let is_version = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()) && !is_date(s);

    let mut version_parts: Vec<String> = Vec::new();
    if let Some(fi) = family_idx {
        // Modern format: claude-<family>-<v1>-<v2>-...-<date>
        for p in &parts[fi + 1..] {
            if is_version(p) {
                version_parts.push(p.to_string());
            } else {
                break;
            }
        }
        // Legacy fallback: claude-<v1>-<v2>-<family>-<date>
        if version_parts.is_empty() {
            for p in &parts[..fi] {
                if is_version(p) {
                    version_parts.push(p.to_string());
                }
            }
        }
    }

    let label = if version_parts.is_empty() {
        family.to_string()
    } else {
        format!("{}-{}", family, version_parts.join("-"))
    };

    (label, max_tokens)
}

/// Extract model and max tokens from JSONL lines.
fn detect_model(lines: &[String]) -> (String, u64) {
    for line in lines.iter().rev().take(200) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(model) = val.get("message")
                .and_then(|m| m.get("model"))
                .and_then(|m| m.as_str())
            {
                return parse_model_string(model);
            }
        }
    }
    // No model info found - default to opus 1M (common case)
    ("opus".to_string(), 1_000_000)
}

/// Extract real token usage from the last assistant message's usage fields.
/// Returns (input_total, output_tokens).
fn extract_real_token_usage(lines: &[String]) -> Option<(u64, u64)> {
    for line in lines.iter().rev().take(500) {
        if !line.contains("\"input_tokens\"") {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(usage) = val.get("message").and_then(|m| m.get("usage")) {
                let input = usage.get("input_tokens")
                    .and_then(|t| t.as_u64())
                    .unwrap_or(0);
                let cache_creation = usage.get("cache_creation_input_tokens")
                    .and_then(|t| t.as_u64())
                    .unwrap_or(0);
                let cache_read = usage.get("cache_read_input_tokens")
                    .and_then(|t| t.as_u64())
                    .unwrap_or(0);
                let output = usage.get("output_tokens")
                    .and_then(|t| t.as_u64())
                    .unwrap_or(0);

                let total = input + cache_creation + cache_read;
                if total > 0 {
                    return Some((total, output));
                }
            }
        }
    }
    None
}

/// Count user message turns (approximation of conversation length).
fn count_turns(lines: &[String]) -> u32 {
    let mut count = 0u32;
    for line in lines {
        if line.contains("\"role\":\"user\"") && line.contains("\"type\":\"human\"") {
            count += 1;
        }
    }
    count
}

/// Fallback estimation when no real token data is available.
fn estimate_tokens_fallback(lines: &[String]) -> u64 {
    let mut content_chars: u64 = 0;

    for line in lines {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(content) = val.get("message")
                .and_then(|m| m.get("content"))
            {
                match content {
                    serde_json::Value::String(s) => {
                        content_chars += s.len() as u64;
                    }
                    serde_json::Value::Array(arr) => {
                        for item in arr {
                            if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                content_chars += text.len() as u64;
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    content_chars / 4
}

pub fn get_context(session_id: &str) -> Option<ContextInfo> {
    let jsonl_path = find_session_jsonl(session_id)?;
    let compaction_count = count_compactions(&jsonl_path);
    let lines = read_post_compaction_lines(&jsonl_path);

    if lines.is_empty() {
        return None;
    }

    let (model, max_tokens) = detect_model(&lines);
    let turn_count = count_turns(&lines);

    let (used_tokens, output_tokens) = extract_real_token_usage(&lines)
        .unwrap_or_else(|| (estimate_tokens_fallback(&lines), 0));

    let pct = (used_tokens as f64 / max_tokens as f64 * 100.0).min(100.0);

    Some(ContextInfo {
        session_id: session_id.to_string(),
        used_tokens,
        max_tokens,
        pct,
        model,
        output_tokens,
        turn_count,
        compaction_count,
    })
}
