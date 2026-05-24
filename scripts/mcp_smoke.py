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

    expected = {"pulse_ping", "pulse_list_sessions", "pulse_get_session",
                "pulse_get_usage", "pulse_list_presets", "pulse_list_commands"}
    actual = {t.get("name") for t in tools}
    missing = expected - actual
    extra = actual - expected
    if missing:
        print(f"MISSING tools: {missing}")
    if extra:
        print(f"EXTRA tools (ok if Phase 3+ landed): {extra}")

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

    print("\nDONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
