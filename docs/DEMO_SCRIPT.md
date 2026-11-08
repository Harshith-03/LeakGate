# Demo script (about 2:30)

Setup: API on :8100, dashboard on :4180 (preview build), Ollama running, model warm (run one scenario
first). Light theme. Close other tabs. Tavily key set (otherwise recorded results replay, and the UI
says "replay").

| # | Time | Screen | Say |
|---|---|---|---|
| 1 | 0:00 | Live page, idle | "This is a claims agent at a fictional insurer. It can read customer files and search the web with Tavily. That's the combination attackers love." |
| 2 | 0:15 | Run **Research a customer's claim** (Scripted) | "It loads Maria's claim file: both lights on the right show what it has touched." |
| 3 | 0:30 | First egress card (Rewritten) | "The agent searched with her name, policy number and SSN. Left: what it tried, masked. Right: what Tavily actually received. The research question went out, she didn't." |
| 4 | 0:50 | Answer card with citations | "The local model drafts the reply from real Tavily results." |
| 5 | 1:00 | Run **Poisoned search result** | "Now one search result is a planted page with hidden instructions." |
| 6 | 1:15 | Blocked card (exfiltration) | "It tells the agent to verify Maria at claims-verify.net with her SSN. LeakGate blocks it, and highlights the link and the data." |
| 7 | 1:30 | Next two blocked items | "The page says retry in base64: blocked. The agent tries a raw connection that skips our SDK: the socket guard stops it before DNS." |
| 8 | 1:45 | Ledger page → Verify chain | "Every decision is in a hash-chained ledger. What it tried is stored as a keyed hash; what left is stored as-is. Edit a line and verification breaks." |
| 9 | 2:00 | Benchmark page | "On 200 synthetic requests, regex DLP catches 23% of leaks and Presidio 34%. LeakGate catches 98.5%, with 1.5% false alarms." |
| 10 | 2:15 | Policy page | "All of this runs on this laptop. Approved places are here; the vault stores fingerprints, never the data. That's LeakGate." |

Backup if the network is down: everything still works; Tavily replays recorded results and the UI
shows "replay". If Ollama is down: rewrites fall back to rules ("rewritten by rules") and the context
layer is skipped; say so.

Optional (Q&A): Playground → paste a query with "Project Bluefin" or a base64 SSN; Live mode toggle to
let the local model drive the agent itself.
