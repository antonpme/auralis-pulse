# Auralis Pulse

**Your Claude Code sessions at a glance.** System tray companion that monitors context usage, forwards permission requests, and tracks your subscription limits in real time.

Stop guessing how much context is left. Stop missing permission popups buried in your terminal. Pulse keeps you in control.

## What it does

**Session monitoring** - See every active Claude Code session with token usage, model info, duration, compaction count, and PID. Sessions are color-coded by context fill level (green, yellow, orange, red).

**Permission forwarding** - When Claude Code asks for permission (Bash, Write, Edit), Pulse catches it via hook, shows a desktop notification with sound, and lets you approve or deny from the tray popup. No more alt-tabbing to the terminal.

**Usage tracking** - Live burnrate bars for your 5-hour session limit, weekly limit, and Sonnet-specific limit. See exactly when each window resets. Extra usage spending displayed if enabled.

**Ghost detection** - Sessions that go idle or become orphaned are automatically flagged as IDLE or GHOST. Dismiss them individually or clean all ghosts with one click.

**Compact trigger** - Hit COMPACT on any session card to send the `/compact` command to that CLI session.

## Screenshot

![Auralis Pulse](https://raw.githubusercontent.com/antonpme/auralis-pulse/main/screenshot.png)

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

Right-click the tray icon and toggle "Start with Windows".

## How it works

Pulse reads Claude Code's session files from `~/.claude/sessions/` and JSONL transcripts from `~/.claude/projects/`. It calls the Anthropic OAuth usage API every 5 minutes for burnrate data. No data leaves your machine except the standard usage API call.

For permissions, a lightweight HTTP server runs on `127.0.0.1:59428`. The CLI hook forwards requests there, Pulse shows them in the UI, and returns the decision back through the same HTTP connection.

## Tech stack

- **Backend**: Rust + Tauri 2 + Axum (HTTP server) + Tokio (async)
- **Frontend**: Vanilla JS + Vite (zero frameworks, fast)
- **Desktop**: System tray, always-on-top popup, NSIS installer
- **Size**: ~4MB installed

## Roadmap

**v1.1** - Settings panel, themes (Cyberpunk, Glassmorphism, Light, macOS), keyboard shortcuts for permissions

**v1.2** - macOS and Linux builds, auto-update, GitHub Actions CI

**v1.3** - Session activity graphs, cost estimation, plugin system

Full roadmap: [ROADMAP.md](ROADMAP.md)

## Contributing

Issues and PRs welcome. This started as a personal tool and grew into something the Claude Code community might find useful.

## License

MIT
