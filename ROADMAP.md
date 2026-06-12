# Auralis Pulse - Roadmap

## v1.0.0

- [x] Session monitoring (token usage, model, duration, PID, compaction count)
- [x] Permission forwarding via CLI hook (hookSpecificOutput format)
- [x] Usage burnrate (5h session, weekly, sonnet, extra usage)
- [x] System tray with dynamic icon + pending badge
- [x] Compact trigger (SendKeys to terminal)
- [x] Ghost/idle session detection with IDLE/GHOST badges
- [x] Dismiss sessions + bulk clean ghosts
- [x] Auto-hide on focus loss
- [x] Session name from JSON file + entrypoint-aware fallback
- [x] Process name verification (prevents PID reuse false positives)
- [x] Version display (tray menu + UI subtitle)

## v1.1.0

### Settings Panel
- [x] Dedicated settings view (view switching, gear icon)
- [x] Window behavior: always on top toggle
- [x] Window behavior: auto-hide on blur toggle
- [x] Autostart toggle (moved from tray menu)
- [x] Tray metric selector (5H/WEEK/SONNET)
- [x] About section with version + GitHub link

### Themes
- [x] CSS custom properties for all colors, shapes, fonts, spacing
- [x] Theme: Cyberpunk (dark, neon green, sharp corners)
- [x] Theme: Glassmorphism (dark translucent, rounded, airy, 1.08x font)
- [x] Theme: Light (white, purple accent, clean)
- [x] Theme switcher with radio selector
- [x] Persist theme + all settings in localStorage

### Quality of Life
- [x] Screenshot in README
- [x] Icon buttons for compact/dismiss with tooltips
- [x] Tier badge pill-shaped styling
- [x] Currency-agnostic extra usage display
- [x] Keyboard shortcuts for permissions (Y=allow, A=always, N=deny)
- [x] Window positioning via Win32 SPI_GETWORKAREA (no hardcoded offsets)
- [x] GitHub Release with attached .exe installer

## v1.2.0

### Session Management
- [x] Filter dropdown (All / Status / Project)
- [x] Sort dropdown (default / context % / duration / last activity / alphabetical)
- [x] Session numbering (#1, #2, #3) with dynamic re-numbering by view
- [x] Persist filter/sort state in localStorage
- [x] Empty state when no sessions match filter
- [x] Count display "SESSIONS (X / Y)" when filtered

### UI Polish
- [x] Standardized window size 810x520 across all themes (fixed resize-on-theme-change bug)
- [x] Narrower right panel 280px -> 240px (more room for sessions)
- [x] Uniform gap-sections 14px across themes
- [x] Increased internal card gap 4px -> 6px
- [x] Fixed PID contrast (10px text-muted)
- [x] Fixed subtitle contrast (text-muted)
- [x] Larger session info fonts (11px model/duration, 10px PID)
- [x] Unified button/select height (--btn-height: 26px)
- [x] Vertical text centering via flex + line-height:1 on all interactive elements
- [x] Compaction indicator moved next to context % (saves a line)

### Behavior
- [x] Relaxed idle/ghost thresholds (active <= 15min, ghost > 60min)

## v1.3.6 (current)

### Bugfix: Usage API parse regression
- [x] `UsageLimit.resets_at` -> `Option<String>`. Anthropic started returning `null` on inactive limits (e.g. `seven_day_sonnet` when unused), serde required String, parse failed on every fetch since ~2026-05-15, background loop stuck retrying every 5min with no UI signal.
- [x] Refresh button no longer swallows errors silently. Surfaces `Refresh failed: <reason>` toast on failure, `Usage refreshed` toast on success. Spinner rotates icon while inflight.
- [x] New "USAGE DIAGNOSTICS" group in Settings -> Behavior: shows last fetched age (live) + "Clear usage cache & retry" button. Wipes `%LOCALAPPDATA%\auralis-pulse\usage-cache.json` and forces a fresh API call.
- [x] New Tauri command `clear_usage_cache` (also clears in-memory state).

## v1.3.5

### UI Polish + Architecture
- [x] DOM split into `#app-main` and `#app-overlays`: auto-refresh (15s interval, sessions-updated, usage-updated, permission-request) updates ONLY main panel. Active modals/popovers/toasts no longer flicker or re-render when sessions/usage refresh in the background. User interaction with overlays is never disturbed by background updates.
- [x] Preset picker promoted from anchored popover to centered modal: full backdrop, centered card, ESC + click-outside dismiss, Done button. Heavy interaction (preset selection + auto-compact toggle + manage presets navigation) deserves a focused modal not a dropdown.
- [x] Fix: `#app-main` is now `display:flex; flex-direction:column; flex:1; min-height:0` so the inner `.split-container flex:1` chain has a height to fill (regression from DOM split caused right panel to clip at the bottom).

## v1.3.3

### UI Polish
- [x] Active-preset chip replaces gear icon: shows current preset name on the session card, click opens picker (info + action in one element)
- [x] Removed compact icon from session actions row (duplicated in send menu `⋯`); resulting row: preset chip + pin + send-menu + dismiss-if-applicable
- [x] Glass theme: corner radii toned down (card 10->7px, btn 6->4px, badge 8->5px, bar 3->2px) so small components don't read as overly bubbly

## v1.3.2

### UI Polish
- [x] Usage metric buttons (5H/WEEK/SONNET) stretch to fill parent row (`flex: 1 1 0`)
- [x] Pin icon redesign: SVG pushpin with state-aware rotation (35° tilt unpinned, upright pinned) + accent color when pinned + filled background pill
- [x] Compactions indicator: replaced cryptic `↻` glyph with explicit "{N} compactions" label, smaller font (0.78em), `title=` tooltip explaining what it counts
- [x] Window pinning to bottom-right corner: DWM-aware via `DWMWA_EXTENDED_FRAME_BOUNDS` + Win32 `SetWindowPos`. Accounts for Win11 borderless invisible drop-shadow margin so visible edges land flush on screen corner. Same code path used on first build and on every subsequent tray show -> unified behavior, no more 5-8px gap after collapse/expand

## v1.3.0

### Custom Commands
- [x] Commands library in Settings (add/edit/delete commands)
- [x] Built-in Compact command (non-deletable)
- [x] Slash commands OR natural-language messages (multi-line supported)
- [x] Optional "confirm before sending" flag per command
- [x] Send menu (⋯ icon) on each session card lists all commands
- [x] Confirmation modal for commands with `confirm: true`
- [x] Generalized `send_command(pid, text)` backend Tauri command

### Reliable Command Delivery
- [x] `WriteConsoleInput` via `AttachConsole` - writes directly to target's console input buffer
- [x] Bypasses window focus, SendKeys limitations, WT tab selection
- [x] Works per-PID regardless of which tab/window is active in Windows Terminal
- [x] Bracketed paste mode for multi-line text (`ESC[200~...ESC[201~`)
- [x] Two-phase write with 250ms delay for multi-line (content first, then submit Enter)
- [x] Auto-clear (Ctrl+U) before paste prevents accumulated leftover input
- [x] SendKeys fallback path if console attach fails (process tree walk + SwitchToThisWindow)

### Alert Presets
- [x] Preset library in Settings → Alerts tab (add/edit/delete/set-default)
- [x] Four built-in presets: Default (250K), Worker (250K), Architect (450K), Soul (450K manual-only)
- [x] 3-tier thresholds per preset: warning, pre-critical, critical
- [x] Each threshold: absolute token count, run command (dropdown), notify toggle
- [x] Custom token limit per preset (K/M shorthand parsing, e.g. "450K" → 450000)
- [x] Live percent recomputation in editor as user types
- [x] Cannot delete default preset (must reassign default first)

### Per-Session Preset Assignment
- [x] Gear icon (⚙) on session card opens popover
- [x] Preset dropdown (select any preset from library)
- [x] Summary of active preset thresholds (tokens, %, linked command, notify indicator)
- [x] "Manage presets" link → jumps to Settings → Alerts
- [x] Assignment persisted in localStorage by `session_id` (survives Pulse restarts)

### Alert Engine
- [x] `processAlerts` runs in `renderLeftPanel` refresh cycle
- [x] Threshold crossing detection with hysteresis (re-fire after compact drops tokens below)
- [x] System notification on threshold crossing (via `tauri-plugin-notification`)
- [x] Auto-fire countdown toast (10s) with Cancel button
- [x] Toast animation survives re-renders (negative animation-delay based on elapsed time)
- [x] Visual alert states on session card: T1 yellow, T2 orange, T3 red with pulse animation

### Auto-Compact Safety Gate
- [x] Per-session "Allow auto-compact" checkbox in gear popover (default OFF)
- [x] Persisted in localStorage by `session_id`
- [x] Runtime gate: `/compact` auto-fire is blocked unless session explicitly allows it
- [x] Safety toast when suppressed: `"sessionName at critical: /compact suppressed (toggle in ⚙)"`
- [x] Other commands (Crystallize, Handoff, etc.) are NOT gated - only `/compact` is treated as destructive

### UI Infrastructure (built from scratch)
- [x] Tabbed settings view (Appearance, Behavior, Alerts, Commands, About)
- [x] Modal system (backdrop, centered card, header/body/actions, Escape to close)
- [x] Popover system (anchored positioning with overflow flip-up when near bottom)
- [x] Toast system (info/warning/error/countdown types, stack, Cancel for countdown)
- [x] Keyboard Escape priority: modal > popover > settings view > hide window
- [x] Click-outside dismissal for popovers

### Pin Sessions
- [x] ⬆ pin icon on session card (leftmost in action row)
- [x] Pinned sessions always visible at top (filter does not apply to them)
- [x] Sort applies to pinned and unpinned sections separately
- [x] Divider between pinned and unpinned sections
- [x] Persisted in localStorage

### Model Version Parsing
- [x] Correct extraction of Opus/Sonnet/Haiku version from raw model string (`claude-opus-4-7-20260101` → `opus-4-7`)
- [x] Handles both modern format (`family-version-date`) and legacy (`3-5-sonnet-date`)

### Rate Limit Handling
- [x] Disk cache for usage data (`%LOCALAPPDATA%\auralis-pulse\usage-cache.json`)
- [x] Stale-while-revalidate: cached data shown immediately on startup
- [x] Exponential backoff on 429 rate limit: 5→10→20→40→60 min cap
- [x] Staleness indicator in UI: "Updated 3m ago" (yellow if >10min)
- [x] Removed auto-refresh spam from render loop

### Miscellaneous
- [x] Fixed CSP (was blocking Tauri IPC calls, everything was falling back to postMessage)
- [x] DevTools enabled in release builds (F12 or Ctrl+Shift+I)
- [x] Light theme dropdown options correctly colored (color-scheme CSS property)

## v1.4.8 (current)

### Fable 5 model detection (+ first live auto-update)

Bugfix Ton hit: Pulse did not recognise the new Fable 5 model. It showed a raw
name and a 200K ceiling instead of 1M. Two root causes in `context.rs`
`parse_model_string`, both fixed:

- [x] **`fable` added as a known family.** Previously only opus/sonnet/haiku were
  recognised; `claude-fable-5` fell into the unknown-family branch (raw name, 200K).
- [x] **Context window is now marker-driven, not family-driven.** The 1M beta is
  signalled by a `[1m]` marker in the id (e.g. `claude-opus-4-8[1m]`); when present
  it forces 1M for any family. Fable carries no marker, but CLI Fable was confirmed
  via `/context` (Claude Code v2.1.175) to default to a 1M window, so `claude-fable-5`
  maps to 1M. Result: `fable-5[1m]`, 1M ceiling.
- [x] **Label surfaces the 1M window** (`fable-5[1m]`, `opus-4-8[1m]`) when there is
  positive evidence (explicit marker or fable). Bare opus keeps its soft 1M default
  with an unmarked label.
- [x] **Bonus:** fixed an adjacent label-truncation bug where `claude-opus-4-8[1m]`
  rendered as `opus-4` (the `8[1m]` segment broke version parsing). Marker is now
  stripped before version extraction.
- [x] **8 unit tests** added for `parse_model_string` to guard against model-string
  drift (same class of breakage as the nullable `resets_at` regression).

This patch doubles as the **first live auto-update test**: v1.4.7 taught Pulse to
self-update, and v1.4.8 is the first version expected to arrive in-app via the
`Update available [Install]` toast.

## v1.4.7

### Auto-update

Pulse updates itself. No more manual reinstall on every patch.

- [x] **Tauri 2 updater plugin** wired in (`tauri-plugin-updater` + `tauri-plugin-process`). On boot and every 6h, Pulse checks `https://github.com/antonpme/auralis-pulse/releases/latest/download/latest.json`, verifies the Ed25519 signature against the public key baked into `tauri.conf.json`, and surfaces a non-silent toast: `Update vX.Y.Z available` with `Install` / `Later`. Chosen over silent auto-install because Pulse monitors live Claude Code sessions; the user decides when to restart.
- [x] **Install flow.** `Install` downloads and runs the NSIS installer in `passive` mode (small progress bar, no prompts), then relaunches. Two Rust commands: `check_for_update` (returns version + notes, or none) and `install_update` (download, install, restart). Frontend toast system extended with an optional `actions` array for the two buttons.
- [x] **Signing.** Ed25519 updater key, independent of Windows code-signing. Public key in `tauri.conf.json`, private key kept off-repo in `~/.tauri/`, supplied at build time via `TAURI_SIGNING_PRIVATE_KEY`. `bundle.createUpdaterArtifacts: true` emits the `.sig` next to the installer.
- [x] **Ship process** now attaches `latest.json` (version + signature + download URL) to each GitHub release alongside the installer.

Bootstrap note: v1.4.7 is the last version installed manually. v1.4.8 onward arrives in-app.

## v1.4.6

### MCP tab UI cleanup

Polish pass on the Settings -> MCP tab. No protocol or tool changes.

- [x] **Token no longer leaks in the Quick Start command.** The rendered `claude mcp add` command now masks the bearer token (`first6...last4`) until you hit Reveal, matching the Bearer Token group above it. The "Copy full command" button still copies the real token, so paste-into-terminal is unaffected.
- [x] **Command no longer breaks mid-word.** Swapped `word-break: break-all` for `overflow-wrap: anywhere`, so `Bearer` and `Authorization` stay intact and only the long token wraps. With the token masked, the whole command lays out in two clean lines.
- [x] **Removed an em-dash from the verify hint** (house style: no em-dashes). Now a colon.
- [x] **Exposed Tools list wraps cleanly.** Read and Write rows are now stacked (label on top, full-width tool list below), so the six-name Read list no longer collides with its label.

## v1.4.5

### MCP Server Integration: Phase 6 per-client setup docs

Documentation-only release. Closes the v1.4 MCP arc.

- [x] **README MCP section reworked.** New `Connect from other MCP clients` block with collapsible `<details>` per client. Each block carries: exact Windows config-file path, copy-paste JSON/YAML snippet with `<TOKEN>` placeholder, restart requirement, verification step, and known gotchas. Pulse Settings -> MCP tab remains the source of truth for the actual token value.
- [x] **Four clients covered.** Cursor (`.cursor/mcp.json` or `~/.cursor/mcp.json`, restart required, supports HTTP + custom headers + env-var interpolation). Continue.dev (`~/.continue/config.yaml`, hot-reloads, `type: streamable-http` is load-bearing). Zed (`%APPDATA%\Zed\settings.json`, hot-reloads except symlinks, key is `context_servers` not `mcpServers`). Claude Desktop (still stdio-only natively + native Custom Connectors require OAuth, so via [`mcp-remote`](https://github.com/geelen/mcp-remote) bridge with `--allow-http` and `--transport http-only`, full quit-and-relaunch required).
- [x] **Single shared verification step.** Any client: ask for `pulse_ping`, expect `"pong (auralis-pulse v1.4.5)"`. If the version string comes back, both MCP transport and bearer auth are confirmed healthy.
- [x] **README footer simplified.** Removed the now-stale "land in v1.4.5" promise; the snippets are inline above.

## v1.4.4

### MCP Server Integration: Phase 4 server-pushed notifications

Pulse now broadcasts state changes to every connected MCP client over the existing Streamable HTTP connection. No polling. Wraps payloads in standard `notifications/message` (logging) frames so any MCP-conformant client surface receives them; structured `data` carries `{ kind, payload }` for easy dispatch.

- [x] **`threshold-crossed`** — fired by the frontend hysteresis loop when a session crosses a per-preset threshold. Payload carries `session_id`, `pid`, `name`, `tier` (`warning` | `pre-critical` | `critical`), `tier_index`, `used_tokens`, `limit_tokens`, `percent`, `preset_id`, `preset_name`. Goes through a new `mcp_broadcast(kind, payload)` Tauri command so the frontend can dispatch any MCP event without new Rust surface.
- [x] **`session-added`** / **`session-removed`** — diffed every 30 seconds in the backend session refresh loop. `session-added` payload carries `session_id`, `pid`, `name`, `cwd`, `started_at`. `session-removed` carries just `session_id`. First tick after Pulse start emits `session-added` for every currently alive session so clients can populate without an explicit `pulse_list_sessions` call.
- [x] **`usage-updated`** — fired after every successful Anthropic OAuth fetch (5-minute loop, or any explicit `pulse_refresh_usage` call). Slim payload: `fetched_at`, `tier`, `five_hour_pct`, `weekly_pct`, `sonnet_pct`. Full usage shape stays available via `pulse_get_usage`.

### Plumbing
- [x] `PulseMcpState` extended with `peers: Arc<Mutex<Vec<Peer<RoleServer>>>>`. Same `Arc` is held by `McpPeersState` (Tauri-managed) so backend loops and the frontend `mcp_broadcast` command see the canonical peer list.
- [x] `ServerHandler::on_initialized` override captures `context.peer.clone()` into the peer list when a client completes its handshake. rmcp doesn't expose a disconnect hook, so `mcp::broadcast_pulse_event` drains transport-closed peers on every call via `Peer::is_transport_closed()`.
- [x] `ServerCapabilities` now advertises `logging` alongside `tools` so capability-aware clients know to subscribe.
- [x] Pub helper `mcp::broadcast_pulse_event(peers, kind, payload)`: snapshot peers under short lock, send `notify_logging_message` per peer without holding the lock, drop closed peers on completion. No-op when no clients are connected (early-exit).

## v1.4.3

### MCP Server Integration: Phase 5 Settings tab
- [x] **New "MCP" tab inside Settings** (between Commands and About). Connection group shows the listening address (`127.0.0.1:<port>`) and full URL. Token group shows a masked token (`first6...last4`) with Reveal/Hide and Copy buttons. Quick Start group shows the full `claude mcp add --transport http --scope user auralis-pulse <url> --header "Authorization: Bearer <token>"` command in a monospace block with a one-click Copy. Exposed Tools group lists all 10 tool names so a user immediately sees the surface.
- [x] **Zero-friction client wiring.** No more digging through `%LOCALAPPDATA%\auralis-pulse\mcp.json` to find the bearer token. Open Settings → MCP → Copy command → paste into terminal → done.
- [x] **Reveal-state hygiene.** Token starts masked. Toggling Reveal flips it. Switching tabs or closing Settings (Back button or Escape) auto-resets to masked — no leaving a revealed token on screen if you wander away.
- [x] **Reuses existing `get_mcp_config` Tauri command** shipped in v1.4.0. No new Rust surface, pure frontend work (main.js + style.css). Clipboard via `navigator.clipboard.writeText()` works in the Tauri webview without an extra plugin.

## v1.4.2

### MCP Server Integration: Phase 3 write tools
- [x] **`pulse_send_command(pid, text)`** - inject any text (slash command or natural-language message) into a specific Claude Code session's terminal. Uses the standard per-PID delivery path: `AttachConsole` + `WriteConsoleInputW` with bracketed-paste mode, `SendKeys` fallback for elevated processes.
- [x] **`pulse_assign_preset(session_id, preset_id)`** - swap a session's alert preset. Validates preset_id against the live library; unknown ids error out with `invalid_params`. Frontend syncs in ~100ms via a `mcp-assign-preset` Tauri event that updates `settings.sessionPresets`, persists to localStorage, and round-trips back to Rust through the normal `sync_user_data` path. Eventually-consistent, no lost writes.
- [x] **`pulse_refresh_usage`** - force an immediate Anthropic OAuth usage refresh, bypass the periodic 5-minute loop. Returns the fresh usage JSON, emits `usage-updated` so the right panel re-renders without waiting for the next tick.
- [x] **`pulse_clear_usage_cache`** - wipe `%LOCALAPPDATA%\auralis-pulse\usage-cache.json` and clear the in-memory mirror. Pulse repopulates on next scheduled fetch.

### Plumbing
- [x] `PulseMcpState` extended with `app_handle: tauri::AppHandle` so MCP write tools can `emit` events to the frontend layer. Required for `pulse_assign_preset` round-trip and for `usage-updated` re-render signals.
- [x] `fetch_usage_data`, `save_usage_cache`, `usage_cache_path` promoted to `pub(crate)` so `mcp.rs` reuses the canonical helpers instead of duplicating them.
- [x] Frontend `main.js` listens for `mcp-assign-preset` events. Validates the preset still exists in the library, applies to `settings.sessionPresets`, persists, re-renders, and shows a `"Preset → <Name> (via MCP)"` toast.

### Smoke test coverage
- [x] `scripts/mcp_smoke.py` extended: expects 10 tools, exercises every write tool (negative cases for send_command + assign_preset, positive case for assign_preset on a live session, clear+refresh sequence).

## v1.4.1

### MCP Server Integration: Phase 2 read tools
- [x] **`pulse_list_sessions`** - returns the live session list (PID, session_id, cwd, name, started_at, duration_mins, last_activity_mins, status, alive) as a JSON array string.
- [x] **`pulse_get_session(session_id)`** - look up one session by ID. Returns a structured MCP error if no alive session matches.
- [x] **`pulse_get_usage`** - current Anthropic OAuth usage snapshot: 5h window, weekly, sonnet quota, extra usage. Mirrors the Pulse right panel.
- [x] **`pulse_list_presets`** - alert presets (Default / Worker / Architect / Orchestrator built-ins, plus any user-added).
- [x] **`pulse_list_commands`** - custom command library entries.

### Frontend ↔ Rust state mirror (`sync_user_data`)
- [x] New Tauri command `sync_user_data` pushes presets, custom commands, per-session preset assignments, and per-session auto-compact overrides from the JS frontend into a shared `Arc<Mutex<serde_json::Value>>` that MCP tools read. Persisted to `%LOCALAPPDATA%\auralis-pulse\user-data.json` so cold-start MCP queries return real data even before the frontend boots once.
- [x] `UsageState.data` refactored to `Arc<Mutex<...>>` so the same backing mutex is shared between Tauri commands and MCP tools without a parallel cache.
- [x] Frontend calls `syncUserData()` once at boot plus after every CRUD that touches synced fields (presets / commands / session preset assignments / auto-compact overrides).

### Reusable MCP smoke test
- [x] `scripts/mcp_smoke.py` walks the full Streamable HTTP MCP handshake (initialize → notifications/initialized → tools/list → tools/call x6) using only the Python stdlib. Run after any change to `mcp.rs` to catch protocol regressions before shipping. See `docs/LESSONS.md` for why this exists.

### Engineering lesson captured
- [x] `docs/LESSONS.md` lesson #4: `rmcp::Json<T>` returns silently drop MCP `initialize` requests under rmcp 1.7 + schemars 1.x. Phase 2 tools work around this by returning JSON-stringified `String`; documented as the official path until upstream compatibility is verified.

## v1.4.0

### Autostart persistence
- [x] User's "Start with Windows" preference is now stored in `%LOCALAPPDATA%\auralis-pulse\settings.json` (a directory NSIS does not clean on upgrade). Survives reinstalls. The OS registry is treated as the mechanism to fulfill the intent, not the source of truth.
- [x] Self-heal on every Pulse startup: if `pref=true` and the registry value is out of sync (stale dev path, NSIS cleanup), re-register the current exe path. Idempotent.
- [x] `get_autostart` Tauri command returns the saved pref, not the registry state. UI shows the user's actual intent.

### Diagnostic file logger
- [x] New `pulse_log` module writes timestamped lines to `%LOCALAPPDATA%\auralis-pulse\pulse.log` (1 MB cap, truncate on roll). Pulse builds with `windows_subsystem = "windows"` in release, so `eprintln!` is invisible; this file is the canonical place to look when something silently fails.
- [x] Used at server bind, MCP startup, autostart self-heal, mcp.json migration.

### MCP Server Integration: Foundation
Pulse can expose session monitoring, command sending, and preset management to MCP clients (Claude Code, Claude Desktop, Cursor, Continue, Zed) over Streamable HTTP transport. Bearer-token auth, port + token persisted to `%LOCALAPPDATA%\auralis-pulse\mcp.json`.

- [x] **Phase 1: Foundation.** rmcp 1.7 dep, McpConfig generation + persistence, bearer-auth on dedicated listener `127.0.0.1:59429/mcp` (separate from the permission server on 59428 to keep failure domains independent), `pulse_ping` smoke-test tool, `get_mcp_config` Tauri command. *(shipped in v1.4.0)*
- [x] **Phase 2: Read-only tools.** pulse_list_sessions, pulse_get_session, pulse_get_usage, pulse_list_presets, pulse_list_commands. *(shipped in v1.4.1)*
- [x] **Phase 3: Write tools.** pulse_send_command, pulse_assign_preset, pulse_refresh_usage, pulse_clear_usage_cache. *(shipped in v1.4.2)*
- [x] **Phase 5: Settings UX.** New "MCP" tab. Shows port, URL, masked token with Reveal/Hide, Copy token, Copy full `claude mcp add` command, exposed-tools summary. *(shipped in v1.4.3, swapped ahead of Phase 4 since it's pure UI work with high user value)*
- [x] **Phase 4: Notifications.** Four event kinds broadcast over the MCP `notifications/message` (logging) channel with structured `{ kind, payload }` data: `threshold-crossed` (per-preset, frontend-fired), `session-added`/`session-removed` (backend 30s diff), `usage-updated` (after every Anthropic fetch). `Peer<RoleServer>` captured in `ServerHandler::on_initialized`, transport-closed peers dropped on every broadcast. *(shipped in v1.4.4)*
- [x] **Phase 6: Docs.** README MCP section with examples per client (Claude Code, Claude Desktop via mcp-remote bridge, Cursor, Continue, Zed). *(shipped in v1.4.5)*

## v1.5.0

### Cross-Platform
- [ ] macOS build (.dmg) via GitHub Actions
- [ ] Linux build (.deb, .AppImage) via GitHub Actions
- [ ] Platform-specific command delivery (iTerm2 Python API for macOS, tmux send-keys for Linux)
- [ ] Platform-specific notifications (native on each OS)
- [ ] CI matrix: Windows + macOS + Linux on every push

### Auto-Update
- [x] Tauri updater plugin integration *(shipped in v1.4.7)*
- [x] Update check on startup + periodic (every 6h) *(shipped in v1.4.7)*
- [x] Update notification via in-app toast with Install / Later *(shipped in v1.4.7; chose toast over tray menu so it surfaces in context)*

### Configurable Keyboard Shortcuts
- [ ] Shortcuts editor in settings panel
- [ ] Navigation between sessions via keyboard
- [ ] Custom bindings for compact/dismiss actions

## Future (ideas)

- [ ] Command chains (Crystallize → wait for agent "ready" signal → Compact)
- [ ] Discord callback integration for completion detection
- [ ] Remote mobile access (Tailscale + PWA)
- [ ] Session activity timeline/graph
- [ ] Cost estimation per session (tokens × model pricing)
- [ ] Multi-window support (detach usage panel)
- [ ] Plugin system for custom panels
- [ ] WebSocket-based permission forwarding (replace HTTP polling)
- [ ] Tray icon themes (match app theme)
- [ ] Cleanup button for orphaned session_id entries in localStorage
