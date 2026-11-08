"""LeakGate as an MCP server: web tools for any MCP client (Claude Desktop, Cursor, ...) that can't leak.

    python -m leakgate.mcp_server                # stdio transport

Tools (one LeakGate session per server process = one agent conversation):
  protect(source, data)     tell LeakGate what private data this conversation is working with
                            (a JSON object or plain text). It is fingerprinted (keyed hashes) and the
                            session is marked private. Nothing is sent anywhere.
  web_search(query)         Tavily search through the gate. Returns results AND what actually left.
  fetch_url(url)            HTTP GET through the gate (allow or block, never rewritten).
  egress_report()           the last decisions, masked.

Decisions go to the same hash-chained ledger as the dashboard (outputs/ledger.jsonl), and the socket
guard is installed, so even a tool that bypassed the SDK could only reach the policy's hosts.

Client config (Claude Desktop, claude_desktop_config.json):
  {"mcpServers": {"leakgate": {"command": "<venv>/python", "args": ["-m", "leakgate.mcp_server"],
                               "cwd": "<repo>"}}}
"""
from __future__ import annotations

import json
from typing import Any

from mcp.server.mcpserver import MCPServer

from . import netguard
from .gate import Gate
from .integrations.http import guarded_get
from .integrations.tavily import GuardedTavily

GATE = Gate.default()
SESSION = GATE.session("mcp")
TAVILY = GuardedTavily(SESSION)
_RECENT: list[dict] = []
_N = {"protect": 0}

server = MCPServer(name="leakgate", title="LeakGate",
                   instructions="Web search and fetch that cannot leak private data. Call `protect` with any "
                                "private record you are working with before searching.")


def _brief(d) -> dict:
    row = {"action": d.action, "reason": d.reason, "destination": d.destination, "sent": d.sent,
           "findings": [{"kind": f.kind, "preview": f.preview, "layer": f.layer} for f in d.findings],
           "ledger_seq": d.ledger_seq}
    _RECENT.append(row)
    del _RECENT[:-20]
    return row


@server.tool(description="Register private data (JSON object or text) this conversation is working with. "
                         "LeakGate fingerprints it locally so it can never leave in a search or request.")
def protect(source: str, data: str) -> str:
    _N["protect"] += 1
    try:
        obj: Any = json.loads(data)
    except ValueError:
        obj = {"text": data}
    if not isinstance(obj, dict):
        obj = {"text": json.dumps(obj)}
    ref = f"{source or 'mcp'}:{_N['protect']}"
    n = SESSION.load_private(ref, {k: v for k, v in obj.items() if isinstance(v, (str, int, float))})
    return f"Protected {ref}: {n} fingerprints (keyed hashes, stored locally). Nothing was sent."


@server.tool(description="Search the web with Tavily. LeakGate rewrites private details out of the query "
                         "or blocks it; the response says exactly what left.")
def web_search(query: str, max_results: int = 5) -> str:
    r = TAVILY.search(query, max_results=max(1, min(int(max_results), 10)))
    out = {"leakgate": _brief(r.decision), "mode": r.mode,
           "results": [{"title": x.get("title"), "url": x.get("url"), "content": str(x.get("content") or "")[:800]}
                       for x in r.results]}
    if r.error:
        out["error"] = r.error
    return json.dumps(out, ensure_ascii=False)


@server.tool(description="Fetch a web page. Blocked if it would carry private data or, after the conversation "
                         "has read private data and web content, if the host is not approved.")
def fetch_url(url: str) -> str:
    r = guarded_get(SESSION, url, origin="agent")
    out = {"leakgate": _brief(r.decision), "status": r.status, "text": (r.text or "")[:4000]}
    if r.error:
        out["error"] = r.error
    return json.dumps(out, ensure_ascii=False)


@server.tool(description="The last LeakGate decisions in this conversation (masked).")
def egress_report() -> str:
    return json.dumps({"taint": SESSION.taint.model_dump(), "decisions": _RECENT[-10:]}, ensure_ascii=False)


def main() -> None:
    netguard.install_for(GATE)
    server.run("stdio")


if __name__ == "__main__":
    main()
