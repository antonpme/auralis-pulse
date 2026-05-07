<!--
  README DRAFT - v1.3.5+ rewrite
  Status: skeleton ready, awaiting cover image + theme screenshots + per-PID demo GIF.
  Once Ton picks a cover concept (A/B/C) and we generate + composite, swap COVER_IMAGE_PLACEHOLDER.
-->

<p align="center">
  <img src="docs/cover.png" alt="Auralis Pulse" width="880">
</p>

<p align="center">
  <strong>Auralis Pulse</strong><br>
  <em>A tray companion for Claude Code. On Windows, on watch.</em>
</p>

<p align="center">
  <a href="https://github.com/antonpme/auralis-pulse/releases/latest"><img src="https://img.shields.io/github/v/release/antonpme/auralis-pulse?style=flat-square&color=10b981" alt="Latest release"></a>
  <a href="https://v2.tauri.app/"><img src="https://img.shields.io/badge/Tauri-2.0-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2"></a>
  <img src="https://img.shields.io/badge/Rust-1.83-orange?style=flat-square&logo=rust&logoColor=white" alt="Rust 1.83">
  <img src="https://img.shields.io/badge/platform-windows%2010%2F11-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows 10/11">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/antonpme/auralis-pulse?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/github/downloads/antonpme/auralis-pulse/total?style=flat-square&color=8b5cf6" alt="Total downloads">
</p>

---

Auralis Pulse watches every Claude Code session you have running, surfaces permission requests before they bury themselves in the terminal, and sends commands to the right PID even when its window isn't focused. Pin it to the bottom-right corner of your screen and forget the alt-tab dance.

## Themes

<table>
  <tr>
    <td align="center" width="33%"><img src="docs/theme-cyberpunk.png" alt="Cyberpunk"><br><sub><b>Cyberpunk</b><br>neon, sharp, terminal</sub></td>
    <td align="center" width="33%"><img src="docs/theme-glass.png" alt="Glassmorphism"><br><sub><b>Glassmorphism</b><br>translucent, rounded, airy</sub></td>
    <td align="center" width="33%"><img src="docs/theme-light.png" alt="Light"><br><sub><b>Light</b><br>clean, purple accent, editorial</sub></td>
  </tr>
</table>

## Features

- **Per-PID command delivery.** `/compact`, custom slash commands, multi-line messages, anything. Goes to the exact session you target via Windows Console API. Doesn't require focus, works across Windows Terminal tabs, doesn't interfere with your other sessions. <sub>(see [How it works](#how-it-works))</sub>
- **Alert presets with auto-fire.** Define thresholds (e.g. warning at 250K, critical at 88%), wire each one to a command, get a 10-second countdown toast with Cancel before anything fires. Built-in presets for Default / Worker / Architect / Soul roles.
- **Permission forwarding.** When Claude Code asks for permission (Bash, Write, Edit), Pulse catches it via hook, shows a desktop notification, and lets you approve or deny from the tray popup. **Y** allow, **A** always, **N** deny.
- **Usage tracking.** Live burnrate bars for 5-hour, weekly, and Sonnet-specific limits with reset times. Disk cache + exponential backoff handles API rate limits without spam.
- **Session monitoring.** Token usage, model (correctly parsed across Opus/Sonnet/Haiku versions), duration, compaction count, PID. Filter by status or project, sort multiple ways, pin important sessions to the top.
- **Auto-compact safety.** Per-session opt-in checkbox. Even if a preset fires `/compact`, it's blocked unless you explicitly allowed it for that session. Defense in depth for long-lived agents.
- **Three themes.** Cyberpunk (dark, neon green, sharp), Glassmorphism (translucent dark with blue accents, rounded), Light (white, purple accent, clean). All settings persist.

## Install

**Windows 10 / 11:**

1. Download the latest `Auralis Pulse_X.Y.Z_x64-setup.exe` from [Releases](https://github.com/antonpme/auralis-pulse/releases/latest).
2. Run it. Current-user install, no admin needed.
3. Open from Start Menu. Pulse appears as a tray icon.

<details>
<summary>Permission forwarding (optional but recommended)</summary>

Add this hook to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "hooks": [
          { "type": "command", "command": "node ~/.claude/hooks/permission-forward.js" }
        ]
      }
    ]
  }
}
```

The hook script ships in this repo under `hooks/`. Copy it to `~/.claude/hooks/permission-forward.js`.

</details>

<details>
<summary>Build from source</summary>

Requires:
- [Rust](https://rustup.rs/) 1.83+
- [Node.js](https://nodejs.org/) 18+
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/antonpme/auralis-pulse.git
cd auralis-pulse
npm install
npm run tauri build
```

The installer lands in `src-tauri/target/release/bundle/nsis/`.

</details>

<details>
<summary>Autostart with Windows</summary>

Open Settings (gear icon in the top-right of the Pulse window) and toggle "Start with Windows". Stored as a per-user LaunchAgent.

</details>

## How it works

Three subsystems.

**Session monitoring.** Pulse reads Claude Code's session files from `~/.claude/sessions/` and JSONL transcripts from `~/.claude/projects/`. It refreshes locally every 30 seconds, free, no API calls needed. Process name verification prevents PID-reuse false positives when sessions die and Windows recycles their PIDs.

**Usage tracking.** Pulse calls the Anthropic OAuth usage API every 5 minutes, caches the response on disk (`%LOCALAPPDATA%\auralis-pulse\usage-cache.json`), and applies exponential backoff (5 -> 10 -> 20 -> 40 -> 60 min) on rate limits. Cached data shows immediately on startup; stale-but-cached beats waiting.

**Permission forwarding.** A lightweight HTTP server runs on `127.0.0.1:59428`. The CLI hook forwards permission requests there, Pulse shows them, and the decision flows back through the same connection. No data leaves your machine except the standard usage API call.

<details>
<summary>The per-PID command delivery: the technical bit</summary>

Sending text to a specific terminal process on Windows is harder than it sounds. `SendKeys` requires window focus, which doesn't survive when you have multiple Claude Code tabs open in Windows Terminal. SwitchToThisWindow can't reliably select a specific tab inside WT.

Pulse uses `AttachConsole(pid)` + `WriteConsoleInputW` to write directly to the target process's console input buffer:

- Bypasses window focus completely
- Works regardless of which tab is active in Windows Terminal
- Handles ConPTY pseudo-consoles correctly (where SendKeys synthetic input is filtered out)
- Per-PID precision: your other sessions stay untouched
- Bracketed paste mode (`ESC[200~ ... ESC[201~`) for multi-line text
- Two-phase write with 250ms delay so multi-line submits cleanly through ink/React TUI input handlers
- Auto-clear (Ctrl+U) before paste prevents accumulated leftover input from previous attempts
- SendKeys + SwitchToThisWindow as fallback if console attach fails (rare, but happens with some elevated processes)

The same path runs for `/compact` and for any custom command you define.

</details>

<details>
<summary>Window pinning on Windows 11</summary>

Borderless windows on Win11 carry an invisible DWM drop-shadow margin baked into `GetWindowRect`. Naively pinning the window using outer rect leaves a 5-8 px gap between visible edge and screen corner.

Pulse queries `DWMWA_EXTENDED_FRAME_BOUNDS` to get the visual rect, computes the shadow margin, then `SetWindowPos` with the offset so the visible edges land exactly on the work-area corner. Same code path on first build and on every tray show.

</details>

## Roadmap

- [x] **v1.3.** Custom commands, alert presets, per-PID delivery, auto-compact safety, pin sessions, DWM-aware window pinning, preset chip + modal picker
- [ ] **v1.4.** Cross-platform: macOS (.dmg) via iTerm2 Python API, Linux (.AppImage / .deb) with tmux-based delivery, GitHub Actions CI matrix, optional auto-update
- [ ] **v1.5.** Configurable keyboard shortcuts, session activity timeline, command chains
- [ ] **Future.** Discord callback integration, Tailscale + PWA for remote mobile access, plugin system

Full plan: [ROADMAP.md](ROADMAP.md)

## Contributing

Issues and PRs welcome. This started as a personal tool and grew. If you use Claude Code heavily on Windows, you might find the per-PID delivery worth keeping around.

## License

[MIT](LICENSE)
