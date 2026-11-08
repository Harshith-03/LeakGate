"""Decoded views of an outbound string, each mapped back to the span of the original it came from.

    variants(s) -> list[Variant]

An agent (or an attacker steering it) can hide data in transport encodings. We look at the plain
text and at what it decodes to, so a fingerprint or pattern hit in a decoded view can still point
at (and mask) the exact characters in the original:

  plain     the string itself
  unicode   NFKC + zero-width characters removed + common Cyrillic/Greek homoglyphs mapped to Latin
  url       percent-decoded query-parameter values (and the whole string if it is %-encoded)
  base64    tokens that decode (std or url-safe) to mostly printable text
  hex       even-length hex tokens with at least one a-f letter that decode to printable text
  words     runs of number words ("five three one ...") as digits

Spaced digits and reversed digits are handled by the digit matcher in fingerprint.py.
Decoding nests up to MAX_DEPTH (e.g. base64 inside a URL parameter).
"""
from __future__ import annotations

import base64
import binascii
import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import unquote_plus

MAX_DEPTH = 3
MAX_VARIANTS = 64

ZERO_WIDTH = {"​", "‌", "‍", "‎", "‏", "⁠", "⁡", "⁢", "⁣",
              "⁤", "﻿", "­", "᠎"}
HOMOGLYPHS = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s",
    "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T",
    "Х": "X", "І": "I", "Ј": "J", "Ѕ": "S", "ο": "o", "Ο": "O", "α": "a", "Α": "A", "ν": "v", "Β": "B",
    "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ρ": "P", "Τ": "T", "Υ": "Y",
    "Χ": "X", "ⅰ": "i", "ⅼ": "l",
})
NUMBER_WORDS = {"zero": "0", "oh": "0", "o": "0", "one": "1", "two": "2", "three": "3", "four": "4",
                "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9"}

_PARAM = re.compile(r"(?:(?<=[?&;])|^)([^=&?#;\s]{1,64})=([^&#;\s]*)")
_B64 = re.compile(r"[A-Za-z0-9+/_-]{8,}={0,2}")
_HEX = re.compile(r"(?:0x)?([0-9a-fA-F]{8,})")
_WORDRUN = re.compile(r"\b(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b[\s,;.-]*){4,}", re.I)


@dataclass(frozen=True)
class Variant:
    text: str
    encoding: str          # schema.Encoding
    start: int             # span in the ORIGINAL string this view was decoded from
    end: int
    index: tuple[int, ...] | None = None   # per-char map text[i] -> original offset (unicode view only)

    def span_of(self, s: int, e: int) -> tuple[int, int]:
        """Original-string span for a hit at text[s:e] in this view."""
        if self.index is not None and self.index:
            s2 = self.index[min(s, len(self.index) - 1)]
            e2 = self.index[min(max(e - 1, 0), len(self.index) - 1)] + 1
            return s2, e2
        if self.encoding == "plain":
            return self.start + s, self.start + e
        return self.start, self.end            # decoded token: the whole token is the evidence


def _printable_ratio(s: str) -> float:
    if not s:
        return 0.0
    ok = sum(1 for c in s if c.isprintable() and c not in "\x0b\x0c")
    return ok / len(s)


def _try_b64(tok: str) -> str | None:
    if tok.isdigit() or tok.isalpha() and tok.islower():     # plain words/numbers are not base64 worth decoding
        return None
    raw = tok.rstrip("=")
    for alt in (False, True):
        t = raw.replace("-", "+").replace("_", "/") if alt else raw
        try:
            b = base64.b64decode(t + "=" * (-len(t) % 4), validate=True)
        except (binascii.Error, ValueError):
            continue
        try:
            s = b.decode("utf-8")
        except UnicodeDecodeError:
            continue
        if len(s) >= 4 and _printable_ratio(s) >= 0.9 and sum(c.isalnum() for c in s) >= 3:
            return s
    return None


def _try_hex(tok: str) -> str | None:
    if len(tok) % 2 or not re.search(r"[a-fA-F]", tok):
        return None
    try:
        s = bytes.fromhex(tok).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    return s if len(s) >= 4 and _printable_ratio(s) >= 0.9 else None


def unicode_view(s: str) -> tuple[str, tuple[int, ...]]:
    out: list[str] = []
    idx: list[int] = []
    for i, c in enumerate(s):
        if c in ZERO_WIDTH:
            continue
        n = unicodedata.normalize("NFKC", c).translate(HOMOGLYPHS)
        for ch in n:
            out.append(ch)
            idx.append(i)
    return "".join(out), tuple(idx)


def _decode_once(text: str, base: int, end: int) -> list[Variant]:
    """Decoded views found directly inside `text` (which spans original[base:end] for decoded views)."""
    found: list[Variant] = []
    plain = base == 0 and end == len(text)

    def span(s: int, e: int) -> tuple[int, int]:
        return (s, e) if plain else (base, end)

    if "%" in text or "+" in text:
        for m in _PARAM.finditer(text):
            val = m.group(2)
            dec = unquote_plus(val)
            if dec != val and dec.strip():
                found.append(Variant(dec, "url", *span(m.start(2), m.end(2))))
        whole = unquote_plus(text)
        if whole != text and "%" in text:
            found.append(Variant(whole, "url", base, end))
    for m in _B64.finditer(text):
        dec = _try_b64(m.group(0))
        if dec:
            found.append(Variant(dec, "base64", *span(m.start(), m.end())))
    for m in _HEX.finditer(text):
        dec = _try_hex(m.group(1))
        if dec:
            found.append(Variant(dec, "hex", *span(m.start(), m.end())))
    for m in _WORDRUN.finditer(text):
        digits = "".join(NUMBER_WORDS[w.lower()] for w in re.findall(r"[A-Za-z]+", m.group(0))
                         if w.lower() in NUMBER_WORDS)
        if len(digits) >= 4:
            found.append(Variant(digits, "words", *span(m.start(), m.end())))
    return found


def variants(s: str) -> list[Variant]:
    """All views of `s`, plain first. Never raises."""
    if not isinstance(s, str) or not s:
        return []
    out = [Variant(s, "plain", 0, len(s))]
    try:
        uni, idx = unicode_view(s)
        if uni != s:
            out.append(Variant(uni, "unicode", 0, len(s), idx))
        frontier = [(s, 0, len(s))] + ([(uni, 0, len(s))] if uni != s else [])
        seen = {s, uni}
        for _ in range(MAX_DEPTH):
            nxt = []
            for text, b, e in frontier:
                for v in _decode_once(text, b, e):
                    if v.text in seen:
                        continue
                    seen.add(v.text)
                    out.append(v)
                    nxt.append((v.text, v.start, v.end))
                    u2, _ = unicode_view(v.text)            # e.g. zero-width chars, then percent-encoded
                    if u2 != v.text and u2 not in seen:
                        seen.add(u2)
                        out.append(Variant(u2, "unicode", v.start, v.end))
                        nxt.append((u2, v.start, v.end))
                    if len(out) >= MAX_VARIANTS:
                        return out
            frontier = nxt
            if not frontier:
                break
    except Exception:          # a decoder must never take the gate down; plain view is always there
        pass
    return out
