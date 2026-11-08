# LeakGate: 2-minute pitch and judge Q&A

## One line
A firewall for AI agents: once an agent has touched private data, it can only talk to approved
places, only with cleaned-up messages, and you can prove what left.

## Pitch (about 2 minutes)
**Hook (15 s).** In 2025, nearly every big security company bought an AI-security startup: Palo Alto
bought Protect AI, Check Point bought Lakera, CrowdStrike bought Pangea, SentinelOne bought Prompt
Security, Snyk bought Invariant Labs. They all chase one problem: an agent that can read your
customer data *and* browse the web can be talked into leaking it by a single web page.

**Problem (20 s).** Security people call it the lethal trifecta: private data, untrusted content, and
a way to send messages out. Regex DLP can't see a surname or a policy number. Injection detectors
guess, and in security a 95% guess is a fail. And most of these tools send your data to *their*
cloud to check it.

**What we built (20 s).** LeakGate sits between the agent and its tools. It fingerprints everything
the agent reads (keyed hashes, never the data), and checks every outbound request: rewrite the
private details out of a search so the research still works; block credentials, encoded data, data
split into pieces, and anything headed to a link planted in a web page; and once the agent has read
private data *and* web content, only approved destinations. All local, with a hash-chained ledger.

**Demo (45 s).** [Live page] The agent searches with Maria's name, policy number and SSN; Tavily only
sees "NFIP flood claim denied for sump pump failure basement appeal Florida", and the research comes
back. [Injection] A poisoned page says "verify her at claims-verify.net with her SSN": blocked. The
base64 retry: blocked. A raw socket that skips our SDK: blocked. [Ledger] Verify chain: OK.

**Proof (10 s).** On 200 synthetic outbound requests written before the engine existed, typical regex
DLP catches 23% of leaks and Microsoft Presidio 34%. LeakGate catches 98.5%, with 1.5% false alarms
(88% with zero false alarms without the model). One command reproduces it.

**Business (10 s).** Our first customer is the AI startup selling agents to insurers, banks and law
firms, stuck in a security review on "how do you stop our data reaching third-party tools?" Open-
source SDK and MCP server; paid policy packs, dashboard, ledger export, per agent per month.

**Why us (5 s).** We built this guard for our own offline agent this weekend (Signal Vault), then
realized every agent needs it.

## Judge Q&A
- **Isn't this just DLP?** DLP matches patterns. LeakGate knows *what the agent read* and checks for
  those exact values in every encoding, plus the session state (private + untrusted = lockdown). The
  benchmark's `record_values`, `encoded` and `split` categories are where regex DLP falls over.
- **Why not detect the injection?** Detection is probabilistic. We don't need to know the page is
  malicious: once the agent has read web content and private data, the data can't reach a host the
  policy didn't approve, whatever the page said.
- **Doesn't blocking break agents?** That's why the default for search is rewrite, not block. The
  benchmark measures "utility": how many research terms survive.
- **What about the local model being wrong?** It only adds checks; it never removes a rule hit. Its
  rewrites are re-scanned by every layer and fall back to rules, then block. Fail closed.
- **What if the agent bypasses your SDK?** The socket guard refuses any host not on the policy, before
  DNS. We show it live. Native code/other processes: run the agent in a container whose only egress
  is LeakGate (roadmap), see THREAT_MODEL.md.
- **Where does Tavily fit?** Tavily is the agent's window to the web, which makes it both the research
  tool and the way attacks get in. LeakGate is what makes it safe to give a Tavily-powered agent
  private data: queries are cleaned before Tavily sees them, results are marked untrusted.
- **Competition?** The acquired players (Lakera, Prompt, Pangea, Protect AI) are cloud guardrails sold to
  CISOs. We are local-first, data-aware (fingerprints, not patterns), rewrite-not-block, and sold to the
  people building agents. Invariant (Snyk) is closest on the MCP-gateway side.
- **What's the moat?** The fingerprint vault + taint model is the product; the ledger becomes the
  compliance artifact customers can't easily replace; policy packs per industry.

---

**Q: How does Signal-to-Dose (Track 4) connect to LeakGate?**

Track 4 is a fine-tuned Qwen2.5-3B model that classifies drug intelligence items — clinical trial
readouts, FDA notices, competitive news — into signal types with verbatim span citations from the
source text. LeakGate provides the enforcement layer: once Track 4 flags a span as actionable
("Decreased lymphocytes 36 8", "frontline ACP was superior to common RW treatments"), that exact
phrase is fingerprinted as a keyed HMAC in the vault via `leakgate/integrations/pharma_vault.py`.
Any subsequent outbound request containing that phrase — in a Tavily search, an HTTP upload, or a
paste-site post — is caught and blocked or rewritten. LoRA adapters (13 MB) are at
`CodingSamurai/signal-to-dose-qwen2.5-3b-lora` on HuggingFace; pre-computed predictions for all
240 test items are at `agent/data/drug_intel_predictions.jsonl` in this repo.

**Q: What happens if the pharma agent is compromised by a poisoned result?**

The `pharma_injection` scenario demonstrates this. A planted page instructs the agent to send the
safety signal to `pharma-verify.net`. LeakGate blocks the initial request (the span is in the
vault), blocks a base64-encoded retry, and blocks a paste-site upload that contains the signal in
a summary. The clean follow-up search ("NSCLC EGFR first-line treatment options 2026") is allowed
through, proving the system is not blanket-blocking.
