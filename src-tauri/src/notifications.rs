use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Token thresholds for context notifications (absolute token counts).
const THRESHOLD_WARNING: u64 = 300_000;
const THRESHOLD_CRITICAL: u64 = 350_000;

/// Whether to auto-trigger compact at the critical threshold.
const AUTO_COMPACT_AT_CRITICAL: bool = false;

/// Discord webhook URL for architect notifications.
/// Override with DISCORD_WEBHOOK_ARCHITECT env var.
fn webhook_url() -> String {
    std::env::var("DISCORD_WEBHOOK_ARCHITECT")
        .unwrap_or_else(|_| "https://discord.com/api/webhooks/PLACEHOLDER".to_string())
}

/// Tracks the last notified threshold per session to avoid repeated notifications.
/// Key: session_id, Value: last threshold that was notified (300_000 or 350_000).
pub struct ThresholdState {
    notified: Mutex<HashMap<String, u64>>,
}

impl ThresholdState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            notified: Mutex::new(HashMap::new()),
        })
    }
}

/// Check a session's token count against thresholds and send notifications if needed.
/// Returns true if a notification was sent.
pub async fn check_and_notify(
    state: &Arc<ThresholdState>,
    session_id: &str,
    session_name: &str,
    used_tokens: u64,
    pid: u32,
) -> bool {
    let mut notified = state.notified.lock().await;
    let last = notified.get(session_id).copied().unwrap_or(0);

    // If tokens dropped below warning (e.g. after compaction), reset state
    if used_tokens < THRESHOLD_WARNING {
        if last > 0 {
            notified.remove(session_id);
        }
        return false;
    }

    // Determine which threshold to notify
    let (threshold, message) = if used_tokens >= THRESHOLD_CRITICAL && last < THRESHOLD_CRITICAL {
        let tokens_k = used_tokens / 1000;
        let msg = format!(
            "**ANIMA Architect** | `{}` | Context: {}K. COMPACT NOW. Crystallize and handoff.",
            session_name, tokens_k,
        );
        (THRESHOLD_CRITICAL, msg)
    } else if used_tokens >= THRESHOLD_WARNING && last < THRESHOLD_WARNING {
        let tokens_k = used_tokens / 1000;
        let msg = format!(
            "**ANIMA Architect** | `{}` | Context: {}K / 350K ceiling. Finish current task, prepare crystallization.",
            session_name, tokens_k,
        );
        (THRESHOLD_WARNING, msg)
    } else {
        return false;
    };

    // Update state before sending (avoid double-send on slow network)
    notified.insert(session_id.to_string(), threshold);
    drop(notified);

    // Send Discord webhook
    send_discord_notification(&message).await;

    // Auto-compact at critical threshold
    if threshold == THRESHOLD_CRITICAL && AUTO_COMPACT_AT_CRITICAL {
        eprintln!("[Pulse] Auto-compact triggered for session {} (pid {})", session_name, pid);
        let _ = crate::compact::trigger_compact(pid);
    }

    true
}

/// Clean up tracking for sessions that are no longer alive.
pub async fn cleanup_stale_sessions(state: &Arc<ThresholdState>, alive_session_ids: &[String]) {
    let mut notified = state.notified.lock().await;
    let stale: Vec<String> = notified
        .keys()
        .filter(|id| !alive_session_ids.contains(id))
        .cloned()
        .collect();
    for id in stale {
        notified.remove(&id);
    }
}

async fn send_discord_notification(message: &str) {
    let url = webhook_url();
    if url.contains("PLACEHOLDER") {
        eprintln!("[Pulse] Context threshold notification (webhook not configured): {}", message);
        return;
    }

    let client = reqwest::Client::new();
    let payload = serde_json::json!({ "content": message });

    match client.post(&url).json(&payload).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                eprintln!("[Pulse] Discord notification sent: {}", message);
            } else {
                eprintln!(
                    "[Pulse] Discord webhook returned {}: {}",
                    resp.status(),
                    resp.text().await.unwrap_or_default()
                );
            }
        }
        Err(e) => {
            eprintln!("[Pulse] Discord webhook error: {}", e);
        }
    }
}
