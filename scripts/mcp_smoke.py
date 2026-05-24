#!/usr/bin/env python3
"""Smoke-test the Auralis Pulse MCP server end-to-end.

Performs the full Streamable HTTP MCP handshake (initialize ->
notifications/initialized -> tools/list -> tools/call * 6) using only the
Python stdlib. Run manually after shipping a new build to verify the MCP
surface is alive before tagging a release.

Usage:
    python scripts/mcp_smoke.py

Reads port + token from %LOCALAPPDATA%/auralis-pulse/mcp.json.
"""

from __future__ import annotations
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def load_config() -> tuple[str, str]:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    cfg_path = Path(base) / "auralis-pulse" / "mcp.json"
    cfg = json.loads(cfg_path.read_text())
    return cfg["url"], cfg["token"]


URL, TOKEN = load_config()
SESSION_ID: str | None = None


def post(method: str, params: Any = None, *, req_id: int | None = 1, notification: bool = False) -> tuple[Any, dict[str, str]]:
    """POST a JSON-RPC frame to /mcp and return (parsed_body, response_headers)."""
    global SESSION_ID
    body: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
    if not notification:
        body["id"] = req_id
    if params is not None:
        body["params"] = params

    data = json.dumps(body).encode()
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    if SESSION_ID:
        headers["Mcp-Session-Id"] = SESSION_ID

    req = urllib.request.Request(URL, data=data, headers=headers, method="POST")
    try:
        resp = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")
        return {"_http_error": e.code, "_body": msg}, dict(getattr(e, "headers", {}) or {})

    # Normalise headers to lowercase keys; http.client lowercases on some
    # platforms but not others, so don't trust the casing from urllib.
    resp_headers = {k.lower(): v for k, v in dict(resp.headers).items()}
    new_sid = resp_headers.get("mcp-session-id")
    if new_sid:
        SESSION_ID = new_sid

    raw = resp.read().decode()
    ctype = resp_headers.get("content-type", "")

    if not raw:
        return None, resp_headers

    if "text/event-stream" in ctype:
        # SSE: skip keepalive frames (empty `data:` lines) and parse the first
        # non-empty data payload. rmcp emits a keepalive event before the real
        # JSON-RPC response in chunked streams.
        for line in raw.splitlines():
            if line.startswith("data: "):
                payload = line[6:].strip()
                if not payload:
                    continue
                return json.loads(payload), resp_headers
        return {"_sse_no_data": raw[:200]}, resp_headers

    return json.loads(raw), resp_headers


def banner(title: str) -> None:
    print(f"\n=== {title} ===")


def show(obj: Any, limit: int = 800) -> None:
    text = json.dumps(obj, indent=2, ensure_ascii=False)
    if len(text) > limit:
        text = text[:limit] + f"\n... (+{len(text) - limit} more chars)"
    print(text)


def extract_structured(call_result: Any) -> Any:
    """Pull the structured payload out of a tools/call response, regardless of
    whether the tool returned a Json<T> (structuredContent) or a plain
    String (content[0].text)."""
    if not isinstance(call_result, dict):
        return None
    res = call_result.get("result") or call_result
    if "structuredContent" in res:
        return res["structuredContent"]
    content = res.get("content")
    if isinstance(content, list) and content:
        first = content[0]
        if first.get("type") == "text":
            return first.get("text")
    return res


def main() -> int:
    print(f"Probing {URL}")
    print(f"Token (first 12 chars): {TOKEN[:12]}...")

    banner("initialize")
    init_res, init_hdr = post("initialize", {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "pulse-smoke-test", "version": "0.1.0"},
    })
    show(init_res, limit=600)
    print(f"Session-Id: {SESSION_ID}")
    if not SESSION_ID:
        print("FAIL: no session id returned", file=sys.stderr)
        return 1

    post("notifications/initialized", notification=True)

    banner("tools/list")
    tools_res, _ = post("tools/list", req_id=2)
    tools = (tools_res.get("result") or {}).get("tools", []) if isinstance(tools_res, dict) else []
    print(f"Tool count: {len(tools)}")
    for t in tools:
        print(f"  - {t.get('name')}: {(t.get('description') or '')[:80]}")

    expected = {
        # Phase 1
        "pulse_ping",
        # Phase 2 (read)
        "pulse_list_sessions", "pulse_get_session", "pulse_get_usage",
        "pulse_list_presets", "pulse_list_commands",
        # Phase 3 (write)
        "pulse_send_command", "pulse_assign_preset",
        "pulse_refresh_usage", "pulse_clear_usage_cache",
    }
    actual = {t.get("name") for t in tools}
    missing = expected - actual
    extra = actual - expected
    if missing:
        print(f"MISSING tools: {missing}")
    if extra:
        print(f"EXTRA tools (ok if Phase 4+ landed): {extra}")

    def call(name: str, args: dict | None = None, rid: int = 10):
        body, _ = post("tools/call", {"name": name, "arguments": args or {}}, req_id=rid)
        return body

    banner("pulse_ping")
    show(extract_structured(call("pulse_ping", rid=10)), limit=200)

    banner("pulse_list_sessions")
    sessions_call = call("pulse_list_sessions", rid=11)
    sessions_payload = extract_structured(sessions_call)
    show(sessions_payload, limit=1200)

    banner("pulse_get_usage")
    show(extract_structured(call("pulse_get_usage", rid=12)), limit=900)

    banner("pulse_list_presets")
    show(extract_structured(call("pulse_list_presets", rid=13)), limit=1500)

    banner("pulse_list_commands")
    show(extract_structured(call("pulse_list_commands", rid=14)), limit=600)

    # Pick a session_id from the live list and exercise pulse_get_session.
    first_session_id = None
    if isinstance(sessions_payload, list) and sessions_payload:
        first_session_id = sessions_payload[0].get("session_id")
    elif isinstance(sessions_payload, dict):
        # rmcp may wrap Vec<T> in { "items": [...] } — try common keys
        for key in ("items", "value", "0"):
            if key in sessions_payload:
                v = sessions_payload[key]
                if isinstance(v, list) and v:
                    first_session_id = v[0].get("session_id")
                    break

    banner("pulse_get_session")
    if first_session_id:
        print(f"Using session_id: {first_session_id}")
        show(extract_structured(call("pulse_get_session",
                                     {"session_id": first_session_id}, rid=15)), limit=600)
    else:
        print("No live sessions to test get_session with; skipping.")

    banner("pulse_get_session (negative case)")
    show(extract_structured(call("pulse_get_session",
                                 {"session_id": "DOES-NOT-EXIST-zzz"}, rid=16)), limit=400)

    # -------------- Phase 3 write tools --------------

    banner("pulse_send_command (negative: bogus PID)")
    # Never inject into a real session from the smoke test - too destructive.
    # Bogus PID gives us a clean error-path verification.
    show(extract_structured(call("pulse_send_command",
                                 {"pid": 999999, "text": "/cost"}, rid=20)), limit=400)

    banner("pulse_assign_preset (negative: unknown preset_id)")
    show(extract_structured(call("pulse_assign_preset",
                                 {"session_id": first_session_id or "any",
                                  "preset_id": "preset-DOES-NOT-EXIST"}, rid=21)), limit=400)

    if first_session_id:
        banner("pulse_assign_preset (positive)")
        # Re-assign the first session to preset-default. Safe + idempotent.
        # Pulse UI will toast "Preset -> Default (via MCP)" if the listener fires.
        show(extract_structured(call("pulse_assign_preset",
                                     {"session_id": first_session_id,
                                      "preset_id": "preset-default"}, rid=22)), limit=400)

    banner("pulse_clear_usage_cache")
    show(extract_structured(call("pulse_clear_usage_cache", rid=23)), limit=300)

    banner("pulse_refresh_usage (re-populates after clear)")
    show(extract_structured(call("pulse_refresh_usage", rid=24)), limit=900)

    # -------------- Phase 4 server-pushed notifications --------------
    #
    # The MCP Streamable HTTP transport delivers server-initiated notifications
    # on a "standalone" SSE stream opened via GET /mcp with the session id.
    # Open one in a background thread, then trigger pulse_refresh_usage from
    # the main thread (POST) so the backend broadcasts a `usage-updated`
    # notification. Read for ~5 seconds and verify at least one of the four
    # Phase 4 kinds arrives.

    banner("Phase 4 broadcast notifications (standalone SSE stream)")
    if not SESSION_ID:
        print("FAIL: no SESSION_ID; cannot open standalone stream")
        return 1

    notifications: list[dict[str, Any]] = []
    stop_flag = threading.Event()

    def listen() -> None:
        req = urllib.request.Request(
            URL,
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "Accept": "text/event-stream",
                "Mcp-Session-Id": SESSION_ID or "",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                for raw_line in resp:
                    if stop_flag.is_set():
                        return
                    line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:].strip()
                    if not payload:
                        continue
                    try:
                        msg = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(msg, dict) and msg.get("method") == "notifications/message":
                        notifications.append(msg)
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"  (standalone stream closed/timed out: {e})")

    t = threading.Thread(target=listen, daemon=True)
    t.start()
    time.sleep(0.5)  # let the GET handshake settle

    # Trigger a broadcast event. pulse_refresh_usage is the most reliable
    # trigger (single call -> one usage-updated broadcast).
    print("Triggering pulse_refresh_usage to broadcast usage-updated...")
    call("pulse_refresh_usage", rid=30)

    # Listen up to 5 seconds for at least one notification.
    deadline = time.time() + 5.0
    while time.time() < deadline and not notifications:
        time.sleep(0.2)

    stop_flag.set()
    time.sleep(0.3)

    if not notifications:
        print("WARN: no notifications received on standalone stream within 5s.")
        print("      Possible causes: client doesn't open GET stream (Pulse does);")
        print("      broadcast happens before listener attaches; rmcp transport mapping differs.")
    else:
        print(f"Received {len(notifications)} notification(s):")
        for n in notifications[:10]:
            params = n.get("params") or {}
            data = params.get("data") or {}
            kind = data.get("kind") if isinstance(data, dict) else None
            payload = data.get("payload") if isinstance(data, dict) else None
            print(f"  - kind={kind} level={params.get('level')} payload={json.dumps(payload, ensure_ascii=False)[:200]}")
        kinds = {
            (n.get("params") or {}).get("data", {}).get("kind")
            for n in notifications
            if isinstance((n.get("params") or {}).get("data"), dict)
        }
        if "usage-updated" in kinds:
            print("PASS: usage-updated broadcast received")
        else:
            print(f"WARN: expected usage-updated, got kinds={kinds}")

    print("\nDONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
