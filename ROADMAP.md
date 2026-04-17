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

## v1.3.0 (current)

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

## v1.4.0

### Cross-Platform
- [ ] macOS build (.dmg) via GitHub Actions
- [ ] Linux build (.deb, .AppImage) via GitHub Actions
- [ ] Platform-specific command delivery (AppleScript/osascript for macOS, xdotool for Linux)
- [ ] Platform-specific notifications (native on each OS)
- [ ] CI matrix: Windows + macOS + Linux on every push

### Auto-Update
- [ ] Tauri updater plugin integration
- [ ] Update check on startup + periodic
- [ ] Update notification in tray menu

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
