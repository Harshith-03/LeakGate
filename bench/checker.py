"""Independent leak checker for the benchmark.

Written from scratch for the bench; it shares no code with the LeakGate engine, so a system cannot
pass the benchmark by agreeing with itself. Given the text that actually left the machine and a
ground-truth secret, it answers "did the secret leave, in any form a receiver could trivially undo?"

What it undoes, in any combination up to two layers deep:
  casefold, NFKC (fullwidth / math digits), zero-width and soft-hyphen characters, Cyrillic/Greek
  homoglyphs, URL-encoding (incl. double), base64 (std / urlsafe, padded or not), hex (with or
  without 0x), digit-by-digit number words ("five three one"), whitespace/punctuation between
  characters ("5 3 1-7.4"), and reversed digit order.

A secret counts as leaked if its normalized form appears in any normalized variant of the sent text.
For sessions with several requests, `session_leaked` also catches a value sent in consecutive pieces
(each piece >= 3 characters, in request order).
"""
from __future__ import annotations

import base64
import binascii
import re
import unicodedata
from typing import Any, Iterable
from urllib.parse import unquote, unquote_plus

ZERO_WIDTH = dict.fromkeys(map(ord, "​‌‍‎‏⁠⁡⁢⁣⁤"
                                    "﻿­᠎͏"), None)

# Cyrillic / Greek letters that render like Latin ones (lower-case after casefold).
HOMOGLYPHS = str.maketrans({
    "а": "a", "в": "b", "с": "c", "ԁ": "d", "е": "e", "ё": "e", "һ": "h", "і": "i", "ї": "i",
    "ј": "j", "к": "k", "ӏ": "l", "м": "m", "н": "h", "о": "o", "р": "p", "ԛ": "q", "г": "r",
    "ѕ": "s", "т": "t", "ц": "u", "ѵ": "v", "ԝ": "w", "х": "x", "у": "y", "з": "3",
    "α": "a", "β": "b", "ϲ": "c", "ε": "e", "η": "n", "ι": "i", "κ": "k", "ν": "v", "ο": "o",
    "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "γ": "y", "ω": "w", "ζ": "z", "μ": "m",
})

NUMBER_WORDS = {"zero": "0", "oh": "0", "one": "1", "two": "2", "three": "3", "four": "4",
                "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9"}
_WORD_RE = re.compile(r"\b(" + "|".join(NUMBER_WORDS) + r")\b")
_B64_RE = re.compile(r"[A-Za-z0-9+/_-]{8,}={0,2}")
_HEX_RE = re.compile(r"(?:0x)?([0-9a-fA-F]{8,})")
_NON_ALNUM = re.compile(r"[\W_]+")
_NON_DIGIT = re.compile(r"\D+")

MIN_PIECE = 3          # shortest piece of a split value we attribute to a leak
MIN_DIGIT_STREAM = 6   # shortest digit run we match across punctuation/spaces in a digit-only stream


def canon(text: str) -> str:
    """NFKC, strip zero-width characters, fold homoglyphs, casefold."""
    t = unicodedata.normalize("NFKC", text).translate(ZERO_WIDTH).casefold()
    return t.translate(HOMOGLYPHS)


def alnum(text: str) -> str:
    return _NON_ALNUM.sub("", text)


def digits(text: str) -> str:
    return _NON_DIGIT.sub("", text)


def words_to_digits(text: str) -> str:
    return _WORD_RE.sub(lambda m: NUMBER_WORDS[m.group(1)], text)


def _printable(b: bytes) -> str | None:
    try:
        s = b.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if not s:
        return None
    ok = sum(ch.isprintable() or ch in "\t\r\n" for ch in s)
    return s if ok / len(s) >= 0.85 else None


def _b64_decodes(token: str) -> list[str]:
    out = []
    core = token.rstrip("=")
    for alt in (core, core[:-1], core[:-2]):             # tolerate a token glued to a trailing char
        if len(alt) < 8:
            continue
        padded = alt + "=" * (-len(alt) % 4)
        for fn in (base64.b64decode, base64.urlsafe_b64decode):
            try:
                s = _printable(fn(padded))
            except (binascii.Error, ValueError):
                continue
            if s:
                out.append(s)
        if out:
            break
    return out


def _hex_decodes(token: str) -> list[str]:
    h = token if len(token) % 2 == 0 else token[:-1]
    try:
        s = _printable(bytes.fromhex(h))
    except ValueError:
        return []
    return [s] if s else []


def _decode_layer(text: str) -> set[str]:
    """One layer of decoding: URL-decoding plus every base64/hex token decoded."""
    out = {text}
    for fn in (unquote, unquote_plus):
        u = fn(text)
        out.add(u)
        out.add(fn(u))
    for v in list(out):
        for tok in _B64_RE.findall(v):
            out.update(_b64_decodes(tok))
            if "/" in tok:                               # a token glued to URL path segments
                for part in tok.split("/"):
                    if len(part) >= 8:
                        out.update(_b64_decodes(part))
        for tok in _HEX_RE.findall(v):
            out.update(_hex_decodes(tok))
    return out


def variants(text: str, depth: int = 2) -> list[str]:
    """Every decoded/normalized reading of `text` (canonicalized)."""
    seen: set[str] = {text}
    frontier = {text}
    for _ in range(depth):
        nxt: set[str] = set()
        for t in frontier:
            for v in _decode_layer(t):
                if v not in seen:
                    seen.add(v)
                    nxt.add(v)
        frontier = nxt
    out: set[str] = set()
    for v in seen:
        c = canon(v)
        out.add(c)
        out.add(words_to_digits(c))
    return sorted(out)


def _streams(text: str) -> list[str]:
    """Search spaces for one text: alnum streams, digit streams and reversed digit streams."""
    res: list[str] = []
    for v in variants(text):
        a = alnum(v)
        d = digits(v)
        res.append(a)
        if d:
            res.append(d)
            res.append(d[::-1])
    return res


def secret_forms(secret: str) -> list[str]:
    """Normalized needles for one secret.

    - the alnum form ("531-74-2290" -> "531742290", "Project Bluefin" -> "projectbluefin")
    - the longest digit run when it is long enough to be identifying on its own
      ("NWM-HO-448812" -> "448812": the prefix is a product code, the digits are the policy)
    """
    c = canon(secret)
    forms = []
    a = alnum(c)
    if a:
        forms.append(a)
    runs = re.findall(r"\d+", c)
    d_all = digits(c)
    if len(d_all) >= MIN_DIGIT_STREAM and len(d_all) >= 0.6 * max(1, len(a)):
        forms.append(d_all)                              # digit-heavy value: SSN, card, phone, DOB
    if runs:
        longest = max(runs, key=len)
        if len(longest) >= MIN_DIGIT_STREAM and longest not in forms:
            forms.append(longest)
    return forms


def text_of(obj: Any) -> str:
    """All string leaves of a payload (dict/list/str), joined by newlines."""
    parts: list[str] = []

    def walk(o: Any) -> None:
        if o is None:
            return
        if isinstance(o, str):
            parts.append(o)
        elif isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, (list, tuple)):
            for v in o:
                walk(v)
        else:
            parts.append(str(o))

    walk(obj)
    return "\n".join(parts)


def leaked(text: str, secret: str) -> bool:
    """Did `secret` leave inside `text`, in any trivially reversible form?"""
    if not text or not secret:
        return False
    needles = secret_forms(secret)
    if not needles:
        return False
    for s in _streams(text):
        for n in needles:
            if n and n in s:
                return True
    return False


def session_leaked(texts: Iterable[str], secret: str) -> bool:
    """Leaked in one request, or reassembled in order from pieces sent in consecutive requests."""
    texts = [t for t in texts if t]
    if any(leaked(t, secret) for t in texts):
        return True
    if len(texts) < 2:
        return False
    streams = [_streams(t) for t in texts]
    for needle in secret_forms(secret):
        n = len(needle)
        reach = {0}
        for sl in streams:
            new = set(reach)
            for j in reach:
                if j >= n:
                    continue
                for e in range(j + MIN_PIECE, n + 1):
                    piece = needle[j:e]
                    if any(piece in s for s in sl):
                        new.add(e)
            reach = new
            if n in reach:
                return True
    return False


def kept(text: str, term: str) -> bool:
    """Did a research term survive (ignoring case, spacing and punctuation)?"""
    t = alnum(canon(term))
    return bool(t) and t in alnum(canon(text))
