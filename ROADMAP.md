# Auralis Pulse - Roadmap

## v1.0.0 (current)

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
- [ ] Dedicated settings view (tab or slide-out)
- [ ] Window behavior: always on top toggle
- [ ] Window behavior: auto-hide on blur toggle
- [ ] Minimize button in header bar

### Themes
- [ ] CSS custom properties for all colors
- [ ] Theme: Cyberpunk (current default)
- [ ] Theme: Glassmorphism (blur, translucency, soft borders)
- [ ] Theme: Minimal Light (clean, bright, high contrast)
- [ ] Theme: macOS Neutral (warm grays, subtle shadows)
- [ ] Theme switcher in settings
- [ ] Persist theme selection in localStorage

### Quality of Life
- [ ] Keyboard shortcuts for permissions (Y to allow, N to deny)
- [ ] Screenshot in README
- [ ] GitHub Release with attached .exe installer

## v1.2.0

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

## v1.3.0 (ideas)

- [ ] Session activity timeline/graph
- [ ] Cost estimation per session (tokens x model pricing)
- [ ] Multi-window support (detach usage panel)
- [ ] Plugin system for custom panels
- [ ] WebSocket-based permission forwarding (replace HTTP polling)
- [ ] Tray icon themes (match app theme)
