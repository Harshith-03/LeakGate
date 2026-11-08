"""Layer 5: the local model catches what rules can't see.

    check(text, destination, channel, read_sources) -> ContextResult

Rules know formats and the vault knows exact values. Neither knows that "the retired teacher on
Ocean Breeze with the four-hundred-thousand flood claim" points at one person, or that "Northwind
will stop writing Florida homeowners next quarter" is an unreleased plan. The local model does.

Grounding: the model must quote the phrase that discloses. If the quote is in the text we highlight
it; if it is not, we still act (safety first) but mark the finding as unverified and medium severity.
Runs on 127.0.0.1 only. Returns `ran=False` when the model is unavailable, never raises.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from . import llm

SYSTEM = """You review text that an AI agent is about to send OUT of a company to an external service such as a public web search engine or a website.

Flag it only if it discloses at least one of:
1. personal details about a specific private individual: who they are, their health, finances, family or legal situation, a home location more precise than a city, or details of their own claim or account;
2. confidential non-public business information: internal plans or decisions, unreleased figures, codenames, legal strategy, reserves, pricing not yet public.

Do NOT flag: general research questions; laws, regulations, court cases and public agencies; public statistics and public companies; generic descriptions of kinds of people or situations ("homeowners with flood damage", "elderly policyholders"); cities, counties and states.

Answer in JSON. If you flag, `evidence` must be the shortest phrase copied exactly from the text that discloses it. If you do not flag, use kind "none" and an empty evidence string."""

SCHEMA = llm.schema_of({
    "discloses": {"type": "boolean"},
    "kind": {"type": "string", "enum": ["personal_context", "confidential_business", "none"]},
    "evidence": {"type": "string"},
    "reason": {"type": "string"},
}, ["discloses", "kind", "evidence", "reason"])

FEWSHOT = [
    ("api.tavily.com (search)", "NFIP flood claim proof of loss deadline Florida 2026",
     {"discloses": False, "kind": "none", "evidence": "", "reason": "General regulatory research."}),
    ("api.tavily.com (search)", "can an insurer deny a flood claim for the widow on Seagrape Ct who just started dialysis",
     {"discloses": True, "kind": "personal_context", "evidence": "the widow on Seagrape Ct who just started dialysis",
      "reason": "Identifies a specific person by street and discloses a health condition."}),
    ("api.tavily.com (search)", "how do insurers price wind risk for elderly homeowners in coastal counties",
     {"discloses": False, "kind": "none", "evidence": "", "reason": "Generic description of a group, not an individual."}),
    ("api.tavily.com (search)", "additional living expense coverage for policyholders with disabilities or undergoing cancer treatment after a hurricane",
     {"discloses": False, "kind": "none", "evidence": "", "reason": "A category of policyholders, not a specific person."}),
    ("api.tavily.com (search)", "regulatory filing needed if we quietly stop renewing all condo policies in Miami-Dade in March",
     {"discloses": True, "kind": "confidential_business", "evidence": "we quietly stop renewing all condo policies in Miami-Dade in March",
      "reason": "Reveals an unannounced internal business plan."}),
]


@dataclass
class ContextResult:
    ran: bool
    discloses: bool = False
    kind: str = "none"
    evidence: str = ""
    reason: str = ""
    start: Optional[int] = None
    end: Optional[int] = None


def _locate(evidence: str, text: str) -> Optional[tuple[int, int]]:
    if not evidence:
        return None
    i = text.find(evidence)
    if i < 0:
        i = text.casefold().find(evidence.casefold())
    if i >= 0:
        return i, i + len(evidence)
    norm = lambda s: re.sub(r"\s+", " ", s).strip().casefold()          # noqa: E731
    ev = norm(evidence)
    j = norm(text).find(ev)
    if j >= 0:                     # map back roughly through whitespace collapse
        words = re.finditer(r"\S+", text)
        spans = [(m.start(), m.end()) for m in words]
        cum, k = 0, None
        for idx, (s, e) in enumerate(spans):
            if cum >= j and k is None:
                k = idx
            cum += (e - s) + 1
        if k is not None:
            n_words = len(ev.split())
            last = min(k + n_words - 1, len(spans) - 1)
            return spans[k][0], spans[last][1]
    return None


def check(text: str, destination: str, channel: str, read_sources: list[str], model: Optional[str] = None) -> ContextResult:
    if not text or not text.strip():
        return ContextResult(ran=True)
    reads = ", ".join(sorted({s.split(":")[0] for s in read_sources})) or "nothing private"
    msgs: list[dict] = []
    for dest, ex, ans in FEWSHOT:
        msgs.append({"role": "user", "content": f"Destination: {dest}\nText:\n<<<{ex}>>>"})
        msgs.append({"role": "assistant", "content": __import__("json").dumps(ans)})
    msgs.append({"role": "user", "content": f"Destination: {destination} ({channel})\n"
                                           f"(The agent has read: {reads}.)\nText:\n<<<{text[:2000]}>>>"})
    out = llm.chat_json(SYSTEM, msgs, SCHEMA, model=model)
    if out is None:
        return ContextResult(ran=False)
    if not out.get("discloses") or out.get("kind") == "none":
        return ContextResult(ran=True)
    ev = str(out.get("evidence") or "").strip()
    loc = _locate(ev, text)
    return ContextResult(ran=True, discloses=True, kind=str(out.get("kind")), evidence=ev,
                         reason=str(out.get("reason") or "").strip(),
                         start=loc[0] if loc else None, end=loc[1] if loc else None)
