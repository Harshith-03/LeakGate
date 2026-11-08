# LeakGate (Devpost write-up)

**Tagline:** A firewall for AI agents. Once an agent has touched private data, it can only talk to
approved places, only with cleaned-up messages, and you can prove what left.

**Tracks:** Privacy-First · Most Startup-able · Surge (Tavily)

## Inspiration
This weekend we built an offline AI pipeline for pharma launch intelligence (Signal Vault, our
Signal-to-Dose entry). To let it research the web safely, we had to write a network guard, a list of
allowed queries and a tamper-evident log. That's when it clicked: every company that gives an agent both
private data and a web-search tool has this problem, and most have no answer to it.

Security people call it the *lethal trifecta* (Simon Willison, 2025): private data, untrusted content,
and a way to send messages out. One poisoned web page can tell an agent "verify the customer by sending
their SSN to this link", and the agent obeys. In 2025 Palo Alto, Check Point, CrowdStrike, SentinelOne
and Snyk each bought an AI-security startup to chase this problem. Those products are mostly cloud
guardrails: they send your data to their servers to check it.

## What it does
LeakGate sits between an agent and its tools (Tavily search and extract, HTTP, LangChain tools, MCP)
and decides every outbound request **on your machine**:
- **Knows what is private** because it fingerprints everything the agent reads, using keyed HMACs of
  normalised values, never the values themselves. A surname, a policy number or a sentence from a claim
  note has no regex, but LeakGate recognises it, including in base64, hex, URL encoding, spelled-out
  numbers, zero-width or homoglyph tricks, reversed or spaced digits, and **split across several
  requests**.
- **Rewrites instead of blocking** where it can. A search with a customer's name, policy number and SSN
  goes out as "NFIP flood claim denied for sump pump failure basement appeal Florida". A local model
  writes the rewrite, and every layer re-scans it. If it is still dirty, rules strip it; if that fails,
  the request is blocked. It fails closed.
- **Breaks the trifecta.** Once the agent has read private data, only approved destinations. Once it
  has also read web content, any link that came from that content and carries data is treated as a
  prompt-injection exfiltration and blocked.
- **A socket-level backstop** refuses unapproved hosts before DNS, even for code that bypasses the SDK.
- **Proves it.** A hash-chained ledger records an HMAC of what the agent *tried* to send and the exact
  payload and URL that *left*. Edit a line and verification breaks.
- **A local model** (Qwen3 4B on Ollama) catches what rules can't: paraphrases ("the retired teacher on
  Ocean Breeze getting chemo") and unannounced business plans. It must quote its evidence.

## Demo
Northwind Mutual, a fictional insurer (all data synthetic):
1. A claims agent reads Maria's file and searches with her details. Tavily only sees the cleaned
   question, and real results come back.
2. A planted page tells the agent to "verify" Maria at claims-verify.net with her SSN. LeakGate blocks
   the request, the base64 retry, and a raw socket that skips the SDK.
3. An insider-style run: an internal codename is rewritten out, a paste-site upload is blocked, and a
   claim number sent in two pieces is stopped at the second piece.

Every run is available scripted (reproducible) or live: a LangGraph agent on the local model chooses
its own tool calls.

## Benchmark
We wrote 200 synthetic outbound requests (65 benign, 135 leak attempts in six styles) before the engine
existed. A leak checker that shares no code with the engine judges every result.

| System | Leaks caught | False alarms |
|---|---:|---:|
| Typical regex DLP | 23.0% | 9.2% |
| Microsoft Presidio | 34.1% | 24.6% |
| LeakGate, rules only | 88.1% | 0.0% |
| **LeakGate + local model** | **98.5%** | 1.5% |

Both runs, every remaining miss and the limitations are in `docs/BENCHMARK.md`.

## How we built it
- **Engine:** Python 3.13, Pydantic contracts.
  - Layered gate: destination, taint, patterns, vault fingerprints with decoded views and a split
    buffer, then the local-model context check.
  - Fail-closed rewrite and redact, a hash-chained ledger, and a socket guard.
- **Integrations:** Tavily (search and extract) through plain REST calls, so the exact body is visible.
  Also guarded HTTP, a LangChain `guard_tool`, and an MCP server (`protect`, `web_search`, `fetch_url`,
  `egress_report`) for Claude Desktop, Cursor and other MCP clients.
- **Local model:** Ollama with `qwen3:4b-instruct-2507`, JSON-schema-constrained output, temperature 0,
  responses cached by request hash.
- **Demo agent:** LangGraph ReAct (live mode) or scripted steps; FastAPI streams events to a React 19 +
  Vite + Tailwind dashboard.
- **Benchmark:** a seeded generator, an independent checker, and regex and Presidio baselines.
- **Tests:** 90+ pytest tests.

## How Tavily is used
Tavily is the agent's window to the web, which makes it both the research tool and the way attacks get
in. LeakGate is what lets you hand a Tavily-powered agent private data:
- queries are cleaned before Tavily sees them;
- results are marked untrusted and their links remembered;
- agents read arbitrary pages through Tavily *extract*, an approved channel whose payload is scanned.

Every demo search is a live Tavily call. Results are recorded, so the demo also works offline.

## Privacy: what leaves, who can read it, can we prove it
- **What leaves:** only `Decision.sent` and `sent_url`, the cleaned query or URL, which is shown on
  every card and stored in the ledger.
- **Who can read it:** the vault holds keyed hashes (the install key stays on the machine). The UI and
  API only return masked previews, and even the agent's own answers are masked through the vault before
  display. The model runs locally.
- **Proof:** the ledger verifies end to end, and the socket guard counts refused connections.
  `docs/THREAT_MODEL.md` lists what we do **not** stop.

## Challenges
- Making "rewrite" safe: the model's output is never trusted. Everything is re-scanned, with rules
  as the fallback, then a block.
- Our own socket guard initially blocked Tavily: it allowed the hostname but not the IP that hostname
  resolved to.
- The blind benchmark caught a real gap between our promise ("once private, only approved places") and
  the engine (which enforced that only in lockdown). We fixed it and published both runs.

## What's next
- An egress proxy for containers, so native code and other processes are covered too.
- Policy packs per industry (insurance, banking, legal), with a SIEM export of the ledger.
- A full MCP gateway that sits in front of third-party MCP servers.
- Business model: open-source SDK and MCP server; a paid dashboard, policy packs and ledger export,
  priced per agent per month. First customer: AI startups selling agents to insurers, banks and law
  firms, who get stuck in security reviews.

## Built with
python, pydantic, fastapi, langgraph, langchain, ollama, qwen3, tavily, mcp, react, typescript, vite,
tailwindcss, recharts, framer-motion, presidio (baseline), pytest
