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

## v1.1.0 (current)

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
- [x] Theme: Light (white, purple accent, Raycast-inspired, 1.04x font)
- [x] Theme switcher with radio selector
- [x] Persist theme + all settings in localStorage
- [x] Window resize per theme, anchored to bottom-right

### Quality of Life
- [x] Screenshot in README
- [x] Icon buttons for compact/dismiss with tooltips
- [x] Tier badge pill-shaped styling
- [x] Currency-agnostic extra usage display
- [ ] Keyboard shortcuts for permissions (Y/N) - in progress
- [ ] GitHub Release with attached .exe installer - in progress

## v1.2.0

### Context Window Alerts
- [ ] Per-session context threshold settings (warning + critical levels, e.g. 70% / 90%)
- [ ] Visual alert on session card when threshold reached (color change, icon, badge)
- [ ] System notification on threshold breach
- [ ] Optional auto-compact trigger when critical threshold reached
- [ ] Per-session override: allow disabling auto-compact for specific sessions (manual-only)
- [ ] Default thresholds in settings panel, per-session overrides on session card

### Keyboard Shortcuts
- [ ] Configurable shortcuts in settings panel
- [ ] Y/N for permission approve/deny
- [ ] Navigation between sessions

### Quality of Life
- [ ] Session numbering (#1, #2, #3) on session cards
- [ ] Session sorting (by context %, duration, idle time)
- [ ] Project filter (filter by cwd)

## v1.3.0

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

- [ ] Session activity timeline/graph
- [ ] Cost estimation per session (tokens x model pricing)
- [ ] Multi-window support (detach usage panel)
- [ ] Plugin system for custom panels
- [ ] WebSocket-based permission forwarding (replace HTTP polling)
- [ ] Tray icon themes (match app theme)
