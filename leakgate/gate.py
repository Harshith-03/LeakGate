"""The gate: every outbound request an agent makes goes through Session.inspect().

    gate = Gate.default()
    s = gate.session("demo-1")
    s.load_private("crm:C-1042", record)       # fingerprint + taint (private)
    s.mark_untrusted(url, page_text)           # taint (untrusted) + remember links in the page
    d = s.inspect(channel="search", tool="tavily.search", destination="api.tavily.com", payload={"query": q})
    if d.action != "block": send(d.sent)       # never the original payload

Layers (CONTRACTS.md §1): destination → taint → patterns → vault fingerprints (+ decoded views and
the split-across-calls buffer) → local-model context check. Then one decision:
  block    a never-leaves kind (keys, cards...), private data hidden by encoding, private data going
           to a link that came from untrusted web content, any unapproved destination in lockdown,
           private data in a channel we can't safely rewrite, or a rewrite that is still dirty.
  rewrite  search queries: the local model rewrites the query, every layer re-scans it, rules fall
           back, and if it is still dirty we block. Fail closed.
  redact   llm/tool payloads: spans replaced with [REDACTED:kind], re-scanned.
  allow    nothing private found (low-severity notes may be attached).
inspect() never raises: an internal error blocks the request and says so.
"""
from __future__ import annotations

import copy
import ipaddress
import json
import re
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

from . import config, llm
from . import context as ctxmod
from .decode import Variant, variants
from .detectors import find_patterns
from .fingerprint import DIGIT_RUN, SEVERITY_ORDER, Vault, VaultHit
from .ledger import Ledger
from .rewrite import rewrite_query, strip_spans
from .schema import Decision, Finding, OutboundRequest, Policy, Segment, TaintState

OBFUSCATION = {"base64", "hex", "words", "reversed", "unicode", "spaced"}
TAINT_ONLY_KINDS = {"phone", "email", "ip_address", "dob"}
URL_RX = re.compile(r"https?://[^\s<>\"'`)\]]+", re.I)
KIND_LABELS = {
    "ssn": "an SSN", "credit_card": "a payment card number", "email": "an email address", "phone": "a phone number",
    "iban": "a bank account number", "api_key": "an API key", "private_key": "a private key", "jwt": "a session token",
    "password": "a password", "ip_address": "an internal IP address", "dob": "a date of birth",
    "private_record": "private customer data", "confidential_term": "a confidential codename",
    "private_passage": "a passage from a private file", "personal_context": "personal details about a customer",
    "confidential_business": "confidential business information",
    "split_leak": "the last piece of a private value sent in pieces", "exfil_url": "private data",
}


def host_of(url: Optional[str]) -> str:
    if not url:
        return ""
    try:
        return (urlsplit(url if "://" in url else "http://" + url).hostname or "").lower()
    except ValueError:
        return ""


def is_loopback(host: str) -> bool:
    h = host.strip("[]").lower()
    if h in ("localhost",) or h.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(h).is_loopback
    except ValueError:
        return False


def flatten(obj: Any, prefix: str = "") -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    if isinstance(obj, str):
        out.append((prefix or "value", obj))
    elif isinstance(obj, bool) or obj is None:
        pass
    elif isinstance(obj, (int, float)):
        s = str(obj)
        if sum(c.isdigit() for c in s) >= 6:          # an SSN or card sent as a number
            out.append((prefix or "value", s))
    elif isinstance(obj, dict):
        for k, v in obj.items():
            out.extend(flatten(v, f"{prefix}.{k}" if prefix else str(k)))
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            out.extend(flatten(v, f"{prefix}[{i}]"))
    return out


def set_path(obj: Any, path: str, value: str) -> None:
    parts = re.findall(r"[^.\[\]]+|\[\d+\]", path)
    cur = obj
    for i, p in enumerate(parts):
        last = i == len(parts) - 1
        key: Any = int(p[1:-1]) if p.startswith("[") else p
        if last:
            cur[key] = value
        else:
            cur = cur[key]


def mask(s: str) -> str:
    """Keep the first letter of each word and the last 4 of long digit runs; everything else •."""
    n_digits = sum(c.isdigit() for c in s)
    keep_from = n_digits - 4 if n_digits >= 7 else n_digits + 1
    out, di, prev_alpha = [], 0, False
    for c in s:
        if c.isdigit():
            out.append(c if di >= keep_from else "•")
            di += 1
            prev_alpha = False
        elif c.isalpha():
            out.append("•" if prev_alpha else c)
            prev_alpha = True
        else:
            out.append(c)
            prev_alpha = False
    return "".join(out)


class Session:
    def __init__(self, gate: "Gate", session_id: str):
        self.gate = gate
        self.id = session_id
        self.taint = TaintState()
        self.mentioned_urls: set[str] = set()     # links that appeared inside untrusted content
        self.mentioned_hosts: set[str] = set()
        self.fragments: list[str] = []            # digit runs that actually LEFT, most recent last
        self.lock = threading.RLock()

    def load_private(self, ref: str, record: dict, public_fields: Optional[set[str]] = None) -> int:
        source, _, rid = ref.partition(":")
        pub = public_fields if public_fields is not None else self.gate.public_fields.get(source)
        n = self.gate.vault.add_record(source or "private", rid or ref, record, pub)
        self.mark_private(ref)
        return n

    def mark_private(self, ref: str) -> None:
        with self.lock:
            self.taint.private = True
            if ref not in self.taint.private_sources:
                self.taint.private_sources.append(ref)

    def mark_untrusted(self, url: str, text: str = "") -> None:
        with self.lock:
            self.taint.untrusted = True
            if url and url not in self.taint.untrusted_sources:
                self.taint.untrusted_sources.append(url)
            for m in URL_RX.finditer(text or ""):
                link = m.group(0).rstrip(".,;:")
                self.mentioned_urls.add(link)
                h = host_of(link)
                if h:
                    self.mentioned_hosts.add(h)

    def inspect(self, channel: str, tool: str, destination: str, payload: Optional[dict] = None,
                url: Optional[str] = None, origin: str = "agent") -> Decision:
        req = OutboundRequest(id=uuid.uuid4().hex[:12], session_id=self.id, channel=channel, tool=tool,  # type: ignore[arg-type]
                              destination=(destination or host_of(url)).lower(), url=url,
                              payload=payload or {}, origin=origin)
        return self.gate.inspect(req, self)


class Gate:
    def __init__(self, policy: Policy, key: Optional[bytes] = None, ledger_path: Optional[Path] = None,
                 model: Optional[str] = None, use_ledger: bool = True):
        self.policy = policy
        self.key = key or config.install_key()
        self.vault = Vault(self.key)
        self.vault.add_terms(policy.confidential_terms, source="policy")
        self.model = model or config.MODEL
        self.ledger = Ledger(ledger_path or config.ledger_path(), self.key) if use_ledger else None
        self.public_fields: dict[str, set[str]] = {}
        self.sessions: dict[str, Session] = {}
        self._callbacks: list[Callable[[Decision], None]] = []

    # ------------------------------------------------------------ construction
    @classmethod
    def default(cls, policy_path: Optional[Path] = None, **kw) -> "Gate":
        return cls(load_policy(policy_path), **kw)

    def register_source(self, path: Path) -> int:
        """Pre-register a data source file ({source, public_fields, records}) so its values are
        protected even before an agent loads them (e.g. data the agent got in its prompt)."""
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        src = data.get("source", Path(path).stem)
        pub = set(data.get("public_fields", []))
        self.public_fields[src] = pub
        return self.vault.add_records(src, data.get("records", []), pub)

    def session(self, session_id: Optional[str] = None) -> Session:
        sid = session_id or uuid.uuid4().hex[:8]
        if sid not in self.sessions:
            self.sessions[sid] = Session(self, sid)
        return self.sessions[sid]

    def on_decision(self, cb: Callable[[Decision], None]) -> None:
        self._callbacks.append(cb)

    def rule_for(self, host: str, channel: str):
        for r in self.policy.destinations:
            if r.host.lower() == host and channel in r.channels:
                return r
        return None

    def host_allowlisted(self, host: str) -> bool:
        return any(r.host.lower() == host for r in self.policy.destinations)

    def mask_text(self, text: Optional[str]) -> Optional[str]:
        """For DISPLAY: mask every vault value and sensitive pattern in free text (agent answers, logs)."""
        if not text:
            return text
        try:
            spans = [(h.start, h.end) for h in self.vault.scan(text)]
            spans += [(p.start, p.end) for p in find_patterns(text) if p.severity != "low"]
        except Exception:
            return mask(text)
        out, pos = [], 0
        for a, b in sorted(spans):
            if b <= pos:
                continue
            a = max(a, pos)
            out.append(text[pos:a])
            out.append(mask(text[a:b]))
            pos = b
        out.append(text[pos:])
        return "".join(out)

    def model_on(self) -> bool:
        return self.policy.use_context_model and llm.available(self.model)

    # ------------------------------------------------------------ scanning
    def _scan_field(self, path: str, text: str, private: bool) -> list[Finding]:
        found: list[Finding] = []
        seen: set[tuple] = set()
        for v in variants(text):
            enc = v.encoding
            vhits = self.vault.scan(v.text)
            vspans = [(h.start, h.end) for h in vhits]
            for h in vhits:
                s, e = v.span_of(h.start, h.end)
                hen = "reversed" if h.reversed else ("spaced" if h.spaced and enc == "plain" else enc)
                key = ("fp", s, e, h.ref.source_ref, hen)
                if key in seen:
                    continue
                seen.add(key)
                where = h.ref.source_ref.rsplit(".", 1)[0] if "." in h.ref.source_ref else h.ref.source_ref
                note = f" Found after {hen} decoding." if hen not in ("plain", "normalized") else ""
                found.append(Finding(layer="fingerprint", kind=h.ref.kind, field=path, start=s, end=e,
                                     preview=mask(v.text[h.start:h.end]), encoding=hen,  # type: ignore[arg-type]
                                     source_ref=h.ref.source_ref, severity=h.ref.severity,  # type: ignore[arg-type]
                                     explanation=f"Matches the {h.ref.label} in {where}.{note}"))
            for p in find_patterns(v.text):
                if any(a <= p.start and p.end <= b for a, b in vspans):
                    continue                                  # the vault already explains this span
                s, e = v.span_of(p.start, p.end)
                key = ("pt", s, e, p.kind, enc)
                if key in seen:
                    continue
                seen.add(key)
                sev = p.severity
                expl = p.explanation
                if p.kind in TAINT_ONLY_KINDS and not private:
                    sev, expl = "low", expl + " Noted only: this agent has not read private data."
                if enc != "plain":
                    expl += f" Found after {enc} decoding."
                found.append(Finding(layer="pattern", kind=p.kind, field=path, start=s, end=e,
                                     preview=mask(v.text[p.start:p.end]), encoding=enc,  # type: ignore[arg-type]
                                     severity=sev, explanation=expl))  # type: ignore[arg-type]
        return found

    def _rescan_dirty(self, text: str, private: bool) -> bool:
        return any(f.severity != "low" for f in self._scan_field("query", text, private))

    # ------------------------------------------------------------ the decision
    def inspect(self, req: OutboundRequest, s: Session) -> Decision:
        t0 = time.perf_counter()
        try:
            with s.lock:
                d = self._inspect(req, s, t0)
        except Exception:
            traceback.print_exc()
            d = Decision(request_id=req.id, session_id=req.session_id, channel=req.channel, tool=req.tool,
                         destination=req.destination, action="block", sent=None, taint=s.taint.model_copy(deep=True),
                         reason="LeakGate hit an internal error, so it blocked the request to be safe.",
                         latency_ms=(time.perf_counter() - t0) * 1000)
        if self.ledger is not None and not is_loopback(req.destination):
            try:
                rec = self.ledger.append(d, req.payload, req.url)
                d.ledger_seq = rec.seq
            except OSError:
                pass
        for cb in list(self._callbacks):
            try:
                cb(d)
            except Exception:
                pass
        return d

    def _inspect(self, req: OutboundRequest, s: Session, t0: float) -> Decision:
        pol = self.policy
        taint = s.taint.model_copy(deep=True)
        dest = req.destination
        layer_ms: dict[str, float] = {}
        findings: list[Finding] = []
        fields = flatten(req.payload)
        if req.url:
            fields.insert(0, ("url", req.url))

        def done(action: str, reason: str, sent: Optional[dict], by: Optional[str] = None) -> Decision:
            if pol.mode == "monitor":
                reason = f"Monitor mode: would have {'allowed' if action == 'allow' else action + 'ed' if action != 'rewrite' else 'rewritten'} this. {reason}"
                sent = copy.deepcopy(req.payload)
            if sent is not None and action != "block":
                for _, text in flatten(sent):
                    for m in DIGIT_RUN.finditer(text):
                        dg = re.sub(r"\D", "", m.group(0))
                        if 2 <= len(dg) <= 12:
                            s.fragments = (s.fragments + [dg])[-8:]
            return Decision(request_id=req.id, session_id=req.session_id, channel=req.channel, tool=req.tool,
                            destination=dest, action=action, reason=reason, findings=findings,  # type: ignore[arg-type]
                            attempted=self._segments(fields, findings), sent=sent, rewritten_by=by,  # type: ignore[arg-type]
                            sent_url=req.url if sent is not None else None,
                            taint=taint, mode=pol.mode, latency_ms=round((time.perf_counter() - t0) * 1000, 2),
                            layer_ms={k: round(v, 2) for k, v in layer_ms.items()})

        if is_loopback(dest):
            return done("allow", "Local destination: nothing leaves this machine.", copy.deepcopy(req.payload))

        # 1. destination
        t = time.perf_counter()
        rule = self.rule_for(dest, req.channel)
        if rule is None and taint.private:
            why = ("has read private data and untrusted web content (lockdown)" if taint.lockdown
                   else "has read private data")
            findings.append(Finding(layer="destination", kind="not_allowlisted", field="destination", preview=dest,
                                    severity="critical", explanation=f"{dest} is not an approved destination for "
                                    f"{req.channel}, and this agent {why}, so only approved places are allowed."))
        elif rule is None:
            findings.append(Finding(layer="destination", kind="not_allowlisted", field="destination", preview=dest,
                                    severity="low", explanation=f"{dest} is not on the approved list. Allowed because "
                                    "this agent has not read private data yet."))
        elif taint.lockdown and not rule.allow_in_lockdown:
            findings.append(Finding(layer="destination", kind="not_allowlisted", field="destination", preview=dest,
                                    severity="critical", explanation=f"{dest} is approved, but not during lockdown."))
        layer_ms["destination"] = (time.perf_counter() - t) * 1000

        # 2. taint: links that came from untrusted content
        t = time.perf_counter()
        links: list[tuple[str, str, int, int]] = []
        if req.url:
            links.append(("url", req.url, 0, len(req.url)))
        for path, text in fields:
            if path == "url":
                continue
            for m in URL_RX.finditer(text):
                links.append((path, m.group(0), m.start(), m.end()))
        for path, link, ls, le in links:
            h = host_of(link)
            from_untrusted = ((path == "url" and req.origin.startswith("untrusted"))
                              or link.split("?")[0].rstrip("/") in {u.split("?")[0].rstrip("/") for u in s.mentioned_urls}
                              or h in s.mentioned_hosts)
            if taint.lockdown and from_untrusted and not self.host_allowlisted(h):
                findings.append(Finding(layer="taint", kind="untrusted_url", field=path, start=ls, end=le, preview=h,
                                        severity="high", explanation="This link came from a web page the agent read, "
                                        "not from you or your policy."))
        layer_ms["taint"] = (time.perf_counter() - t) * 1000

        # 3 + 4. patterns and vault fingerprints (plain and decoded views)
        t = time.perf_counter()
        for path, text in fields:
            findings.extend(self._scan_field(path, text, taint.private))
        layer_ms["scan"] = (time.perf_counter() - t) * 1000

        # 4b. split across calls: does this piece complete a private value with pieces that already left?
        t = time.perf_counter()
        for path, text in fields:
            for m in DIGIT_RUN.finditer(text):
                frag = re.sub(r"\D", "", m.group(0))
                if not 2 <= len(frag) <= 12:
                    continue
                prev = s.fragments
                for k in (1, 2, 3):
                    if len(prev) < k:
                        break
                    head = "".join(prev[-k:])
                    for combo in (head + frag, frag + head):
                        ref = self.vault.match_digits_exact(combo)
                        if ref:
                            findings.append(Finding(layer="fingerprint", kind="split_leak", field=path, start=m.start(),
                                                    end=m.end(), preview=mask(combo), encoding="split",
                                                    source_ref=ref.source_ref, severity="critical",
                                                    explanation=f"With {k} earlier request(s), this piece completes the "
                                                    f"{ref.label} in {ref.source_ref.rsplit('.', 1)[0]}."))
                            break
        layer_ms["split"] = (time.perf_counter() - t) * 1000

        data = [f for f in findings if f.layer in ("pattern", "fingerprint", "context") and f.severity != "low"]

        # 5. local-model context check, only when the rules found nothing and the agent read private data
        if not data and taint.private and pol.use_context_model and req.channel != "llm":
            t = time.perf_counter()
            if self.model_on():
                for path, text in fields:
                    if len(text) < 16 or path == "url" and req.channel == "search":
                        continue
                    r = ctxmod.check(text, dest, req.channel, taint.private_sources, model=self.model)
                    if r.ran and r.discloses:
                        findings.append(Finding(layer="context", kind=r.kind, field=path, start=r.start, end=r.end,
                                                preview=mask(r.evidence)[:120], severity="high" if r.start is not None else "medium",
                                                explanation=(r.reason or "The local model judged this to disclose private details.")
                                                + ("" if r.start is not None else " (Model's quote could not be located.)")))
                        break
            layer_ms["context"] = (time.perf_counter() - t) * 1000
            data = [f for f in findings if f.layer in ("pattern", "fingerprint", "context") and f.severity != "low"]

        # ---- decide
        crit_dest = [f for f in findings if f.kind == "not_allowlisted" and f.severity == "critical"]
        untrusted = [f for f in findings if f.kind == "untrusted_url"]
        never = [f for f in data if f.kind in pol.block_kinds or f.severity == "critical"]
        obf = [f for f in data if f.encoding in OBFUSCATION]

        if untrusted and data:
            u = untrusted[0]
            findings.append(Finding(layer="taint", kind="exfil_url", field=u.field, start=u.start, end=u.end,
                                    preview=u.preview, severity="critical",
                                    explanation="Private data is being sent to a link planted in web content the agent read: "
                                    "the signature of a prompt-injection exfiltration."))
            verb = "were" if " and " in _what(data) else "was"
            return done("block", f"Blocked a prompt-injection exfiltration: {_what(data)} {verb} headed to {u.preview}, "
                                 "a link planted in a web page the agent read.", None)
        if crit_dest:
            if taint.lockdown:
                return done("block", f"Lockdown: {dest} is not an approved destination, and this agent has read "
                                     "private data and untrusted web content.", None)
            return done("block", f"Blocked: {dest} is not an approved destination, and this agent has read private "
                                 "data. Read pages through an approved channel such as Tavily extract.", None)
        split = [f for f in data if f.kind == "split_leak"]
        if split:
            what = split[0].explanation.split("completes the ", 1)[-1].rstrip(".")
            return done("block", f"Blocked: this piece would complete the {what}, sent in parts across earlier "
                                 "requests.", None)
        if never:
            return done("block", f"Blocked: {_what(never)} must never leave.", None)
        if obf:
            return done("block", f"Blocked: {_what(obf)} hidden with {obf[0].encoding} encoding, which is how "
                                 "exfiltration attempts disguise data.", None)
        if not data:
            notes = [f for f in findings if f.severity == "low"]
            return done("allow", "Nothing private found." + (f" {len(notes)} note(s) logged." if notes else ""),
                        copy.deepcopy(req.payload))

        # rewrite search queries
        t = time.perf_counter()
        if req.channel in pol.rewrite_channels and isinstance(req.payload.get("query"), str):
            if any(f.field != "query" for f in data):
                return done("block", f"Blocked: {_what(data)} in a field other than the search query.", None)
            q = req.payload["query"]
            spans = [(f.start, f.end) for f in data if f.start is not None]
            low = [(f.start, f.end) for f in findings if f.severity == "low" and f.field == "query" and f.start is not None]
            new, by = None, "rules"
            if pol.use_context_model and self.model_on():
                remove = sorted({q[a:b] for a, b in spans} | {f.preview for f in data if f.start is None and f.layer == "context"})
                generalize = sorted({q[a:b] for a, b in low})
                new, by = rewrite_query(q, remove, generalize, model=self.model)
                if new is not None and (self._rescan_dirty(new, taint.private) or len(new) < 3):
                    new = None
            if new is None:
                by = "rules"
                new = strip_spans(q, spans)
                if self._rescan_dirty(new, taint.private) or len(new) < 3:
                    layer_ms["rewrite"] = (time.perf_counter() - t) * 1000
                    return done("block", f"Blocked: {_what(data)} could not be removed while keeping a usable query.", None)
            layer_ms["rewrite"] = (time.perf_counter() - t) * 1000
            sent = copy.deepcopy(req.payload)
            sent["query"] = new
            return done("rewrite", f"Rewrote the search so {_what(data)} stayed on this machine; the research "
                                   "question still went out.", sent, by)

        # redact llm/tool payloads
        if req.channel in ("llm", "tool"):
            sent = copy.deepcopy(req.payload)
            by_field: dict[str, list[Finding]] = {}
            for f in data:
                by_field.setdefault(f.field, []).append(f)
            for path, text in fields:
                fs = [f for f in by_field.get(path, []) if f.start is not None]
                if path in by_field and not fs:
                    return done("block", f"Blocked: {_what(data)} could not be located for redaction.", None)
                out = text
                for f in sorted(fs, key=lambda f: f.start or 0, reverse=True):
                    out = out[:f.start] + f"[REDACTED:{f.kind}]" + out[f.end:]
                if out != text:
                    if self._rescan_dirty(out, taint.private):
                        return done("block", f"Blocked: {_what(data)} survived redaction.", None)
                    set_path(sent, path, out)
            layer_ms["rewrite"] = (time.perf_counter() - t) * 1000
            return done("redact", f"Redacted {_what(data)} before the request left.", sent, "rules")

        return done("block", f"Blocked: {_what(data)} in a {req.channel} request. Only search queries can be "
                             "rewritten safely.", None)

    # ------------------------------------------------------------ display
    @staticmethod
    def _segments(fields: list[tuple[str, str]], findings: list[Finding]) -> dict[str, list[Segment]]:
        """Masked display of what the agent tried to send. Data hits are masked; a planted link with no
        data inside is shown as-is (a host name is not sensitive) and highlighted as the attack."""
        out: dict[str, list[Segment]] = {}
        for path, text in fields:
            data = [(f.start, f.end, i) for i, f in enumerate(findings)
                    if f.field == path and f.start is not None and f.end is not None
                    and f.layer in ("pattern", "fingerprint", "context") and f.severity != "low"]
            links = [(f.start, f.end, i) for i, f in enumerate(findings)
                     if f.field == path and f.kind == "untrusted_url" and f.start is not None and f.end is not None
                     and not any(f.start <= a < f.end for a, _, _ in data)]
            spans = sorted(data + links, key=lambda x: (x[0], -(x[1] - x[0])))
            segs: list[Segment] = []
            pos = 0
            for a, b, i in spans:
                if b <= pos:                               # inside an earlier hit
                    continue
                if a < pos:                                # overlaps: extend the earlier hit
                    segs[-1] = Segment(text=segs[-1].text + mask(text[pos:b]), finding=segs[-1].finding)
                    pos = b
                    continue
                if a > pos:
                    segs.append(Segment(text=text[pos:a]))
                is_link = findings[i].kind == "untrusted_url"
                segs.append(Segment(text=text[a:b] if is_link else mask(text[a:b]), finding=i))
                pos = b
            if pos < len(text):
                segs.append(Segment(text=text[pos:]))
            out[path] = segs
        return out


def _what(fs: list[Finding]) -> str:
    kinds = []
    for f in fs:
        lab = KIND_LABELS.get(f.kind, f.kind.replace("_", " "))
        if f.kind == "private_record" and f.source_ref:
            field = f.source_ref.rsplit(".", 1)[-1]
            lab = {"ssn": "a customer's SSN", "name": "a customer's name", "policy_number": "a policy number",
                   "claim_id": "a claim ID", "address": "a street address", "email": "a customer's email",
                   "phone": "a customer's phone number", "dob": "a date of birth", "card_on_file": "a card number",
                   "claim_amount": "a claim amount", "city": "a city", "zip": "a ZIP code"}.get(field, lab)
        if lab not in kinds:
            kinds.append(lab)
    if not kinds:
        return "private data"
    return kinds[0] if len(kinds) == 1 else ", ".join(kinds[:-1]) + " and " + kinds[-1]


def load_policy(path: Optional[Path] = None) -> Policy:
    p = Path(path or config.POLICY_PATH)
    return Policy.model_validate_json(p.read_text(encoding="utf-8"))
