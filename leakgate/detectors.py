"""Pattern detectors: sensitive data LeakGate can recognise without knowing your records.

    find_patterns(text) -> list[PatternHit]

This is what classic DLP does. It is necessary (an API key is a secret no matter whose it is) but
not sufficient: a customer's surname or a policy number has no pattern. fingerprint.py covers that.

Deliberate false-positive guards, because a firewall that cries wolf gets uninstalled:
  * SSN: separated form anywhere; a bare 9-digit run only next to an SSN cue word.
  * Phone: toll-free numbers (800/888/877/866/855/844/833) are business lines, not people.
  * Email: addresses at .gov domains are public contacts.
  * Card: 13-19 digits, plausible network prefix AND a valid Luhn checksum.
  * DOB: a date only counts with a birth cue nearby; storm dates and deadlines are not DOBs.
"""
from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class PatternHit:
    kind: str
    start: int
    end: int
    severity: str          # schema.Severity
    explanation: str


def luhn_ok(digits: str) -> bool:
    total = 0
    for i, c in enumerate(reversed(digits)):
        d = int(c)
        if i % 2:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


SSN_SEP = re.compile(r"(?<![\d-])(?!000|666|9\d\d)\d{3}([- .])(?!00)\d{2}\1(?!0000)\d{4}(?![\d-])")
SSN_BARE = re.compile(r"(?<!\d)(?!000|666|9\d\d)\d{3}(?!00)\d{2}(?!0000)\d{4}(?!\d)")
SSN_CUE = re.compile(r"\b(ssn|social security|soc\.? sec|tax ?id|tin|itin)\b", re.I)
CARD = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")
EMAIL = re.compile(r"(?<![\w.+-])[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,24}\b")
PHONE = re.compile(r"(?<![\w])(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w])")
TOLL_FREE = {"800", "888", "877", "866", "855", "844", "833"}
IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b")
API_KEYS = [
    (re.compile(r"\bsk-(?:ant-|proj-|live_|test_)?[A-Za-z0-9_-]{20,}"), "an LLM/payment API key (sk-...)"),
    (re.compile(r"\btvly-[A-Za-z0-9_-]{16,}"), "a Tavily API key"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "an AWS access key"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"), "a GitHub token"),
    (re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"), "a Slack token"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"), "a Google API key"),
    (re.compile(r"\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*['\"]?[A-Za-z0-9_\-./+]{16,}", re.I),
     "a credential assignment"),
]
PRIVATE_KEY = re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----")
JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
PASSWORD = re.compile(r"\b(?:password|passwd|pwd|passcode)\s*[:=]\s*\S{4,}", re.I)
IPV4 = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
DATE = re.compile(r"(?<!\d)(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4}|\d{1,2}-\d{1,2}-\d{4})(?!\d)")
DOB_CUE = re.compile(r"\b(dob|d\.o\.b|date of birth|born|birth ?date|birthday)\b", re.I)


def _near(cue: re.Pattern, text: str, s: int, e: int, width: int = 32) -> bool:
    return bool(cue.search(text[max(0, s - width): e + width]))


def find_patterns(text: str) -> list[PatternHit]:
    """Never raises. Returns non-overlapping-ish hits; the gate merges overlaps for display."""
    if not text:
        return []
    hits: list[PatternHit] = []
    try:
        for m in PRIVATE_KEY.finditer(text):
            hits.append(PatternHit("private_key", m.start(), m.end(), "critical", "A private key block."))
        for rx, what in API_KEYS:
            for m in rx.finditer(text):
                hits.append(PatternHit("api_key", m.start(), m.end(), "critical", f"Looks like {what}."))
        for m in JWT.finditer(text):
            hits.append(PatternHit("jwt", m.start(), m.end(), "critical", "A signed session token (JWT)."))
        for m in PASSWORD.finditer(text):
            hits.append(PatternHit("password", m.start(), m.end(), "critical", "A password assignment."))
        for m in CARD.finditer(text):
            d = re.sub(r"\D", "", m.group(0))
            if 13 <= len(d) <= 19 and d[0] in "3456" and luhn_ok(d) and len(set(d)) > 2:
                hits.append(PatternHit("credit_card", m.start(), m.end(), "critical",
                                       "A payment card number (valid checksum)."))
        for m in SSN_SEP.finditer(text):
            hits.append(PatternHit("ssn", m.start(), m.end(), "high", "Formatted like a Social Security number."))
        for m in SSN_BARE.finditer(text):
            if _near(SSN_CUE, text, m.start(), m.end()):
                hits.append(PatternHit("ssn", m.start(), m.end(), "high", "Nine digits next to an SSN cue."))
        for m in EMAIL.finditer(text):
            dom = m.group(0).rsplit("@", 1)[1].lower()
            if dom.endswith(".gov") or dom.endswith(".mil") or dom in {"example.com", "example.org", "example.net"}:
                continue
            hits.append(PatternHit("email", m.start(), m.end(), "medium", "An email address."))
        for m in PHONE.finditer(text):
            if m.group(1) in TOLL_FREE:
                continue
            if any(h.start <= m.start() < h.end for h in hits if h.kind in ("ssn", "credit_card")):
                continue
            hits.append(PatternHit("phone", m.start(), m.end(), "medium", "A personal phone number."))
        for m in IBAN.finditer(text):
            if re.search(r"\d{4}", m.group(0)[4:]):
                hits.append(PatternHit("iban", m.start(), m.end(), "high", "Looks like a bank account (IBAN)."))
        for m in IPV4.finditer(text):
            try:
                ip = ipaddress.ip_address(m.group(0))
            except ValueError:
                continue
            if ip.is_private and not ip.is_loopback:
                hits.append(PatternHit("ip_address", m.start(), m.end(), "medium", "An internal network address."))
        for m in DATE.finditer(text):
            if _near(DOB_CUE, text, m.start(), m.end()):
                hits.append(PatternHit("dob", m.start(), m.end(), "medium", "A date of birth."))
    except Exception:
        pass
    return hits
