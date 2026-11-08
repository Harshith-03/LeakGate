"""Two lines to put any LangChain tool behind LeakGate.

    from leakgate.integrations.langchain import guard_tool
    safe_search = guard_tool(search_tool, session, channel="search", destination="api.tavily.com")

Before the tool runs, its arguments go through `session.inspect`. Blocked → the agent gets a short
"blocked by LeakGate: <reason>" observation instead of a result (so it can carry on without the data);
rewritten/redacted → the tool runs with the cleaned arguments; allowed → unchanged.
The tool's output is treated as untrusted web content when `untrusted_output=True`.
"""
from __future__ import annotations

from typing import Any, Optional

from langchain_core.tools import BaseTool, StructuredTool

from ..gate import Session


def guard_tool(tool: BaseTool, session: Session, channel: str = "tool", destination: Optional[str] = None,
               untrusted_output: bool = True) -> BaseTool:
    dest = destination or f"tool:{tool.name}"

    def _run(**kwargs: Any) -> str:
        d = session.inspect(channel=channel, tool=f"langchain.{tool.name}", destination=dest, payload=dict(kwargs))
        if d.action == "block" or d.sent is None:
            return f"[blocked by LeakGate: {d.reason}]"
        out = tool.invoke(dict(kwargs) if d.mode == "monitor" else d.sent)
        text = out if isinstance(out, str) else str(out)
        if untrusted_output:
            session.mark_untrusted(f"tool:{tool.name}", text)
        return text

    return StructuredTool.from_function(func=_run, name=tool.name, description=tool.description,
                                        args_schema=tool.args_schema)
