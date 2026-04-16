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

## v1.2.0 (current)

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

## v1.3.0

### Context Window Alerts
- [ ] Per-session context threshold settings (warning + critical levels, e.g. 70% / 90%)
- [ ] Visual alert on session card when threshold reached (color change, icon, badge)
- [ ] System notification on threshold breach
- [ ] Optional auto-compact trigger when critical threshold reached
- [ ] Per-session override: allow disabling auto-compact for specific sessions (manual-only)
- [ ] Default thresholds in settings panel, per-session overrides on session card

### Configurable Keyboard Shortcuts
- [ ] Shortcuts editor in settings panel
- [ ] Navigation between sessions via keyboard
- [ ] Custom bindings for compact/dismiss actions

## v1.4.0

### Cross-Platform
- [ ] macOS build (.dmg) via GitHub Actions
- [ ] Linux build (.deb, .AppImage) via GitHub Actions
- [ ] Platform-specific compact (AppleScript for macOS, xdotool for Linux)
- [ ] Platform-specific notifications (native on each OS)
- [ ] CI matrix: Windows + macOS + Linux on every push

### Auto-Update
- [ ] Tauri updater plugin integration
- [ ] Update check on startup + periodic
- [ ] Update notification in tray menu

## Future (ideas)

- [ ] Custom commands (crystallize, handoff, etc. via dropdown)
- [ ] Remote mobile access (Tailscale + PWA)
- [ ] Session activity timeline/graph
- [ ] Cost estimation per session (tokens x model pricing)
- [ ] Multi-window support (detach usage panel)
- [ ] Plugin system for custom panels
- [ ] WebSocket-based permission forwarding (replace HTTP polling)
- [ ] Tray icon themes (match app theme)
