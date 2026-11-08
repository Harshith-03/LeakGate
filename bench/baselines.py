"""Baseline systems the benchmark compares LeakGate against. Neither uses LeakGate code.

regex_dlp  What most DLP/egress filters do: regexes for SSN, card (+Luhn), email, phone and API keys over
           the raw request (payload + URL). Any hit blocks the request. It knows nothing about the
           records the agent read, decodes nothing and has no notion of taint or destinations.
presidio   Microsoft Presidio analyzer (spaCy en_core_web_sm + its pattern recognizers) used the way it
           is usually deployed: detected entities are redacted in place ("<US_SSN>") and the rest is sent.
           Optional: only if presidio-analyzer and en_core_web_sm are installed.
"""
from __future__ import annotations

import copy
import re
from typing import Any, Optional

Result = dict[str, Any]   # {"action", "sent" (dict|None), "sent_url" (str|None), "kinds": [...]}


def _leaves(obj: Any, path: str = "") -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    if isinstance(obj, str):
        out.append((path, obj))
    elif isinstance(obj, dict):
        for k, v in obj.items():
            out.extend(_leaves(v, f"{path}.{k}" if path else str(k)))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out.extend(_leaves(v, f"{path}[{i}]"))
    return out


def _set_leaf(obj: Any, path: str, value: str) -> Any:
    """Return obj with the string at `path` (as produced by _leaves) replaced."""
    if path == "":
        return value
    tokens = re.findall(r"[^.\[\]]+|\[\d+\]", path)
    cur = obj
    for tok in tokens[:-1]:
        cur = cur[int(tok[1:-1])] if tok.startswith("[") else cur[tok]
    last = tokens[-1]
    if last.startswith("["):
        cur[int(last[1:-1])] = value
    else:
        cur[last] = value
    return obj


# ------------------------------------------------------------------------------------- regex DLP

SSN_RX = re.compile(r"(?<!\d)(?!000|666|9\d\d)\d{3}([- ]?)(?!00)\d{2}\1(?!0000)\d{4}(?!\d)")
CARD_RX = re.compile(r"(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)")
EMAIL_RX = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RX = re.compile(r"(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)")
API_KEY_RX = re.compile(
    r"\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}"
    r"|AIza[0-9A-Za-z_-]{35}|tvly-[A-Za-z0-9-]{20,})\b"
    r"|(?i:\b(?:api[_-]?key|secret|access[_-]?token)\s*[:=]\s*[A-Za-z0-9_\-]{12,})")


def luhn_ok(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def regex_hits(text: str) -> list[str]:
    kinds: list[str] = []
    if SSN_RX.search(text):
        kinds.append("ssn")
    for m in CARD_RX.finditer(text):
        d = re.sub(r"\D", "", m.group(0))
        if 13 <= len(d) <= 19 and luhn_ok(d):
            kinds.append("credit_card")
            break
    if EMAIL_RX.search(text):
        kinds.append("email")
    if PHONE_RX.search(text):
        kinds.append("phone")
    if API_KEY_RX.search(text):
        kinds.append("api_key")
    return kinds


class RegexDLP:
    name = "regex_dlp"
    label = "Regex DLP (typical)"

    def start_case(self, case: dict[str, Any]) -> None:   # stateless: no taint, no record knowledge
        pass

    def inspect(self, r: dict[str, Any]) -> Result:
        texts = [t for _, t in _leaves(r["payload"])]
        if r.get("url"):
            texts.append(r["url"])
        kinds = sorted({k for t in texts for k in regex_hits(t)})
        if kinds:
            return {"action": "block", "sent": None, "sent_url": None, "kinds": kinds}
        return {"action": "allow", "sent": copy.deepcopy(r["payload"]), "sent_url": r.get("url"), "kinds": []}


# -------------------------------------------------------------------------------------- Presidio

PRESIDIO_ENTITIES = ["PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "US_SSN", "CREDIT_CARD", "US_BANK_NUMBER",
                     "IBAN_CODE", "US_DRIVER_LICENSE", "US_PASSPORT", "IP_ADDRESS", "LOCATION"]
PRESIDIO_THRESHOLD = 0.5


def presidio_available() -> bool:
    try:
        import presidio_analyzer  # noqa: F401
        import en_core_web_sm  # noqa: F401
    except Exception:
        return False
    return True


class PresidioDLP:
    name = "presidio"
    label = "Presidio (NER + patterns, redact)"

    def __init__(self) -> None:
        import logging

        from presidio_analyzer import AnalyzerEngine
        from presidio_analyzer.nlp_engine import NlpEngineProvider

        logging.getLogger("presidio-analyzer").setLevel(logging.ERROR)
        provider = NlpEngineProvider(nlp_configuration={
            "nlp_engine_name": "spacy", "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}]})
        self.engine = AnalyzerEngine(nlp_engine=provider.create_engine(), supported_languages=["en"])

    def start_case(self, case: dict[str, Any]) -> None:
        pass

    def _redact(self, text: str) -> tuple[str, list[str]]:
        res = self.engine.analyze(text=text, language="en", entities=PRESIDIO_ENTITIES,
                                  score_threshold=PRESIDIO_THRESHOLD)
        if not res:
            return text, []
        # merge overlapping spans, keep the highest-scoring label
        spans = sorted(((x.start, x.end, x.entity_type, x.score) for x in res), key=lambda t: (t[0], -t[3]))
        merged: list[list[Any]] = []
        for s, e, t, sc in spans:
            if merged and s < merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], e)
                continue
            merged.append([s, e, t, sc])
        out, last = [], 0
        for s, e, t, _ in merged:
            out.append(text[last:s])
            out.append(f"<{t}>")
            last = e
        out.append(text[last:])
        return "".join(out), sorted({m[2] for m in merged})

    def inspect(self, r: dict[str, Any]) -> Result:
        sent = copy.deepcopy(r["payload"])
        kinds: set[str] = set()
        for path, text in _leaves(sent):
            new, k = self._redact(text)
            if k:
                kinds.update(k)
                sent = _set_leaf(sent, path, new)
        url: Optional[str] = r.get("url")
        if url:
            new_url, k = self._redact(url)
            if k:
                kinds.update(k)
                url = new_url
        return {"action": "redact" if kinds else "allow", "sent": sent, "sent_url": url, "kinds": sorted(kinds)}
