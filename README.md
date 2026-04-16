# Auralis Pulse

**Your Claude Code sessions at a glance.** System tray companion that monitors context usage, forwards permission requests, and tracks your subscription limits in real time.

Stop guessing how much context is left. Stop missing permission popups buried in your terminal. Pulse keeps you in control.

## What it does

**Session monitoring** - See every active Claude Code session with token usage, model info, duration, compaction count, and PID. Sessions are color-coded by context fill level (green, yellow, orange, red). Numbered #1, #2, #3 for quick reference.

**Filter & sort** - Filter sessions by status (active/idle/ghost) or project (cwd). Sort by context %, duration, last activity, or alphabetically. State persisted across restarts.

**Permission forwarding** - When Claude Code asks for permission (Bash, Write, Edit), Pulse catches it via hook, shows a desktop notification with sound, and lets you approve or deny from the tray popup. Keyboard shortcuts: **Y** allow, **A** always allow, **N** deny.

**Usage tracking** - Live burnrate bars for your 5-hour session limit, weekly limit, and Sonnet-specific limit. See exactly when each window resets. Extra usage spending displayed if enabled.

**Themes** - Three built-in themes: Cyberpunk (dark, neon), Glassmorphism (translucent, rounded), Light (clean, purple). All settings persisted across restarts.

**Settings panel** - Always on top, auto-hide on blur, autostart, tray metric selector, theme picker. Gear icon in header or from tray menu.

**Ghost detection** - Sessions that go idle (>15min) or become orphaned (>60min with low context) are automatically flagged as IDLE or GHOST. Dismiss them individually from the session card.

**Compact trigger** - Hit the compact icon on any session card to send the `/compact` command to that CLI session.

## Screenshot

![Auralis Pulse](https://raw.githubusercontent.com/antonpme/auralis-pulse/main/screenshot.jpg)

## Install

### Windows (pre-built)

Download the latest installer from [Releases](https://github.com/antonpme/auralis-pulse/releases).

### Build from source

Requires: [Rust](https://rustup.rs/), [Node.js](https://nodejs.org/) 18+, [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/antonpme/auralis-pulse.git
cd auralis-pulse
npm install
npm run tauri build
```

The installer will be in `src-tauri/target/release/bundle/nsis/`.

## Setup

### Permission forwarding (optional but recommended)

Add this hook to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/permission-forward.js"
          }
        ]
      }
    ]
  }
}
```

Then create `~/.claude/hooks/permission-forward.js` (included in the repo under `hooks/`).

### Autostart

Open Settings (gear icon) and toggle "Start with Windows".

## How it works

Pulse reads Claude Code's session files from `~/.claude/sessions/` and JSONL transcripts from `~/.claude/projects/`. It calls the Anthropic OAuth usage API every 5 minutes for burnrate data. No data leaves your machine except the standard usage API call.

For permissions, a lightweight HTTP server runs on `127.0.0.1:59428`. The CLI hook forwards requests there, Pulse shows them in the UI, and returns the decision back through the same HTTP connection.

## Tech stack

- **Backend**: Rust + Tauri 2 + Axum (HTTP server) + Tokio (async)
- **Frontend**: Vanilla JS + Vite (zero frameworks, fast)
- **Desktop**: System tray, always-on-top popup, NSIS installer
- **Size**: ~4MB installed

## Roadmap

**v1.2** (current) - Filter/sort dropdowns, session numbering, unified button heights, relaxed idle/ghost thresholds, lots of UI polish

**v1.3** - Context window alerts (per-session thresholds, optional auto-compact), configurable keyboard shortcuts

**v1.4** - Cross-platform (macOS, Linux), auto-update, GitHub Actions CI

Full roadmap: [ROADMAP.md](ROADMAP.md)

## Contributing

Issues and PRs welcome. This started as a personal tool and grew into something the Claude Code community might find useful.

## License

MIT
