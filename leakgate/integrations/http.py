"""Plain web requests, behind the gate.

    r = guarded_get(session, url, params=None, origin="agent")       # -> GuardedHttp
    r = guarded_post(session, url, json_body, origin="agent")

HTTP requests are never rewritten (a URL or JSON body can't be safely "cleaned" the way a search
query can): they are either allowed as-is or blocked. Pass origin="untrusted:<page>" when the URL
came from web content; the gate also recognises links it saw in pages on its own.
Response bodies are web content, so they mark the session untrusted.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import requests

from ..gate import Session, host_of
from ..schema import Decision

TIMEOUT = (5, 15)


@dataclass
class GuardedHttp:
    decision: Decision
    status: Optional[int] = None
    text: str = ""
    error: Optional[str] = None


def guarded_get(session: Session, url: str, params: Optional[dict] = None, origin: str = "agent",
                dry_run: bool = False) -> GuardedHttp:
    d = session.inspect(channel="http", tool="http.get", destination=host_of(url),
                        payload={"params": params or {}}, url=url, origin=origin)
    if d.action == "block" or d.sent is None or dry_run:
        return GuardedHttp(d)
    try:
        r = requests.get(url, params=(d.sent or {}).get("params") or None, timeout=TIMEOUT)
        session.mark_untrusted(url, r.text[:20000])
        return GuardedHttp(d, r.status_code, r.text)
    except (requests.RequestException, OSError) as e:
        return GuardedHttp(d, error=f"{type(e).__name__}: {e}"[:200])


def guarded_post(session: Session, url: str, json_body: Any, origin: str = "agent", dry_run: bool = False) -> GuardedHttp:
    d = session.inspect(channel="http", tool="http.post", destination=host_of(url),
                        payload={"json": json_body}, url=url, origin=origin)
    if d.action == "block" or d.sent is None or dry_run:
        return GuardedHttp(d)
    try:
        r = requests.post(url, json=(d.sent or {}).get("json"), timeout=TIMEOUT)
        session.mark_untrusted(url, r.text[:20000])
        return GuardedHttp(d, r.status_code, r.text)
    except (requests.RequestException, OSError) as e:
        return GuardedHttp(d, error=f"{type(e).__name__}: {e}"[:200])
