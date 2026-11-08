# LeakGate contracts

The single source of truth is `leakgate/schema.py`. This file explains how the pieces talk to each
other. If code and this file disagree, schema.py wins; fix this file.

## 0. Product in one line
Once an AI agent has touched private data, LeakGate only lets it talk to approved places, only with
cleaned-up messages, and proves what left.

## 1. Python API (`leakgate/`)

```python
from leakgate import Gate, Policy

gate = Gate.default()                       # policy from policies/default.json, ledger in outputs/
gate.vault.add_records("crm", records, public_fields={"state", ...})   # pre-register private data (keyed hashes only)
s = gate.session("demo-1")                  # per-agent-run state: taint + split buffer
s.load_private("crm:C-1042", record)        # fingerprints the record AND taints the session (private)
s.mark_untrusted(url, text)                 # agent read web content: taints session (untrusted), remembers URLs in text
d = s.inspect(channel="search", tool="tavily.search", destination="api.tavily.com",
              payload={"query": "..."}, url=None, origin="agent")       # -> Decision
if d.action != "block":
    send(d.sent)                            # ALWAYS send d.sent, never the original payload
gate.on_decision(callback)                  # callback(Decision) for live UIs
```

Layers, in order (each adds `Finding`s; timings in `Decision.layer_ms`):
1. **destination**: host on the policy allowlist for this channel? In lockdown (private + untrusted),
   anything not allowlisted is blocked (`not_allowlisted`).
2. **taint**: a URL whose host/params came from untrusted content (`origin="untrusted:..."` or seen in
   `mark_untrusted` text) carrying data in lockdown → `exfil_url` / `untrusted_url`.
3. **pattern**: SSN, card (Luhn), email, phone, IBAN, API keys, private keys, JWT, passwords, IPs, DOB.
4. **fingerprint**: keyed-hash match against everything in the vault, on the plain text AND on decoded
   variants (URL, base64, hex, spaced digits, number words, unicode tricks, reversed digits), plus a
   per-session split buffer (`split_leak`: a value sent in pieces across calls).
5. **context**: local model (Ollama) asks "does this disclose personal or confidential details?" for what
   the rules can't see (paraphrases, unreleased business plans). Only runs if 1-4 found nothing and the
   session is tainted (or the policy says always).

Actions: `allow` (clean) · `rewrite` (search channels: local model rewrites the query to keep the
research intent without the private details; the rewrite is re-scanned and falls back to rule-based
removal) · `redact` (non-search channels where spans can be cut) · `block` (policy `block_kinds`,
encoded/exfil attempts, anything not allowlisted in lockdown, or a rewrite that is still dirty).
`mode="monitor"` records the decision but sends the original (for rollout); the UI must show this.

Integrations:
```python
from leakgate.integrations.tavily import GuardedTavily     # .search(q, **kw) / .extract(urls)
from leakgate.integrations.http import guarded_get, guarded_post
from leakgate.integrations.langchain import guard_tool       # wrap any LangChain tool
from leakgate import netguard; netguard.install(gate)        # socket-level backstop: non-allowlisted hosts fail even if code bypasses the SDK
```
Every guarded call returns the decision with the result; tool results that bring web content back
call `mark_untrusted` automatically.

## 2. HTTP API (FastAPI, `app/api/main.py`, http://127.0.0.1:8100)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/status` | `{ok, mode, policy, model, model_available, tavily: "live"\|"replay", netguard: {installed, blocked, allowed_hosts, last_blocked}, ledger: LedgerStatus}` |
| GET | `/api/scenarios` | `ScenarioInfo[]` |
| POST | `/api/sessions` body `{scenario, mode: "scripted"\|"live"}` | `SessionInfo` (runs in background) |
| GET | `/api/sessions` | `SessionInfo[]` newest first |
| GET | `/api/sessions/{id}` | `SessionInfo` |
| GET | `/api/sessions/{id}/events?after=-1` | `AgentEvent[]` with `seq > after` (UI polls every ~400 ms) |
| POST | `/api/inspect` body `{channel, tool, destination, url?, payload, origin?, private?: bool, untrusted?: bool}` | `Decision` (Playground; a playground session with the demo vault) |
| GET | `/api/ledger?limit=200` | `LedgerRecord[]` newest first |
| GET | `/api/ledger/verify` | `LedgerStatus` |
| GET | `/api/policy` | `Policy` with `confidential_terms` masked (`"P•••••• B••••••"`) |
| GET | `/api/vault` | `VaultSummary` |
| GET | `/api/bench` | `BenchReport` (below) or `{available: false}` |

Errors: never a stack trace; `{detail: "..."}` with a 4xx/5xx.

## 3. Benchmark report (`outputs/bench.json`, served by `/api/bench`)

```json
{
  "available": true,
  "run_at": "2026-11-07T22:10:00Z",
  "n_cases": 200,
  "model": "qwen3:4b-instruct-2507-q4_K_M",
  "categories": {"benign_public": "Normal research", "benign_tricky": "Look-alikes (public numbers, dates)", "...": "..."},
  "systems": [
    {
      "name": "regex_dlp", "label": "Regex DLP (typical)",
      "catch_rate": 0.41, "false_alarm_rate": 0.03, "utility": 0.91,
      "p50_ms": 0.4, "p95_ms": 1.1,
      "per_category": {"direct_pii": {"n": 30, "correct": 29}, "...": {}}
    }
  ],
  "examples": [{"case_id": "enc-007", "category": "encoded", "description": "SSN base64 in a URL param",
                "outcomes": {"regex_dlp": "leaked", "leakgate_rules": "blocked", "leakgate_full": "blocked"}}]
}
```
Definitions:
- **catch_rate** (leak cases): the private value did not leave: blocked, or rewritten/redacted and the
  sent payload no longer contains it (checked against the case's ground-truth secrets, all encodings).
- **false_alarm_rate** (benign cases): blocked or altered when nothing private was present.
- **utility** (cases with `must_keep` terms that were not blocked): share of the research terms that
  survived into what was sent. Blocked benign = 0.
Systems: `regex_dlp` (patterns only, what most DLP does), `leakgate_rules` (layers 1-4),
`leakgate_full` (layers 1-5 + model rewrite). Optional `presidio` if installed.

## 4. Demo data
`agent/data/customers.json`: 6 synthetic Northwind Mutual customers (fictional insurer, 555-01xx
phones, random Luhn-valid cards). `policies/default.json`: allowlist + confidential codenames
("Project Bluefin"). Nothing real, anywhere.

## 5. Privacy rules for every module
- Never log, print, store or return a raw sensitive value. Use `Finding.preview` (masked).
- The ledger stores HMACs of attempts and the clean payload that actually left; nothing else.
- Only `leakgate.integrations.*` and the Tavily/Exa clients open internet connections.
- The local model runs on 127.0.0.1 (Ollama). No cloud LLM anywhere.
