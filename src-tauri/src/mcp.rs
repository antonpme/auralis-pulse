//! Auralis Pulse MCP server.
//!
//! Exposes Pulse's state and actions to MCP clients (Claude Code, Claude Desktop,
//! Cursor, etc.) over Streamable HTTP transport on **its own dedicated port**
//! (default 59429), independent of the permission-forwarding server on 59428.
//!
//! Why a separate port: nesting MCP under the same axum Router as the permission
//! routes caused the whole HTTP server to silently fail to bind in v1.4.0-dev
//! Phase 1. Splitting concerns by port avoids any future router interaction
//! surprises and lets either subsystem fail independently of the other.
//!
//! Phase 1 shipped `pulse_ping` + the config/persistence layer.
//! Phase 2 (this revision) adds five read-only tools:
//!   - `pulse_list_sessions`
//!   - `pulse_get_session`
//!   - `pulse_get_usage`
//!   - `pulse_list_presets`
//!   - `pulse_list_commands`
//!
//! State is injected via `Arc<PulseMcpState>` so the MCP server can read from
//! the same `usage` mutex Tauri commands use, and from a `user_data` mutex
//! populated by the frontend through the `sync_user_data` Tauri command.
//!
//! Token + port are persisted to `%LOCALAPPDATA%\auralis-pulse\mcp.json` on
//! first launch so the user can wire a client with one command:
//!
//! ```text
//! claude mcp add --transport http auralis-pulse http://127.0.0.1:59429/mcp \
//!   --header "Authorization: Bearer <token>"
//! ```

use rand::RngCore;
use rmcp::{
    handler::server::{
        router::tool::ToolRouter,
        wrapper::Parameters,
    },
    model::{ErrorData, Implementation, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, tower::StreamableHttpService,
    },
    ServerHandler,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{fs, path::PathBuf, sync::Arc};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tower_http::validate_request::ValidateRequestHeaderLayer;

/// Default port for the MCP server. Distinct from the permission server (59428)
/// to keep the two subsystems independent.
pub const DEFAULT_MCP_PORT: u16 = 59429;

// ============================================================================
// Config: port + bearer token, persisted to disk so client config can reference.
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfig {
    pub port: u16,
    pub token: String,
    pub url: String,
}

impl McpConfig {
    fn config_path() -> Result<PathBuf, String> {
        let base = dirs::data_local_dir().ok_or("Cannot find local data dir")?;
        let dir = base.join("auralis-pulse");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir.join("mcp.json"))
    }

    /// Load existing config from disk, or generate + persist a new one.
    /// Migration: configs with the legacy port (59428, shared with permission
    /// server) are regenerated on the current DEFAULT_MCP_PORT.
    pub fn load_or_generate() -> Result<Self, String> {
        let path = Self::config_path()?;
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read mcp.json: {}", e))?;
            if let Ok(cfg) = serde_json::from_str::<McpConfig>(&content) {
                if cfg.port == DEFAULT_MCP_PORT {
                    return Ok(cfg);
                }
                // Legacy port (most likely 59428 from v1.4.0-dev Phase 1): migrate.
                crate::pulse_log!(
                    "mcp",
                    "Migrating mcp.json from legacy port {} to {}",
                    cfg.port,
                    DEFAULT_MCP_PORT
                );
            } else {
                crate::pulse_log!("mcp", "mcp.json was corrupt, regenerating");
            }
        }

        let port = DEFAULT_MCP_PORT;
        let token = generate_token();
        let url = format!("http://127.0.0.1:{}/mcp", port);
        let cfg = McpConfig { port, token, url };

        let json = serde_json::to_string_pretty(&cfg)
            .map_err(|e| format!("Failed to serialize mcp.json: {}", e))?;
        fs::write(&path, json)
            .map_err(|e| format!("Failed to write mcp.json: {}", e))?;
        Ok(cfg)
    }
}

/// Generate a 32-byte cryptographically random hex token (64 hex chars).
fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

// ============================================================================
// State injected into the MCP server.
//
// Both fields are `Arc<Mutex<>>` so the same backing store is shared with the
// rest of the Tauri app:
//   - `usage` is shared with `UsageState` (read by Tauri command `get_usage`,
//     written by the periodic refresh loop and `refresh_usage`).
//   - `user_data` is shared with `UserDataState` and is written by the Tauri
//     command `sync_user_data` every time the frontend mutates presets,
//     custom commands, session preset assignments, or auto-compact overrides.
// ============================================================================

pub struct PulseMcpState {
    pub usage: Arc<Mutex<Option<serde_json::Value>>>,
    pub user_data: Arc<Mutex<serde_json::Value>>,
    /// Tauri handle so write tools can emit events back to the frontend
    /// (e.g. `mcp-assign-preset` triggers the JS layer to update its in-memory
    /// `settings.sessionPresets`, persist to localStorage, and sync back to
    /// Rust). Without this, MCP-side writes to user-managed state would
    /// silently lose the next time the frontend ran `sync_user_data`.
    pub app_handle: AppHandle,
}

// ============================================================================
// MCP service: the actual server handler with tools.
// ============================================================================

#[derive(Clone)]
pub struct PulseMcp {
    state: Arc<PulseMcpState>,
    // Filled by the `#[tool_router]` macro on impl, consumed by `#[tool_handler]`
    // on ServerHandler. The macro layer reads it through a Deref trick that
    // rustc's dead-code pass doesn't see, hence the explicit allow.
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

/// Parameters for `pulse_get_session`. Lives at module scope (not inside the
/// impl) because `#[derive(JsonSchema)]` requires a top-level item.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetSessionParams {
    /// Session ID as reported by `pulse_list_sessions` (e.g. a UUID string).
    pub session_id: String,
}

/// Parameters for `pulse_send_command`.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct SendCommandParams {
    /// Process ID of the target Claude Code session, as reported by
    /// `pulse_list_sessions`.
    pub pid: u32,
    /// Text to inject. Slash command (`/compact`, `/cost`) or natural-language
    /// message. Multi-line is OK; Pulse uses bracketed-paste mode for safe
    /// submission through Ink/React TUI input handlers.
    pub text: String,
}

/// Parameters for `pulse_assign_preset`.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct AssignPresetParams {
    /// Session ID to (re)assign, as reported by `pulse_list_sessions`.
    pub session_id: String,
    /// Preset ID to assign, as reported by `pulse_list_presets`. Validated
    /// against the live preset library; unknown ids are rejected with an
    /// MCP error.
    pub preset_id: String,
}

#[tool_router]
impl PulseMcp {
    pub fn new(state: Arc<PulseMcpState>) -> Self {
        Self {
            state,
            tool_router: Self::tool_router(),
        }
    }

    /// Health check tool. Confirms the MCP server is reachable and the bearer
    /// token was accepted. Returns the literal string "pong" plus Pulse version.
    #[tool(
        name = "pulse_ping",
        description = "Health check. Returns 'pong' plus Pulse version if Pulse is reachable and the auth token is accepted."
    )]
    pub async fn pulse_ping(&self) -> String {
        format!("pong (auralis-pulse v{})", env!("CARGO_PKG_VERSION"))
    }

    // ------------------------------------------------------------------------
    // Phase 2 read tools.
    //
    // Bisect 2026-05-24 found that returning `rmcp::Json<T>` from a tool causes
    // a runtime fault in rmcp 1.7's output-schema generation path (schemars 1.x
    // version mismatch behavior). The server silently drops the request mid
    // response so the MCP client reports "Failed to connect" / "empty reply".
    //
    // Workaround: return JSON-stringified `String`. The MCP client gets the
    // payload as a text block and parses it once. Slightly less ergonomic for
    // typed clients, fully functional for everyone. Revisit if/when rmcp +
    // schemars compatibility is verified for typed returns.
    // ------------------------------------------------------------------------

    fn json_string<T: Serialize>(value: &T) -> String {
        serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
    }

    /// List every alive Claude Code session Pulse is currently tracking.
    /// Mirrors what the session list in the Pulse window shows.
    #[tool(
        name = "pulse_list_sessions",
        description = "List all alive Claude Code sessions Pulse is currently tracking. Returns a JSON array string; each entry has pid, session_id, cwd, name, started_at, duration_mins, last_activity_mins, status (active/idle/ghost), alive."
    )]
    pub async fn pulse_list_sessions(&self) -> String {
        Self::json_string(&crate::sessions::list_sessions())
    }

    /// Look up one session by its `session_id`. Returns an MCP error if no
    /// alive session matches.
    #[tool(
        name = "pulse_get_session",
        description = "Get full details for one session by its session_id. Returns a JSON object string. Errors if no alive session matches."
    )]
    pub async fn pulse_get_session(
        &self,
        Parameters(GetSessionParams { session_id }): Parameters<GetSessionParams>,
    ) -> Result<String, ErrorData> {
        crate::sessions::list_sessions()
            .into_iter()
            .find(|s| s.session_id == session_id)
            .map(|s| Self::json_string(&s))
            .ok_or_else(|| {
                ErrorData::invalid_params(
                    format!("Session not found: {}", session_id),
                    None,
                )
            })
    }

    /// Current Anthropic OAuth usage snapshot. Shape mirrors what the Pulse
    /// right panel renders: 5h window, weekly, sonnet quota, extra usage.
    /// Returns `{}` as a string if the periodic refresh loop hasn't populated
    /// the cache yet.
    #[tool(
        name = "pulse_get_usage",
        description = "Get the current Anthropic OAuth usage state: 5h window, weekly, sonnet quota, extra usage. Returns a JSON object string. Returns '{}' if Pulse hasn't fetched usage yet."
    )]
    pub async fn pulse_get_usage(&self) -> String {
        let guard = self.state.usage.lock().await;
        Self::json_string(&guard.clone().unwrap_or_else(|| serde_json::json!({})))
    }

    /// List all alert presets configured in Pulse. Frontend-managed; fed by
    /// `sync_user_data`. Empty array string until the frontend has booted at
    /// least once after install.
    #[tool(
        name = "pulse_list_presets",
        description = "List all alert presets configured in Pulse. Returns a JSON array string. Each preset has a name, token limit, and up to three threshold tiers (warning/pre-critical/critical), each tier optionally firing a command."
    )]
    pub async fn pulse_list_presets(&self) -> String {
        let guard = self.state.user_data.lock().await;
        Self::json_string(
            &guard
                .get("presets")
                .cloned()
                .unwrap_or_else(|| serde_json::json!([])),
        )
    }

    /// List all custom commands in the Pulse command library. Frontend-managed;
    /// fed by `sync_user_data`. Empty array string until the frontend has
    /// synced once.
    #[tool(
        name = "pulse_list_commands",
        description = "List all custom commands in the Pulse library. Returns a JSON array string. Each entry has id, name, text, and a confirm flag."
    )]
    pub async fn pulse_list_commands(&self) -> String {
        let guard = self.state.user_data.lock().await;
        Self::json_string(
            &guard
                .get("commands")
                .cloned()
                .unwrap_or_else(|| serde_json::json!([])),
        )
    }

    // ------------------------------------------------------------------------
    // Phase 3: write tools.
    //
    // These mutate state - inject commands into terminals, change preset
    // assignments, force fresh API fetches. They share the same `String`-return
    // workaround as the read tools (see lesson #4 in docs/LESSONS.md).
    //
    // `pulse_assign_preset` is the only write tool that touches frontend-owned
    // state (sessionPresets). Rather than racing with the next `sync_user_data`
    // and silently losing the write, it emits a Tauri event the frontend
    // listens for; the frontend applies the change to settings, persists to
    // localStorage, and syncs back to Rust through the normal path. The MCP
    // tool returns immediately - eventually-consistent, but no lost writes.
    // ------------------------------------------------------------------------

    /// Inject a command (slash or natural language) into the target session's
    /// terminal. Uses Pulse's standard per-PID delivery path: `AttachConsole`
    /// + `WriteConsoleInputW` with bracketed-paste mode, falling back to
    /// `SendKeys` for elevated processes.
    #[tool(
        name = "pulse_send_command",
        description = "Inject text (slash command or natural-language message) into a specific Claude Code session's terminal by PID. Uses Pulse's per-PID delivery (AttachConsole + WriteConsoleInputW with bracketed-paste, SendKeys fallback for elevated processes). Returns a short status string."
    )]
    pub async fn pulse_send_command(
        &self,
        Parameters(SendCommandParams { pid, text }): Parameters<SendCommandParams>,
    ) -> Result<String, ErrorData> {
        crate::compact::send_command(pid, &text)
            .map_err(|e| ErrorData::internal_error(format!("send_command failed: {}", e), None))
    }

    /// Assign an alert preset to a specific session. Validates that the preset
    /// exists in the current preset library before dispatching. The actual
    /// frontend update + localStorage persist happens asynchronously via the
    /// `mcp-assign-preset` Tauri event.
    #[tool(
        name = "pulse_assign_preset",
        description = "Change which alert preset a session uses. Validates preset_id against pulse_list_presets; unknown IDs error out. The update propagates to the Pulse UI within ~100ms via a Tauri event; subsequent pulse_list_presets calls reflect the change."
    )]
    pub async fn pulse_assign_preset(
        &self,
        Parameters(AssignPresetParams { session_id, preset_id }): Parameters<AssignPresetParams>,
    ) -> Result<String, ErrorData> {
        // Validate preset_id exists in current presets before dispatching.
        // Avoids polluting the frontend with bogus assignments.
        {
            let guard = self.state.user_data.lock().await;
            let presets = guard.get("presets").and_then(|v| v.as_array());
            let exists = presets
                .map(|arr| arr.iter().any(|p| p.get("id").and_then(|v| v.as_str()) == Some(&preset_id)))
                .unwrap_or(false);
            if !exists {
                return Err(ErrorData::invalid_params(
                    format!("Unknown preset_id: {}", preset_id),
                    None,
                ));
            }
        }

        let payload = json!({
            "session_id": session_id,
            "preset_id": preset_id,
        });
        self.state
            .app_handle
            .emit("mcp-assign-preset", payload)
            .map_err(|e| ErrorData::internal_error(format!("Failed to dispatch event: {}", e), None))?;

        Ok(format!("Assigned preset '{}' to session '{}' (frontend will sync within ~100ms)", preset_id, session_id))
    }

    /// Force a fresh Anthropic OAuth usage fetch, bypassing the 5-minute
    /// background loop's schedule. Updates both the in-memory mirror and the
    /// disk cache. Returns the fresh usage JSON.
    #[tool(
        name = "pulse_refresh_usage",
        description = "Force an immediate Anthropic OAuth usage refresh, bypassing the periodic 5-minute loop. Returns the freshly-fetched usage state as a JSON string (same shape as pulse_get_usage)."
    )]
    pub async fn pulse_refresh_usage(&self) -> Result<String, ErrorData> {
        let fresh = crate::fetch_usage_data()
            .await
            .map_err(|e| ErrorData::internal_error(format!("Refresh failed: {}", e), None))?;
        crate::save_usage_cache(&fresh);
        *self.state.usage.lock().await = Some(fresh.clone());
        // Notify the UI so the right panel re-renders without waiting for the
        // next 30s tick.
        let _ = self.state.app_handle.emit("usage-updated", ());
        Ok(Self::json_string(&fresh))
    }

    /// Wipe the on-disk usage cache (`%LOCALAPPDATA%\auralis-pulse\usage-cache.json`)
    /// and clear the in-memory mirror. Pulse will repopulate on the next
    /// scheduled fetch (or call `pulse_refresh_usage` to repopulate now).
    #[tool(
        name = "pulse_clear_usage_cache",
        description = "Wipe the on-disk usage cache and clear the in-memory mirror. Forces Pulse to refetch from Anthropic on its next scheduled tick. Useful for debugging or to recover after a stale-cache stuck state."
    )]
    pub async fn pulse_clear_usage_cache(&self) -> Result<String, ErrorData> {
        if let Ok(path) = crate::usage_cache_path() {
            if path.exists() {
                std::fs::remove_file(&path)
                    .map_err(|e| ErrorData::internal_error(format!("Failed to delete cache file: {}", e), None))?;
            }
        }
        *self.state.usage.lock().await = None;
        let _ = self.state.app_handle.emit("usage-updated", ());
        Ok("Usage cache cleared. Pulse will refetch on the next 5-minute tick or on the next pulse_refresh_usage call.".to_string())
    }
}

#[tool_handler]
impl ServerHandler for PulseMcp {
    fn get_info(&self) -> ServerInfo {
        // ServerInfo (alias for InitializeResult) and Implementation are both
        // #[non_exhaustive], so we go through their constructors + chaining
        // setters rather than struct literals.
        let implementation = Implementation::new(
            "auralis-pulse",
            env!("CARGO_PKG_VERSION"),
        )
        .with_website_url("https://github.com/antonpme/auralis-pulse");

        let capabilities = ServerCapabilities::builder().enable_tools().build();

        let mut info = ServerInfo::new(capabilities);
        info = info.with_server_info(implementation);
        info.instructions = Some(
            "Auralis Pulse MCP server. Exposes Claude Code session monitoring, \
             per-PID command sending, and preset management to MCP clients. \
             Phase 2: pulse_ping + 5 read-only tools (list_sessions, get_session, \
             get_usage, list_presets, list_commands). Write tools land in v1.4.2."
                .to_string(),
        );
        info
    }
}

// ============================================================================
// Start: bind a dedicated listener and serve only the MCP service. Independent
// of the permission HTTP server (which lives on its own port in server.rs).
// ============================================================================

/// Build the bearer-auth-protected MCP router. Standalone (does not get nested
/// into another router) so the auth layer scope is unambiguous.
fn build_mcp_app(token: String, state: Arc<PulseMcpState>) -> axum::Router {
    let service = StreamableHttpService::new(
        move || Ok(PulseMcp::new(state.clone())),
        Arc::new(LocalSessionManager::default()),
        Default::default(),
    );

    // `bearer` is flagged as deprecated upstream for being "too basic to be
    // useful in real applications" - for a localhost tray-app it's exactly
    // the right surface area. Allow explicitly to keep the build clean.
    #[allow(deprecated)]
    let auth = ValidateRequestHeaderLayer::bearer(&token);

    axum::Router::new()
        .nest_service("/mcp", service)
        .layer(auth)
}

/// Spawn the MCP server on its own port (per McpConfig). Independent listener,
/// independent runtime task. If the bind fails the permission server is
/// unaffected.
pub async fn start_mcp_server(cfg: McpConfig, state: Arc<PulseMcpState>) {
    let bind_addr = format!("127.0.0.1:{}", cfg.port);
    let app = build_mcp_app(cfg.token, state);

    match tokio::net::TcpListener::bind(&bind_addr).await {
        Ok(listener) => {
            crate::pulse_log!("mcp", "MCP HTTP server bound {} at /mcp", bind_addr);
            if let Err(e) = axum::serve(listener, app).await {
                crate::pulse_log!("mcp", "MCP server exited with error: {}", e);
            }
        }
        Err(e) => {
            crate::pulse_log!(
                "mcp",
                "MCP server failed to bind {}: {}. MCP disabled.",
                bind_addr,
                e
            );
        }
    }
}
