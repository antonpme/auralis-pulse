# Auralis Pulse - Ideas

Ideas under discussion. Not committed to roadmap yet. Needs research, design, or validation.

---

## Remote Mobile Access

**Problem:** User leaves home with 3-5 CLI sessions running. Sessions need permission approvals, compaction, monitoring. Currently no way to manage remotely.

**Concept:** PWA accessible from phone, anywhere. Pulse serves its UI over HTTP, phone connects via mesh VPN (Tailscale/similar). Zero cloud infrastructure, data stays between user's own devices.

**User flow:**
1. Settings -> Remote Access -> ON
2. Pulse shows QR code with Tailscale URL
3. Scan from phone, PWA opens
4. Permissions arrive as push notifications
5. Approve/deny/compact from anywhere

**Why Tailscale:** Free for 100 devices, mesh VPN (device-to-device, no relay server), works across any network. No Auralis infrastructure needed, no user data through our servers.

**Why not LAN-only:** The whole point of mobile is being outside the home network. LAN mode is trivial but misses the core use case.

**Why not our cloud:** Privacy concerns (user data through our server), infrastructure costs, auth complexity. Tailscale solves all of this at zero cost.

**Prerequisites:** Responsive CSS for mobile viewport, touch-friendly buttons, push notification support via PWA service worker.

---

## Custom Commands (Remote Session Control)

**Problem:** Users have custom workflows beyond just "compact". Example: crystallization (saving session knowledge to memory before compaction), running tests, triggering handoffs, etc. Currently requires direct terminal access or Discord bots.

**Concept:** Instead of a single COMPACT button, Pulse offers a command selector + SUBMIT button. Users define custom commands in settings, then send them to any active session.

**How it works:**
1. Settings -> Custom Commands -> add commands (name + slash command or text)
   - Example: "Crystallize" -> "/crystallize"
   - Example: "Compact" -> "/compact"  
   - Example: "Run tests" -> "run the test suite and report results"
   - Example: "Handoff" -> "/handoff"
2. Session card shows: [command dropdown] [SUBMIT]
3. User picks command, hits submit, command is sent to that CLI session
4. Session processes it, Pulse shows confirmation when done

**Technical research needed:**

| Platform | Can we send input? | Method | Confidence |
|----------|-------------------|--------|------------|
| CLI (terminal) | Likely yes | SendKeys (current compact approach), or stdin pipe, or Tauri shell plugin | High |
| Claude Desktop | Probably no | No known API to inject user messages into desktop app | Low |
| VS Code extension | Unknown | VS Code extension API might allow sending to integrated terminal, but requires cooperation from the extension | Needs research |

**Key insight:** This transforms Pulse from a monitor into a remote control. Combined with mobile access, users can orchestrate multiple AI sessions from their phone.

**Design considerations:**
- Command templates should be shareable (export/import JSON)
- Some commands need confirmation ("are you sure you want to compact?")
- Command execution status: pending -> running -> done/failed
- Commands that produce output: show result summary in Pulse

---

## Potential Future Ideas (raw, unfiltered)

- **Session grouping** - Group related sessions (e.g., "frontend" + "backend" + "tests")
- **Cost tracker** - Estimate $ spent per session based on token counts and model pricing
- **Session templates** - Quick-launch Claude Code with predefined cwd + name + permissions
- **Notification rules** - "Notify me only when context > 80%" or "only for Bash permissions"
- **Session recording** - Save session timeline (when compacted, when permissions asked, etc.)
- **Multi-machine** - Monitor Claude Code on multiple computers (home + work)
- **API for integrations** - Let other tools query Pulse (n8n, Raycast, Stream Deck)

---

*This file is for brainstorming. When an idea is validated and scoped, move it to ROADMAP.md.*
