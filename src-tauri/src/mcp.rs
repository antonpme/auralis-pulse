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
//! Phase 1 (this file) ships only a `pulse_ping` health-check tool plus the
//! config/persistence layer. Read tools, write tools, and notifications land in
//! later phases.
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
    handler::server::router::tool::ToolRouter,
    model::{Implementation, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, tower::StreamableHttpService,
    },
    ServerHandler,
};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Arc};
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
// MCP service: the actual server handler with tools.
// Phase 1 ships only pulse_ping. Phases 2+ extend this struct.
// ============================================================================

#[derive(Clone)]
pub struct PulseMcp {
    // Filled by the `#[tool_router]` macro on impl, consumed by `#[tool_handler]`
    // on ServerHandler. The macro layer reads it through a Deref trick that
    // rustc's dead-code pass doesn't see, hence the explicit allow.
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

#[tool_router]
impl PulseMcp {
    pub fn new() -> Self {
        Self {
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
             Phase 1: pulse_ping only. More tools land in subsequent versions."
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
fn build_mcp_app(token: String) -> axum::Router {
    let service = StreamableHttpService::new(
        || Ok(PulseMcp::new()),
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
pub async fn start_mcp_server(cfg: McpConfig) {
    let bind_addr = format!("127.0.0.1:{}", cfg.port);
    let app = build_mcp_app(cfg.token);

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
