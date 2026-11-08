# LeakGate threat model

What LeakGate protects, against whom, and where it stops. Written so a security reviewer can
disagree with specifics.

## Asset
Private data an AI agent can read: customer records (names, SSNs, policy and claim numbers,
addresses, notes), internal codenames and plans, credentials.

## The attack we design for
The **lethal trifecta** (Simon Willison, June 2025): an agent that has (1) access to private data,
(2) exposure to untrusted content, and (3) a way to communicate externally can be steered by that
content into sending the private data out. Prompt-injection *detection* is a probabilistic game
("95% is a failing grade" in web security), so LeakGate does not rely on spotting the injection.
It controls the third leg, the egress, using what it knows about the first two:

| Session state | What may leave |
|---|---|
| Nothing private read | Anything to approved hosts; unapproved hosts allowed and noted |
| Private data read | Every outbound payload is scanned; private values are rewritten out of search queries or the request is blocked |
| Private data **and** untrusted content read (**lockdown**) | Only approved destinations, only clean payloads; any link that came from web content and carries data is an exfiltration and is blocked |

## Where it sits
In-process SDK around the agent's tools (Tavily search/extract, HTTP, LangChain tools, LLM calls),
plus a **socket guard** in the same process that refuses connections to any host not on the policy.
The SDK understands content; the socket guard enforces "approved hosts only" even for code that
bypasses the SDK (shown live in the injection demo).

## Detection layers (fail closed)
1. Destination allowlist per channel.
2. Taint: links seen in untrusted content; `origin="untrusted:..."`.
3. Patterns: SSN, Luhn-valid cards, emails, personal phones, IBAN, API keys (incl. Tavily/OpenAI/AWS/GitHub/Slack/Google), private keys, JWTs, passwords, internal IPs, DOB with a cue.
4. Vault fingerprints: keyed HMAC of every normalised form of every value the agent read, matched on plain text and decoded views (URL, base64, hex, number words, zero-width/homoglyph tricks, spaced and reversed digits), plus values split across consecutive requests.
5. Local model (Ollama, 127.0.0.1): paraphrased personal context and unreleased business information; must quote its evidence.

Any rewrite is re-scanned by every layer; if it is still dirty, rules remove the spans; if that is
still dirty or empty, the request is blocked. Internal errors block.

## What LeakGate does NOT stop (honest limits)
- **Data the agent never "read" through LeakGate and that has no pattern.** The vault only knows what was loaded (`load_private`) or pre-registered (`register_source`). Pre-register your data sources.
- **Clever paraphrase** beyond a small model's judgment ("the lady from the Ocean street file"). The context layer catches many; not all. The benchmark reports this category separately.
- **Slow exfiltration below the split window.** The split buffer covers consecutive pieces of digit values (last 8 fragments); a patient attacker spreading single digits over hours across sessions is out of scope for v0.
- **Native code and other processes.** The socket guard patches Python's socket module. Native extensions or subprocesses can open their own sockets: run agents in a container whose only egress is the LeakGate proxy (roadmap).
- **The local machine itself.** LeakGate assumes the host is not compromised.
- **Tamper-proof logging.** The ledger is tamper-*evident* (hash chain + head file). Someone who rewrites the whole file and head can forge it; anchor the head hash externally.
- **Monitor mode** sends the original payload by design (for rollout); the UI says so on every decision.

## What leaves the machine, exactly
- To Tavily/Exa: the cleaned query in `Decision.sent` (shown verbatim in the UI and stored in the ledger).
- Nothing else. The model, the vault and the ledger are local. The dashboard and API bind to 127.0.0.1.

## Who can read what
- The vault stores keyed hashes (install key in `outputs/install.key`, gitignored), not values.
- The ledger stores HMACs of attempted payloads and the clean payload that left.
- The UI and API never return raw sensitive values: findings carry masked previews, attempted payloads are pre-masked segments, agent text is masked through the vault before display, policy codenames are masked.
