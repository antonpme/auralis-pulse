# Auralis Pulse - Engineering Lessons

Retrospective notes on bugs that bit us, so we don't repeat them.

---

## 2026-05-22: Smoke-test the HTTP server before claiming "Phase 1 done"

**What happened.** Shipped v1.4.0-dev with MCP Phase 1: nested a tower-http MCP service under the same axum Router as the permission routes, on port 59428. The whole HTTP listener silently failed to bind. Result: permission popups stopped working for two days before noticed.

**Why it was invisible.** Pulse builds with `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` in release. That strips stdout/stderr. `eprintln!` from the spawned server task went nowhere. The bind failure (or whatever axum panic caused it) was completely silent.

**Root cause hypothesis.** Mounting an MCP `nest_service("/", service)` with `.layer(auth)` into a parent axum Router via `.nest("/mcp", router)` likely panicked at startup or first request. Could not reproduce post-fix because we split the architecture before diagnosing precisely.

**Fix.** Two changes, both worth keeping:
1. Architectural: split the MCP server onto its own port (59429) with its own listener. Failure domains stay separate.
2. Operational: file logger (`pulse_log` module) that writes timestamped lines to `%LOCALAPPDATA%\auralis-pulse\pulse.log`. All critical startup paths log here. Silent failures are no longer possible.

**Rule.** When changing anything in the HTTP server, MCP service, or any spawned tokio task at startup: smoke-test by running a debug build and confirming the listener actually binds. `cargo check` does not catch runtime panics in spawned tasks.

---

## 2026-05-22: Autostart preference belongs in our state, not the registry

**What happened.** Ton's "Start with Windows" toggle reset every reinstall. Investigation revealed two compounding causes:

1. `tauri-plugin-autostart::is_enabled()` compares `current_exe()` to the registered registry value. After a dev build registered `target\debug\auralis-pulse.exe`, the prod install at `%LOCALAPPDATA%\Auralis Pulse\auralis-pulse.exe` showed the toggle as off forever.
2. NSIS uninstaller removes the `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Auralis Pulse` entry as part of cleanup on every upgrade install.

Both modes left the registry out of sync with the user's actual intent, with no way to recover the intent automatically.

**Fix.** Persist the user's preference in `%LOCALAPPDATA%\auralis-pulse\settings.json` (a directory NSIS does not clean), use the registry as the mechanism to fulfill that intent. On every Pulse startup, if `pref == true` but registry is out of sync, re-enable to write the current exe path. `get_autostart` returns the pref, not the registry state.

**Rule.** When using `tauri-plugin-autostart` (or any OS-level setting with similar drift potential), do not treat the OS state as the source of truth. The user's recorded intent is. Sync the OS state to intent on every relevant lifecycle event.

---

## 2026-05-22: Anthropic OAuth usage API field `resets_at` is nullable

**What happened.** Pulse usage panel stuck at "Updated 5d ago" with no UI signal. Background loop quietly retried every 5 minutes for days.

**Root cause.** Anthropic started returning `"resets_at": null` on inactive limits (e.g., `seven_day_sonnet` when Sonnet hasn't been used this week). Pulse's `UsageLimit` struct typed `resets_at: String` (required), so serde parse failed on every fetch since approximately 2026-05-15. The error message "missing field" was not detected as a rate limit, so the loop slept 5 minutes between retries forever.

**Fix.** `resets_at: Option<String>`. Frontend `formatTimeLeft()` already handled null gracefully. Also stopped swallowing errors in the manual refresh button (empty `catch (_) {}` → toast with the error message).

**Rule.** Treat third-party API schemas as eventually-nullable on every optional-looking field. Default to `Option<T>` for any field that doesn't carry semantic meaning when empty. When a fetch loop encounters a non-success result, surface it visibly somewhere the user can find (toast, log file, status badge) so the next time something silently breaks, we know.

---

## 2026-05-24: `rmcp::Json<T>` returns silently break MCP init (v1.4.1 Phase 2)

**What happened.** Shipped a build of MCP Phase 2 with five read tools using typed structured-output returns: `Json<Vec<SessionInfo>>`, `Json<SessionInfo>`, `Json<serde_json::Value>`. `cargo check` passed. Server bound both ports. Then every MCP client (Claude Code, hand-rolled curl, Python urllib) hit "Failed to connect" / empty TCP reply on the very first `initialize` request. The server did not panic, did not log, did not exit. It just stopped responding to that one request type.

**Root cause hypothesis.** rmcp 1.7 builds an output schema for each `#[tool]` return type at first-request time using `schema_for_output<T: JsonSchema + 'static>`. With `schemars = "1"` (which we had to use to match rmcp's re-export and pass type checking on our `JsonSchema` derives), something in that schema generation path either panics inside the tower service or returns an error rmcp's macro-generated dispatcher then propagates as a connection drop. Could not pinpoint the exact failure because release builds suppress stderr and the failure happens inside an rmcp-internal panic boundary.

**Bisect path.** Comment out all five typed-return tools, leaving only `pulse_ping` (returns `String`) plus full state injection: `claude mcp list` → ✓ Connected. Restore all five tools but rewrite returns as `String` with `serde_json::to_string(&value)`: ✓ Connected and every tool returns correct payloads. State injection itself is fine.

**Fix.** Phase 2 tools return `String` (JSON-stringified). Tool descriptions advertise "Returns a JSON array/object string" so callers know to parse once. `Parameters<GetSessionParams>` with `#[derive(JsonSchema)]` on params is fine, only `Json<T>` on returns triggers the fault. `Result<String, ErrorData>` for fallible tools also fine.

**Rule.**
1. When integrating an SDK with macro-generated handlers and a re-exported schema crate (rmcp + schemars, axum + tower, etc.), test every distinct return-type shape against a real client before assuming it works. `cargo check` only proves Rust types align; runtime macro expansion lives in a different universe.
2. Keep a checked-in smoke test (`scripts/mcp_smoke.py`) that drives the full client handshake. Run it after every change to `mcp.rs`. Cheap insurance against regressions.
3. When investigating "server is alive on port but drops specific requests", the first hypothesis should be schema/macro runtime failure, not network or auth.

---

## 2026-05-24: MCP write tools that mutate frontend state need an event round-trip, not a direct write (v1.4.2 Phase 3)

**What happened.** Designing `pulse_assign_preset`, the obvious shape was: take `session_id` + `preset_id`, mutate `user_data["sessionPresets"]` in the Rust-side `Arc<Mutex<Value>>`, done. Tested in isolation it works. But the frontend owns `settings.sessionPresets` in JS memory + localStorage, and it overwrites the Rust mirror on every CRUD via `sync_user_data`. So an MCP-side write would be silently nuked the next time the user toggled any setting in the UI.

**Root cause.** Two sources of truth for the same data. Frontend's `localStorage` and Rust's `Arc<Mutex<Value>>` are kept in sync ONE direction (`syncUserData()` pushes JS → Rust). Anything Rust writes alone is racing with the next push.

**Fix.** Round-trip through the frontend. MCP tool:
1. Validates `preset_id` against the current preset library (read-only check on `user_data`).
2. Emits a Tauri event (`mcp-assign-preset`) with `{ session_id, preset_id }` payload via `app_handle.emit(...)`.
3. Returns immediately with "dispatched" status.

Frontend listener:
1. Receives the event.
2. Re-validates preset still exists (race-safe).
3. Mutates `settings.sessionPresets[session_id] = preset_id`.
4. Calls `saveSessionPresets()`, which persists to localStorage AND triggers the normal `syncUserData()` push back to Rust.
5. Re-renders + toasts.

Required `PulseMcpState` to hold an `AppHandle` (added via Phase 3 refactor). Now any future write tool that needs to mutate frontend-owned state has a working pattern.

**Trade-off.** Eventually consistent. The MCP tool's success response means "dispatched", not "applied". A client calling `pulse_list_presets` immediately after `pulse_assign_preset` might briefly see the old value (within ~100ms). Acceptable for the use case.

**Rule.** If two layers own the same data and only one direction is synced (JS → Rust here), don't let the other layer write directly. Route writes through the syncing layer so reconciliation is automatic. The `AppHandle` injection pattern is the right shape: MCP tools nudge the UI, the UI is the source of truth, Rust is the read mirror.

---

## 2026-05-24: MCP write tools must broadcast notifications themselves, not rely on the periodic loop (v1.4.4 Phase 4)

**What happened.** Wired Phase 4 server-pushed notifications. Added a 5-minute loop broadcast for `usage-updated` after every successful Anthropic OAuth fetch. Wrote a smoke test that triggers `pulse_refresh_usage` (the MCP tool) and listens on the standalone GET /mcp SSE stream for the `usage-updated` notification. Tool returned fresh data; smoke test got nothing. `pulse.log` showed `client connected, total peers=1` but no `broadcast` lines.

**Root cause.** The MCP tool `pulse_refresh_usage` mutates the cached usage state and emits a Tauri event for the UI, but it never called `broadcast_pulse_event`. The 5-minute loop does the broadcast, but the smoke test ran within seconds of process start, long before the loop had completed its next iteration. Result: tool-triggered state mutation, no notification, smoke test fail.

**Fix.** Added `broadcast_pulse_event(&self.state.peers, "usage-updated", slim).await` inside the `pulse_refresh_usage` tool body. Same slim payload shape as the 5-min loop emits. Smoke test now passes within ~1 second of triggering the tool.

**Rule.** When the same state is mutated by both a periodic loop AND an on-demand tool/command, any notification side-effect must fire from BOTH paths, not just the loop. Otherwise tool-initiated state changes look invisible to subscribers until the next loop tick. This is the same shape as cache-invalidation: the producer always knows when state changed; the schedule never does.

**Bonus.** Diagnostic logging (`broadcast X: sending to N alive peers`, `broadcast X done: success=Y failure=Z`) immediately surfaced the absence of broadcast attempts. Kept it on. At 6 lines per peer per hour during normal operation, the visibility-for-bytes trade is worth it.

---

## 2026-05-28: Auto-update changes the ship ritual and adds a single point of failure (v1.4.7)

**What changed.** Shipping the Tauri 2 updater means every release from v1.4.7 on has a new, non-optional ritual. Miss a step and auto-update silently does nothing (no error, just no update ever appears for users).

**The new ship sequence (do not skip a step):**
1. Bump `version` in BOTH `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. The updater only triggers when `latest.json` `version` is strictly greater than the running app's SemVer.
2. Build WITH the signing key in the environment:
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/auralis-pulse.key)
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
   npm run tauri build
   ```
   Without the env var, `tauri build` does NOT silently skip signing - it FAILS: `A public key has been found, but no private key. Make sure to set TAURI_SIGNING_PRIVATE_KEY environment variable.` (Confirmed on a CI Windows runner 2026-05-31. Earlier this note claimed the build succeeds without a .sig; that was wrong. With a pubkey present in tauri.conf.json, the private key is mandatory and the build aborts without it.) Trap #1 is therefore loud, not silent - but it bites in CI where you forget to wire the key as a secret.
3. `python scripts/make_latest_json.py --notes "..."` to assemble `latest.json` from the freshly built `.sig`.
4. `gh release create vX.Y.Z ... "<installer>.exe" "latest.json"` — attach BOTH. The updater endpoint is `releases/latest/download/latest.json`, so `latest.json` MUST live on the newest release or clients never see the new version. Silent trap #2.
5. Verify end-to-end: `curl -sL https://github.com/antonpme/auralis-pulse/releases/latest/download/latest.json` and confirm it returns the new version.

**The single point of failure.** The Ed25519 private key at `~/.tauri/auralis-pulse.key` is the ONLY key that can sign updates the installed base will accept (its public half is baked into every shipped binary via `tauri.conf.json`). Lose it and you cannot ship another auto-update: every existing user is stranded and must manually reinstall a build with a new pubkey. Back it up off-machine (password manager / cloud). This is not code, it cannot be regenerated to match what's already deployed.

**Other silent traps.**
- `bundle.createUpdaterArtifacts: true` must stay on. If it's removed, no `.sig`, same as forgetting the env var.
- pubkey in `tauri.conf.json` must match the private key used at build time. Mismatch = signature verification fails silently on the client.
- The updater's Ed25519 signature is INDEPENDENT of Windows code-signing. We don't code-sign, so users still get a SmartScreen warning on the first manual install, but auto-update itself works fine without an Authenticode cert.

**Rule.** Any release mechanism with a cryptographic signature has an off-repo secret that is a hard dependency for the entire installed base. Treat that key like production database credentials: backed up, never committed, and documented so the next person (or the next you) knows the ritual. A checked-in script (`make_latest_json.py`) plus this lesson is the cheapest insurance against a silent broken-update channel.

---

## 2026-05-31: First cross-platform CI proved the build; artifact upload was the only snag (v1.5 groundwork)

**What we proved.** A `workflow_dispatch` GitHub Actions matrix (`tauri-apps/tauri-action`) compiles Pulse on macOS (aarch64 + x86_64), Linux (ubuntu-22.04), and Windows. All four jobs go green. Free on public repos. The Rust code's existing `#[cfg(windows)]` / `#[cfg(not(windows))]` gating paid off: non-Windows compiled with zero source changes. macOS even produced real `.dmg` bundles for both arches; Linux produced `.deb` + `.AppImage`. Build logs show the exact bundle paths, e.g. `src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/Auralis Pulse_1.4.7_x64.dmg`.

**Snag 1 - signing in CI.** `createUpdaterArtifacts: true` makes the build REQUIRE the signing key (it does not silently skip - see the prior lesson). On a CI runner with no key, the Windows job failed. Fix for a pure compile-test: a tiny pre-build step flips `createUpdaterArtifacts` to false at runtime (`node -e` editing the runner's copy of tauri.conf.json), committed config untouched. We deliberately did NOT put the private key in GitHub Secrets - that's a real decision (a copy of the SPOF key living in the cloud) to make consciously when we do signed cross-platform RELEASES, not compile tests.

**Snag 2 - `actions/upload-artifact@v4` would not capture the mac/linux bundles.** This ate three extra CI runs. The bundle exists on the runner at the exact path given, yet `upload-artifact` reports "No files were found." Windows (`target/release/bundle/...`, default target) uploads fine; mac (`target/<triple>/release/bundle/...`) and Linux uploaded nothing. Tried recursive `**` globs and then explicit per-bundle paths read straight from the logs - neither captured the non-default-target paths. Root cause not pinned (likely an `@actions/glob` / common-root quirk with multi-line paths spanning different target dirs).

**The call: stop, because upload-artifact is not on the critical path.** Real cross-platform releases will use `tauri-action`'s built-in release upload (`tagName` / `releaseId`), which knows its own bundle paths and attaches `.dmg`/`.AppImage`/`.deb` directly to the GitHub Release. `upload-artifact` was only a "let me download and eyeball the bundle" convenience. Burning more CI runs to fix a side path while the main path (tauri-action release) sidesteps it entirely is waste.

**Rule.** When a verification step (here: downloading the artifact) keeps failing but the thing it was meant to verify is already proven another way (here: build logs show the bundle was created), stop polishing the verification and bank the proof. Match effort to the critical path: for cross-platform releases, drive uploads through `tauri-action`'s release integration, not `actions/upload-artifact`. Revisit upload-artifact only if we ever genuinely need workflow-artifact downloads (we probably won't).

---

## 2026-06-12: Model context window is marker-driven, and evidence must match the entry point (v1.4.8 Fable 5)

**What happened.** Pulse did not recognise the new Fable 5 model: `claude-fable-5` fell into the unknown-family branch of `parse_model_string`, showing a raw name and a hardcoded 200K ceiling instead of its real 1M window. Two fixes: add `fable` as a known family, and make the 1M window driven by the `[1m]` marker in the id (e.g. `claude-opus-4-8[1m]`) instead of hardcoded per family. The label now surfaces `[1m]` when there's positive evidence (explicit marker, or fable).

**The investigation misstep, and the real lesson.** To decide Fable's window I first pointed at session transcripts that had burned 400K+ input tokens on a `claude-fable-5` string, and called that proof it was 1M. Ton caught it: those were **Claude Desktop** sessions where he had manually picked "Fable 5 (1M context)" in the model picker. They proved that *one manually-selected Desktop variant* was 1M. They proved nothing about what **CLI** Fable (`claude --model claude-fable-5`) defaults to, which is what Pulse mostly monitors. Same model string, different entry point, different guarantee. We then verified the CLI directly with `/context` (Claude Code v2.1.175): `33k/1m tokens`, `Free space: 967k` - CLI Fable defaults to 1M. Fix grounded in a fact from the right entry point, not an inference from the wrong one.

**Known limitation, documented in code.** The 200K and 1M Fable picker entries both write the bare `claude-fable-5` with no marker, so they are indistinguishable from the transcript. We default to 1M because that is the confirmed CLI default; a hypothetical 200K-Fable user would be shown a 1M ceiling. There is no signal to fix that today.

**Rule.** Evidence has provenance. Before you treat a measurement as proof of a behaviour, check that it came from the *same context, entry point, and configuration* you are making the claim about. A token count proves the window of the session it came from, not of a different launch path that happens to share a model string. When the entry point that matters is reachable, measure it directly (here: `/context` on a CLI session) rather than inferring from an adjacent one. Also: 8 unit tests now pin `parse_model_string` against the live model strings, same insurance as the smoke test - model ids are exactly the kind of third-party string that drifts.

**Bonus (process win).** This shipped as v1.4.8 and was the **first live test of the v1.4.7 auto-updater**. Ton's installed v1.4.7 detected v1.4.8, showed the `Update available [Install]` toast, downloaded, installed in passive mode, relaunched, and the running app confirmed `fable-5[1m]` / `1.0M` in the UI. The whole self-update loop, built blind and never run end to end, worked on its first real release. Bootstrap closed.
