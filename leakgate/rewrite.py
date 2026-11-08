"""Rewrite, don't just block: keep the agent's research working without the private details.

    rewrite_query(query, remove, generalize) -> (new_query, by)     # by in {"model", "rules"}
    strip_spans(text, spans) -> str                                  # the rules fallback

The local model gets the exact spans to remove (it runs on 127.0.0.1, so showing it the private
text is not an egress). Whatever it returns is NOT trusted: the gate re-scans the rewrite with every
layer, and if anything is still there it falls back to rule-based removal, and if THAT is still
dirty, it blocks. A firewall must fail closed.
"""
from __future__ import annotations

import re
from typing import Optional

from . import llm

SYSTEM = """You rewrite web search queries for an AI research agent so they can be sent to a public search engine without leaking private details.

Keep the research intent: the topic and question, laws, regulations, agencies, insurance products and terms, and places at state level.
Remove or generalize every private detail you are given, and any similar ones: names of private people, ID/policy/claim/account numbers, SSNs, phone numbers, emails, street addresses, exact amounts tied to a person, dates of birth, health or family details, internal codenames and unreleased business information.
Never add facts that were not in the query. Return JSON {"query": "..."}: one concise search query in plain words."""

SCHEMA = llm.schema_of({"query": {"type": "string"}}, ["query"])

FEWSHOT = [
    ("Maria Lopez SSN 123-45-6789 flood claim Naples FL denied sump pump, appeal rules",
     ["Maria Lopez", "123-45-6789"], ["Naples"],
     "flood claim denied for sump pump failure appeal rules Florida"),
    ("does Project Kestrel reserve methodology comply with Florida statute 627.70131 for claim CLM-2025-55120",
     ["Project Kestrel", "CLM-2025-55120"], [],
     "Florida statute 627.70131 claim handling reserve methodology compliance"),
]

# A label right before a removed value ("SSN 531-...", "policy # NWM-...") goes with it. Only labels:
# a plain topic word like "claim" in "flood claim Boca Raton" must survive.
CUE_BEFORE = re.compile(
    r"(?:\b(?:ssn|social security(?: number| no\.?)?|dob|date of birth|born(?: on)?|"
    r"policy(?: number| no\.?| #| id)?|claim(?: id| number| no\.?| #)|phone(?: number)?|tel|e-?mail|"
    r"card(?: number)?|account(?: number)?|insured|policyholder|customer|client|id|no\.?|#)\s*[:#=]?\s*)$", re.I)


def strip_spans(text: str, spans: list[tuple[int, int]]) -> str:
    """Delete spans (and a cue word right before each, like 'SSN' or 'policy #'), then tidy."""
    out = text
    for s, e in sorted(set(spans), reverse=True):
        before = out[:s]
        m = CUE_BEFORE.search(before)
        if m:
            before = before[:m.start()]
        out = before + " " + out[e:]
    out = re.sub(r"\(\s*\)|\[\s*\]", " ", out)
    out = re.sub(r"\s*([,;:])\s*(?=[,;:]|$)", " ", out)
    out = re.sub(r"\s+", " ", out).strip(" ,;:-")
    return out


def rewrite_query(query: str, remove: list[str], generalize: list[str], model: Optional[str] = None) -> tuple[Optional[str], str]:
    """(rewritten, "model") or (None, "model") if the model is unavailable/declined. Never raises."""
    msgs: list[dict] = []
    for q, rm, gen, ans in FEWSHOT:
        msgs.append({"role": "user", "content": f"Query: <<<{q}>>>\nPrivate details to remove: {rm}\nGeneralize if useful: {gen}"})
        msgs.append({"role": "assistant", "content": '{"query": "%s"}' % ans})
    msgs.append({"role": "user", "content": f"Query: <<<{query}>>>\nPrivate details to remove: {remove}\nGeneralize if useful: {generalize}"})
    out = llm.chat_json(SYSTEM, msgs, SCHEMA, model=model, num_predict=128)
    q = (out or {}).get("query")
    if not isinstance(q, str) or not q.strip():
        return None, "model"
    return re.sub(r"\s+", " ", q).strip(), "model"
