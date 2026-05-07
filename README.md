<!--
  README - v1.3.5+ rewrite
  Hero cover: docs/cover.png (1280x640, three-theme staircase + wordmark)
  No triptych section. Single hero carries the visual weight.
-->

<p align="center">
  <img src="docs/cover.png" alt="Auralis Pulse" width="900">
</p>

<h1 align="center">Auralis Pulse</h1>

<p align="center">
  <em>Threshold auto-fire and per-PID command delivery for every Claude Code session you run.</em>
</p>

<p align="center">
  <a href="https://github.com/antonpme/auralis-pulse/releases/latest">
    <img src="https://img.shields.io/github/v/release/antonpme/auralis-pulse?style=flat-square&color=10b981&label=release" alt="Release">
  </a>
  <a href="https://v2.tauri.app/">
    <img src="https://img.shields.io/badge/built_with-Tauri_2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2">
  </a>
  <img src="https://img.shields.io/badge/rust-1.83-CE422B?style=flat-square&logo=rust&logoColor=white" alt="Rust">
  <img src="https://img.shields.io/badge/windows-10%20%2F%2011-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows 10/11">
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/antonpme/auralis-pulse?style=flat-square&color=8b5cf6" alt="MIT">
  </a>
  <img src="https://img.shields.io/github/downloads/antonpme/auralis-pulse/total?style=flat-square&color=eab308&label=downloads" alt="Downloads">
</p>

<p align="center">
  <a href="#why-pulse">Why</a> &middot;
  <a href="#vs-the-rest">vs. the rest</a> &middot;
  <a href="#install">Install</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#how-it-works">How it works</a> &middot;
  <a href="#roadmap">Roadmap</a>
</p>

---

> **TL;DR.** Lives in your tray. Watches every Claude Code session running on the box. Fires `/compact`, your custom Crystallize prompt, or any slash command into the exact session that needs it, before the context window crashes. Three themes. MIT.

<a id="why-pulse"></a>

## Why Pulse?

Most usage tools tell you what already happened. Pulse acts before it happens.

- **Tray-resident.** Always on, never in the way. Pin to the bottom-right corner of your work area.
- **Threshold auto-fire.** Wire `/compact` (or any prompt) to the 88% mark. 10-second cancel toast. Done.
- **Per-PID command delivery.** Sends keystrokes to the specific Claude Code terminal that owns the session. No focus stealing, no wrong-tab accidents.
- **Custom commands library.** Slash commands or multi-line natural language, anything your workflow needs.
- **Alert presets per session.** Worker / Architect / Soul roles each have their own ceilings.
- **Live everything.** Tokens, model, status, 5-hour and weekly burn, Sonnet quota.

<a id="vs-the-rest"></a>

## vs. the rest

The Claude Code tooling space is mostly read-only telemetry. Pulse is the only one that closes the loop and **actually sends commands when thresholds hit**.

| Tool | Form | Platforms | Live | Per-session | Auto-fire | Custom send |
|---|---|---|:-:|:-:|:-:|:-:|
| **Auralis Pulse** | Tray (Tauri 2) | Windows | ✅ | ✅ | ✅ | ✅ |
| [ccusage](https://github.com/ryoppippi/ccusage) | CLI | All | ❌ snapshot | ✅ report | ❌ | ❌ |
| [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | TUI | All | ✅ | ✅ 5h | ❌ | ❌ |
| [claudia](https://github.com/getAsterisk/claudia) | GUI desktop | All | ✅ analytics | ✅ history | ❌ | ❌ |
| [ClaudeBar](https://github.com/tddworks/ClaudeBar) | Menu bar | macOS | ✅ | partial | ❌ | ❌ |
| Built-in `/cost`, `/context` | Slash | In-session | on demand | current only | n/a | n/a |

**Where Pulse loses, honestly.** Windows-only today (mac + Linux are on the v1.4 roadmap). No retrospective analytics or charts (use ccusage for that). Smaller star count: we just shipped.

**Where Pulse wins.** Auto-fire commands at thresholds. Per-PID precision. Custom multi-line message injection. Tray-native on Windows, the gap nobody else fills.

<a id="install"></a>

## Install

**Windows 10 / 11**

1. Grab `Auralis Pulse_X.Y.Z_x64-setup.exe` from [Releases](https://github.com/antonpme/auralis-pulse/releases/latest)
2. Run it. Per-user install, no admin needed.
3. Open from Start Menu. Tray icon appears.

That's it.

<details>
<summary><b>Permission forwarding hook (recommended)</b></summary>

When Claude Code asks for permission (Bash, Write, Edit), Pulse can catch it and let you approve from the tray with `Y` allow / `A` always / `N` deny. Add this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PermissionRequest": [
      { "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/permission-forward.js" }] }
    ]
  }
}
```

The hook script lives under `hooks/` in this repo. Copy it to `~/.claude/hooks/permission-forward.js`.

</details>

<details>
<summary><b>Build from source</b></summary>

Prereqs: [Rust 1.83+](https://rustup.rs/), [Node.js 18+](https://nodejs.org/), [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/antonpme/auralis-pulse.git
cd auralis-pulse
npm install
npm run tauri build
```

Installer lands at `src-tauri/target/release/bundle/nsis/`.

</details>

<details>
<summary><b>Autostart with Windows</b></summary>

Open Settings (gear icon, top-right of the Pulse window) and toggle "Start with Windows". Stored as a per-user LaunchAgent.

</details>

<a id="features"></a>

## Features

### Per-PID command delivery

Send `/compact`, a custom Crystallize prompt, or any slash command into the exact session you target. Works across multiple Windows Terminal tabs. Doesn't steal focus. Doesn't disturb your other Claude Code instances.

Under the hood: `AttachConsole(pid)` plus `WriteConsoleInputW` direct to the target's console input buffer, with bracketed paste mode and a two-phase write for clean multi-line submission. Falls back to `SendKeys` for elevated processes.

See the [deep dive](#how-it-works) for the full mechanic.

### Active preset chip

Every session card shows the assigned preset (Default / Worker / Architect / Soul / your custom). Click the chip, swap the preset in a centered modal. Settings live by `session_id`, so a long-lived session keeps its config across Pulse restarts.

### Auto-fire on thresholds

Each preset has up to three tiers (warning / pre-critical / critical), and each tier carries:

- a token threshold (absolute number or %)
- desktop notification on/off
- a command to send (or none)

When a session crosses a tier, Pulse pops a 10-second countdown toast with a Cancel button. If you don't cancel, the command fires. Hysteresis prevents oscillation re-fires after compaction.

> **Real example.** Wire `/compact` to the 88% pre-critical tier on the Worker preset. When the session fills, Pulse fires it automatically. You stay in flow.

### Custom commands library

Build a library of commands once, use them across sessions. Each command carries:

- a name
- the slash command or natural language text
- single-line or multi-line (multi-line goes through clipboard paste, no SendKeys size limit)
- optional confirm prompt before sending

`Compact` ships seeded as a built-in.

### Live usage everything

- **5-hour window.** Burn rate, % used, reset countdown.
- **Weekly window.** Same metrics, longer horizon.
- **Sonnet quota.** Tracked separately from Opus.
- All cached on disk, exponential backoff (5 → 10 → 20 → 40 → 60 min) on rate limits.
- Stale-but-cached shows on boot. Never blocks the UI.

### Session list essentials

- **Color-coded fill levels.** Cards shift accent as context approaches the limit. Spot the hot one without reading numbers.
- **Filter** by status (active / idle / ghost) or by project root.
- **Sort** by context %, duration, last activity, or alphabetical. State persists.
- **Pin** important sessions to the top with the pushpin icon. Pinned cards stay visible even when filters hide everything else.
- **Ghost detection.** Sessions idle for 15 min flag IDLE. Orphaned sessions (60 min low context) flag GHOST. Dismiss individually.
- **Numbered cards** (#1, #2, #3) so you can reference them quickly when chatting with a teammate or filing an issue.

### Three themes

| Cyberpunk | Glassmorphism | Light |
|:--|:--|:--|
| neon green, sharp, terminal vibes | translucent dark, blue accents, airy | white, purple accent, editorial |

All theming token-based: change one CSS variable, the whole UI follows.

### Pin to corner

Bottom-right of the work area. DWM-aware: handles the invisible 5-8 px shadow margin that Win11 borderless windows carry, so the visible edge actually touches the screen corner. Same code path on first build and on every tray show.

### Auto-compact safety

Per-session opt-in checkbox. Even if a preset fires `/compact`, it's blocked unless you explicitly allowed it for that session. Defense in depth for long-running agents you don't want auto-compacting on you.

<a id="how-it-works"></a>

## How it works

Three subsystems.

**Renderer.** Reads `~/.claude/sessions/` and JSONL transcripts from `~/.claude/projects/`. Refreshes locally every 30 seconds, free, no API calls. Process-name verification prevents PID-reuse false positives when sessions die and Windows recycles their PIDs.

**Per-PID command delivery.** Bypasses focus and targets the right terminal even when you have multiple Claude Code tabs in Windows Terminal. Deep-dive below.

**Anthropic API.** OAuth usage call every 5 minutes. Disk cache at `%LOCALAPPDATA%\auralis-pulse\usage-cache.json`. Exponential backoff on 429.

<details>
<summary><b>Per-PID command delivery: the technical bit</b></summary>

Sending text to a specific terminal process on Windows is harder than it sounds. `SendKeys` requires window focus, which doesn't survive when you have multiple Claude Code tabs open in Windows Terminal. `SwitchToThisWindow` can't reliably select a specific tab inside WT.

Pulse uses `AttachConsole(pid)` plus `WriteConsoleInputW` to write directly to the target process's console input buffer:

- Bypasses window focus completely
- Works regardless of which tab is active in Windows Terminal
- Handles ConPTY pseudo-consoles correctly (where SendKeys synthetic input is filtered out)
- Per-PID precision: other sessions stay untouched
- Bracketed paste mode (`ESC[200~ ... ESC[201~`) for multi-line text
- Two-phase write with 250 ms delay so multi-line submits cleanly through ink/React TUI input handlers
- Auto-clear (Ctrl+U) before paste prevents accumulated leftover input from previous attempts
- `SendKeys` plus `SwitchToThisWindow` as a fallback if the console attach fails (rare; happens with elevated processes)

Same path runs for `/compact`, for any custom command you define, and for auto-fired threshold commands.

</details>

<details>
<summary><b>Window pinning on Windows 11</b></summary>

Borderless windows on Win11 carry an invisible DWM drop-shadow margin baked into `GetWindowRect`. Naively pinning to the work-area corner using the outer rect leaves a 5-8 px gap between the visible edge and the screen corner.

Pulse queries `DWMWA_EXTENDED_FRAME_BOUNDS` to get the visual rect, computes the shadow margin, then calls `SetWindowPos` with the offset so visible edges land exactly on the work-area corner. Same code path on first build and on every tray show.

</details>

<a id="roadmap"></a>

## Roadmap

- [x] **v1.3** Custom commands, alert presets, per-PID delivery, auto-compact safety, pin sessions, DWM-aware window pinning, preset chip, modal picker, DOM split for overlay isolation
- [ ] **v1.4** Cross-platform: macOS (.dmg) via iTerm2 Python API, Linux (.AppImage / .deb) with tmux send-keys, GitHub Actions CI matrix, optional auto-update
- [ ] **v1.5** Configurable keyboard shortcuts, session activity timeline, command chains (Crystallize, then wait, then Compact)
- [ ] **Future** Discord callback integration, Tailscale plus PWA for remote mobile access, plugin system

Full plan: [ROADMAP.md](ROADMAP.md)

## Contributing

Issues and PRs welcome. Pulse started as a personal tool and grew. If you use Claude Code heavily on Windows, the per-PID delivery and threshold auto-fire might be worth keeping around.

## License

[MIT](LICENSE) © 2026
