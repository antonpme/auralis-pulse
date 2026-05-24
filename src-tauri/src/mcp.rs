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
use std::{fs, path::PathBuf, sync::Arc};
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
