use axum::{extract::State, http::StatusCode, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequest {
    pub id: String,
    pub session_id: Option<String>,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionResponse {
    pub decision: String, // "allow", "deny", "allow_session"
}

#[derive(Debug, Clone, Serialize)]
pub struct PendingPermission {
    pub request: PermissionRequest,
}

pub struct ServerState {
    pub pending: Mutex<HashMap<String, PendingPermission>>,
    pub response_channels: Mutex<HashMap<String, oneshot::Sender<PermissionResponse>>>,
    pub app_handle: Mutex<Option<tauri::AppHandle>>,
}

impl ServerState {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            response_channels: Mutex::new(HashMap::new()),
            app_handle: Mutex::new(None),
        }
    }
}

pub type SharedState = Arc<ServerState>;

pub fn create_router(state: SharedState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/permission", post(handle_permission))
        .route("/pending", get(list_pending))
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}

async fn list_pending(
    State(state): State<SharedState>,
) -> Json<Vec<PendingPermission>> {
    let pending = state.pending.lock().await;
    Json(pending.values().cloned().collect())
}

async fn handle_permission(
    State(state): State<SharedState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Parse incoming hook data
    let tool_name = body.get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown")
        .to_string();

    let tool_input = body.get("tool_input")
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    let session_id = body.get("session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let id = uuid::Uuid::new_v4().to_string();
    let timestamp = chrono::Utc::now().to_rfc3339();

    let request = PermissionRequest {
        id: id.clone(),
        session_id,
        tool_name: tool_name.clone(),
        tool_input: tool_input.clone(),
        timestamp,
    };

    // Create response channel
    let (tx, rx) = oneshot::channel::<PermissionResponse>();

    // Store pending request
    {
        let mut pending = state.pending.lock().await;
        pending.insert(id.clone(), PendingPermission {
            request: request.clone(),
        });
    }
    {
        let mut channels = state.response_channels.lock().await;
        channels.insert(id.clone(), tx);
    }

    // Notify frontend via Tauri event
    {
        let app = state.app_handle.lock().await;
        if let Some(ref handle) = *app {
            use tauri::Emitter;
            let _ = handle.emit("permission-request", &request);
        }
    }

    // Show notification
    {
        let app = state.app_handle.lock().await;
        if let Some(ref handle) = *app {
            use tauri_plugin_notification::NotificationExt;
            let summary = format_tool_summary(&tool_name, &tool_input);
            let title = format!("Pulse: {}", tool_name);
            match handle.notification()
                .builder()
                .title(&title)
                .body(&summary)
                .show()
            {
                Ok(_) => eprintln!("[Pulse] Notification sent: {}", title),
                Err(e) => {
                    eprintln!("[Pulse] Tauri notification failed: {}. Trying PowerShell fallback.", e);
                    // Fallback: Windows toast via PowerShell
                    let ps_title = title.replace("'", "''");
                    let ps_body = summary.replace("'", "''").chars().take(80).collect::<String>();
                    let ps_cmd = format!(
                        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; \
                         $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); \
                         $text = $xml.GetElementsByTagName('text'); \
                         $text[0].AppendChild($xml.CreateTextNode('{}')) | Out-Null; \
                         $text[1].AppendChild($xml.CreateTextNode('{}')) | Out-Null; \
                         $toast = [Windows.UI.Notifications.ToastNotification]::new($xml); \
                         [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Auralis Pulse').Show($toast)",
                        ps_title, ps_body
                    );
                    let _ = std::process::Command::new("powershell")
                        .args(["-NoProfile", "-Command", &ps_cmd])
                        .spawn();
                }
            }
        }
    }

    // Play notification sound
    {
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", "(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\Windows Notify Calendar.wav').PlaySync()"])
            .spawn();
    }

    // Immediately update tray icon with badge
    {
        let app = state.app_handle.lock().await;
        if let Some(ref handle) = *app {
            if let Some(tray) = handle.tray_by_id("pulse-tray") {
                use tauri::image::Image;
                let icon_pixels = crate::create_tray_icon(0, true);
                let icon = Image::new_owned(icon_pixels, 16, 16);
                let _ = tray.set_icon(Some(icon));
            }
        }
    }

    // Wait for user response. 25s matches the hook timeout so we respond
    // before Claude Code kills the hook process (~30s).
    let response = tokio::time::timeout(
        tokio::time::Duration::from_secs(25),
        rx,
    ).await;

    // Clean up pending + response channel
    {
        let mut pending = state.pending.lock().await;
        pending.remove(&id);
    }
    {
        let mut channels = state.response_channels.lock().await;
        channels.remove(&id);
    }

    // Notify frontend to refresh (remove stale card)
    {
        let app = state.app_handle.lock().await;
        if let Some(ref handle) = *app {
            use tauri::Emitter;
            let _ = handle.emit("permission-request", "resolved");
        }
    }

    match response {
        Ok(Ok(resp)) => {
            // Return decision to hook
            Ok(Json(serde_json::json!({
                "decision": resp.decision,
            })))
        }
        _ => {
            // Timeout or channel error - let CLI handle
            Ok(Json(serde_json::json!({
                "decision": "pass",
            })))
        }
    }
}

fn format_tool_summary(tool_name: &str, input: &serde_json::Value) -> String {
    match tool_name {
        "Bash" => {
            let cmd = input.get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("(unknown command)");
            let short = if cmd.len() > 80 { &cmd[..80] } else { cmd };
            format!("Command: {}", short)
        }
        "Write" | "Edit" => {
            let path = input.get("file_path")
                .and_then(|v| v.as_str())
                .unwrap_or("(unknown file)");
            format!("File: {}", path)
        }
        _ => {
            format!("{}: {:?}", tool_name, input)
                .chars()
                .take(100)
                .collect()
        }
    }
}

/// Clean up stale pending permissions where the channel has been dropped
/// (e.g., CLI handled the permission directly, or the HTTP connection timed out)
pub async fn cleanup_stale_permissions(state: SharedState) {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

        let stale_ids: Vec<String> = {
            let channels = state.response_channels.lock().await;
            let pending = state.pending.lock().await;
            // Find pending IDs that have no corresponding channel (already consumed or dropped)
            pending.keys()
                .filter(|id| !channels.contains_key(*id))
                .cloned()
                .collect()
        };

        if !stale_ids.is_empty() {
            let mut pending = state.pending.lock().await;
            for id in &stale_ids {
                pending.remove(id);
            }
            // Notify frontend to refresh
            let app = state.app_handle.lock().await;
            if let Some(ref handle) = *app {
                use tauri::Emitter;
                let _ = handle.emit("permission-request", "cleanup");
            }
        }
    }
}

pub async fn start_server(state: SharedState) {
    let app = create_router(state);
    // Try binding, if port is busy just log and skip (non-fatal)
    match tokio::net::TcpListener::bind("127.0.0.1:59428").await {
        Ok(listener) => {
            axum::serve(listener, app).await.ok();
        }
        Err(e) => {
            eprintln!("Warning: HTTP server failed to bind :59428 ({}). Permission forwarding disabled.", e);
        }
    }
}
