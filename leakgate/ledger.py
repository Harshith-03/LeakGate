"""Hash-chained egress ledger: the "prove it" part.

    led = Ledger(path, key)
    led.append(decision, attempted_payload, url) -> LedgerRecord
    led.verify() -> LedgerStatus
    led.records(limit=200) -> list[LedgerRecord]      # newest first

Each line stores HMAC(install key, canonical attempted payload) (so you can later prove what an agent
TRIED to send, if you still have it, without the ledger holding it) and the payload that actually
left (clean by construction; it left anyway). prev_hash = sha256 of the previous line, so editing,
inserting or deleting a line breaks the chain from that point. The head hash is also written to
ledger.jsonl.head so truncating the tail is detected.

Honest scope: tamper-EVIDENT, not tamper-proof. Someone who rewrites the whole file and the head can
forge a consistent chain; publish or anchor the head hash (the UI shows it) to close that gap.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import threading
from pathlib import Path
from typing import Any, Optional

from .schema import Decision, LedgerRecord, LedgerStatus, now_iso

_LOCK = threading.Lock()


def canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


class Ledger:
    def __init__(self, path: Path, key: bytes):
        self.path = Path(path)
        self.key = key

    @property
    def head_path(self) -> Path:
        return self.path.with_name(self.path.name + ".head")

    def _lines(self) -> list[str]:
        if not self.path.exists():
            return []
        with open(self.path, encoding="utf-8", newline="") as f:
            return [ln.rstrip("\r\n") for ln in f if ln.strip()]

    def attempted_hmac(self, attempted: dict, url: Optional[str]) -> str:
        return hmac.new(self.key, canonical({"payload": attempted, "url": url}).encode("utf-8"),
                        hashlib.sha256).hexdigest()

    def append(self, d: Decision, attempted: dict, url: Optional[str] = None) -> LedgerRecord:
        with _LOCK:
            lines = self._lines()
            rec = LedgerRecord(
                seq=len(lines) + 1, ts=now_iso(), session_id=d.session_id, request_id=d.request_id,
                tool=d.tool, channel=d.channel, destination=d.destination, action=d.action,
                kinds=sorted({f.kind for f in d.findings}),
                attempted_hmac=self.attempted_hmac(attempted, url),
                sent=d.sent, sent_url=d.sent_url,
                sent_sha256=_sha(canonical({"payload": d.sent, "url": d.sent_url})) if d.sent is not None else None,
                findings=len(d.findings), prev_hash=_sha(lines[-1]) if lines else "")
            line = rec.model_dump_json()
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.path, "a", encoding="utf-8", newline="\n") as f:
                f.write(line + "\n")
            self.head_path.write_text(_sha(line), encoding="utf-8")
            return rec

    def verify(self) -> LedgerStatus:
        lines = self._lines()
        prev = ""
        for i, line in enumerate(lines, start=1):
            try:
                rec = LedgerRecord.model_validate_json(line)
            except ValueError:
                return LedgerStatus(ok=False, records=len(lines), broken_at=i)
            if rec.prev_hash != prev or rec.seq != i:
                return LedgerStatus(ok=False, records=len(lines), broken_at=i)
            prev = _sha(line)
        if lines and self.head_path.exists() and self.head_path.read_text(encoding="utf-8").strip() != prev:
            return LedgerStatus(ok=False, records=len(lines), head=prev or None, broken_at=len(lines))
        return LedgerStatus(ok=True, records=len(lines), head=prev or None)

    def records(self, limit: int = 200) -> list[LedgerRecord]:
        out = []
        for line in reversed(self._lines()):
            try:
                out.append(LedgerRecord.model_validate_json(line))
            except ValueError:
                continue
            if len(out) >= limit:
                break
        return out
