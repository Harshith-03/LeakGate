"""THE CONTRACT. Every LeakGate module, the API and the UI speak these models.

Change a model here first, then CONTRACTS.md, then the code. The UI mirrors these shapes in
app/web/src/api/types.ts.

Privacy rule baked into the shapes: nothing in a Decision, AgentEvent or LedgerRecord carries a raw
sensitive value. Findings carry a masked `preview`; `attempted` is pre-masked display segments;
the ledger stores keyed hashes of what was attempted plus the payload that actually left (which is
clean by construction, and left anyway).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, computed_field

Channel = Literal["search", "extract", "http", "llm", "tool"]
Action = Literal["allow", "rewrite", "redact", "block"]
Severity = Literal["low", "medium", "high", "critical"]
Layer = Literal["destination", "taint", "pattern", "fingerprint", "context"]
Encoding = Literal["plain", "normalized", "url", "base64", "hex", "spaced", "words", "split", "unicode", "reversed"]

# Finding kinds (Finding.kind). Patterns find the first group without knowing your data; the vault
# (fingerprint layer) finds the second group because it knows what the agent has read.
PATTERN_KINDS = ["ssn", "credit_card", "email", "phone", "iban", "api_key", "private_key", "jwt",
                 "password", "ip_address", "dob"]
FINGERPRINT_KINDS = ["private_record", "confidential_term", "private_passage"]
CONTEXT_KINDS = ["personal_context", "confidential_business"]
POLICY_KINDS = ["not_allowlisted", "untrusted_url", "exfil_url", "split_leak"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class OutboundRequest(BaseModel):
    """One thing an agent is about to send out of the machine."""
    id: str
    session_id: str
    channel: Channel
    tool: str = Field(description='"tavily.search" | "tavily.extract" | "http.get" | "http.post" | "llm.chat" | ...')
    destination: str = Field(description="host only, lower-case, e.g. api.tavily.com")
    url: Optional[str] = None
    payload: dict[str, Any] = Field(default_factory=dict, description="exactly what would leave; scanned recursively")
    origin: str = Field("agent", description='"agent", or "untrusted:<url>" when the URL/arguments came from web content')
    ts: str = Field(default_factory=now_iso)


class Finding(BaseModel):
    layer: Layer
    kind: str
    field: str = Field(description='payload path: "query", "params.d", "url", "body.messages[0].content"')
    start: Optional[int] = Field(None, description="offset in the ORIGINAL field string; None if only found decoded/split")
    end: Optional[int] = None
    preview: str = Field(description='masked, e.g. "•••-••-6789"; never the raw value')
    encoding: Encoding = "plain"
    source_ref: Optional[str] = Field(None, description='vault reference "crm:C-1042.ssn" (field name, never the value)')
    severity: Severity
    explanation: str


class Segment(BaseModel):
    """Display text for the 'what the agent tried to send' view. Sensitive parts are already masked."""
    text: str
    finding: Optional[int] = Field(None, description="index into Decision.findings when this segment is a hit")


class TaintState(BaseModel):
    private: bool = False
    untrusted: bool = False
    private_sources: list[str] = Field(default_factory=list, description='"crm:C-1042"')
    untrusted_sources: list[str] = Field(default_factory=list, description="URLs of web content the agent read")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def lockdown(self) -> bool:
        """The 'lethal trifecta' guard: private data + untrusted content ⇒ only approved destinations."""
        return self.private and self.untrusted


class Decision(BaseModel):
    request_id: str
    session_id: str
    channel: Channel
    tool: str
    destination: str
    action: Action
    reason: str = Field(description="one plain-English sentence for the UI")
    findings: list[Finding] = Field(default_factory=list)
    attempted: dict[str, list[Segment]] = Field(default_factory=dict, description="field path -> masked segments")
    sent: Optional[dict[str, Any]] = Field(None, description="exactly what left; None when blocked")
    sent_url: Optional[str] = Field(None, description="the URL that left (http/extract), path and query included")
    rewritten_by: Optional[Literal["model", "rules"]] = None
    taint: TaintState = Field(default_factory=TaintState)
    mode: Literal["enforce", "monitor"] = "enforce"
    latency_ms: float = 0.0
    layer_ms: dict[str, float] = Field(default_factory=dict)
    ts: str = Field(default_factory=now_iso)
    ledger_seq: Optional[int] = None


class DestinationRule(BaseModel):
    host: str
    channels: list[Channel]
    purpose: str
    allow_in_lockdown: bool = True


class Policy(BaseModel):
    name: str = "default"
    mode: Literal["enforce", "monitor"] = "enforce"
    destinations: list[DestinationRule] = Field(default_factory=list)
    block_kinds: list[str] = Field(default_factory=lambda: ["api_key", "private_key", "jwt", "password",
                                                            "credit_card", "exfil_url", "split_leak"])
    rewrite_channels: list[Channel] = Field(default_factory=lambda: ["search"])
    use_context_model: bool = True
    confidential_terms: list[str] = Field(default_factory=list,
                                          description="codenames etc.; fingerprinted at load, never displayed")


class LedgerRecord(BaseModel):
    """One line of the hash-chained egress ledger (outputs/ledger.jsonl)."""
    seq: int
    ts: str
    session_id: str
    request_id: str
    tool: str
    channel: Channel
    destination: str
    action: Action
    kinds: list[str] = Field(default_factory=list)
    attempted_hmac: str = Field(description="HMAC-SHA256 (install key) of the canonical attempted payload")
    sent: Optional[dict[str, Any]] = Field(None, description="the payload that actually left (clean by construction)")
    sent_url: Optional[str] = Field(None, description="the URL that actually left, if any")
    sent_sha256: Optional[str] = None
    findings: int = 0
    prev_hash: str = ""


class LedgerStatus(BaseModel):
    ok: bool
    records: int
    head: Optional[str] = None
    broken_at: Optional[int] = Field(None, description="seq of the first record that fails verification")


class AgentEvent(BaseModel):
    """What the Live page renders, in order."""
    seq: int
    session_id: str
    ts: str = Field(default_factory=now_iso)
    type: Literal["task", "thought", "tool_call", "tool_result", "egress", "answer", "error", "info"]
    title: str
    detail: Optional[str] = Field(None, description="masked text")
    decision: Optional[Decision] = None
    taint: TaintState = Field(default_factory=TaintState)
    citations: list[dict[str, str]] = Field(default_factory=list, description='[{"title","url"}] on answer events')


class SessionInfo(BaseModel):
    session_id: str
    scenario: str
    mode: Literal["scripted", "live"]
    status: Literal["running", "done", "error"]
    started: str
    events: int = 0
    counts: dict[str, int] = Field(default_factory=dict, description="action -> number of egress decisions")
    taint: TaintState = Field(default_factory=TaintState)


class ScenarioInfo(BaseModel):
    name: str
    title: str
    description: str
    modes: list[Literal["scripted", "live"]]


class VaultSummary(BaseModel):
    """What the gate knows, WITHOUT values: sources, field names and fingerprint counts."""
    sources: list[dict[str, Any]] = Field(default_factory=list, description='[{"source","fields":[...],"fingerprints":n}]')
    confidential_terms: int = 0
    fingerprints: int = 0
    key_id: str = Field(description="first 8 hex chars of sha256(install key): identifies the key, reveals nothing")
