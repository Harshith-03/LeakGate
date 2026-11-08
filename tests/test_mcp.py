"""The MCP server exposes guarded tools; protect + web_search rewrites private details (replay, no network)."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

REC = json.loads((Path(__file__).resolve().parent.parent / "agent" / "data" / "customers.json")
                 .read_text(encoding="utf-8"))["records"][1]


def test_mcp_tools_guard_search(tmp_path, monkeypatch):
    monkeypatch.setenv("LEAKGATE_OUTPUTS", str(tmp_path))
    from leakgate import mcp_server as m
    m.GATE.policy.use_context_model = False
    m.TAVILY.replay = True

    async def go():
        names = {t.name for t in await m.server.list_tools()}
        assert {"protect", "web_search", "fetch_url", "egress_report"} <= names
        await m.server.call_tool("protect", {"source": "crm", "data": json.dumps(REC)})
        r = await m.server.call_tool("web_search", {"query": f"{REC['name']} wind claim {REC['policy_number']}"})
        return json.loads(r.content[0].text)

    out = asyncio.run(go())
    assert out["leakgate"]["action"] == "rewrite"
    assert REC["policy_number"] not in json.dumps(out) and "Achterberg" not in json.dumps(out)
