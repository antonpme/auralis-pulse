# Auralis Pulse - Ideas

Ideas under discussion. Not committed to roadmap yet. Needs research, design, or validation.
When an idea is validated and scoped, move it to ROADMAP.md. When it ships, delete it from here.

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

**Note:** With the MCP server (v1.4.x) already exposing session state + control over HTTP, a chunk of the "serve control remotely" plumbing now exists. A mobile client could talk MCP directly instead of a bespoke PWA. Worth weighing before building a separate UI.

---

## Potential Future Ideas (raw, unfiltered)

Not yet built. (Session numbering, sorting, project filter, and the custom-commands library all shipped in v1.2-v1.3 and have moved out of this list.)

- **Cost tracker** - Estimate $ spent per session based on token counts and model pricing. Caveat: on a Max/CloudMax subscription this is largely irrelevant (flat fee), so it mainly serves pay-per-token API users.
- **Session templates** - Quick-launch Claude Code with predefined cwd + name + permissions
- **Session grouping** - Group related sessions (e.g., "frontend" + "backend" + "tests")
- **Notification rules** - "Notify me only when context > 80%" or "only for Bash permissions"
- **Session recording** - Save session timeline (when compacted, when permissions asked, etc.). Overlaps with the "session activity timeline" item on the roadmap.
- **Multi-machine** - Monitor Claude Code on multiple computers (home + work). The MCP server already gives a remote read/control surface to build on.
- **API for integrations** - Let other tools query Pulse (n8n, Raycast, Stream Deck). Largely subsumed by the MCP server now; this would be thin REST/webhook adapters on top for tools that don't speak MCP.
- **Command chains** - Crystallize, then wait for a "ready" signal, then Compact. Already noted on the roadmap's Future list; needs a completion-detection mechanism.

---

*This file is for brainstorming. When an idea is validated and scoped, move it to ROADMAP.md. When it ships, remove it from here so the list stays honest about what's still open.*
