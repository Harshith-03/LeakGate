# LeakGate: web dashboard (`app/web`)

React 19 + TypeScript + Vite + Tailwind v4, with Recharts, framer-motion and lucide-react. Inter, DM Sans and
JetBrains Mono are bundled through `@fontsource`: nothing is loaded from a CDN, and there is no analytics. The
design tokens (light and dark) live in `src/index.css`, and the primitives in `src/components/ui.tsx`. Both are
carried over from the Signal Vault design system.

**The UI only ever calls `/api/*` on its own origin.** The dev and preview servers proxy those calls to the
LeakGate API on `127.0.0.1:8100`.

## Run

```powershell
# 1) API (from the repo root)
python -m uvicorn app.api.main:app --host 127.0.0.1 --port 8100

# 2) UI
cd app\web
npm install          # once; needs Node 20+
npm run dev          # http://127.0.0.1:5180
```

For the demo, use the production build: `npm run build`, then `npm run preview` (http://127.0.0.1:4180, with the same proxy).

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on 127.0.0.1:5180. `/api` is proxied to `VITE_API_TARGET` (default `http://127.0.0.1:8100`). |
| `npm run build` | Type-checks (`tsc -b`), then builds into `dist/` (gitignored). |
| `npm run preview` | Serves `dist/` on 127.0.0.1:4180 with the same `/api` proxy. |
| `npm run typecheck` | `tsc -b` only. |

To use another API port: `$env:VITE_API_TARGET = "http://127.0.0.1:8110"; npm run dev`.

## Demo data (works with no API)

If the API is unreachable (connection refused, the proxy's 5xx, or HTML where JSON was expected), every call is
answered by in-browser fixtures in `src/mocks/`, and the top bar shows a **Demo data** badge. The fixtures follow
the real scripted scenarios (`research`, `injection`, `insider`). They release events over time so the Live page
polls them exactly as it polls the API, they append each decision to a hash-linked demo ledger, and the Playground
uses a small rule-based stand-in inspector. All of this is synthetic, and the values arrive pre-masked like the API's.

After a failed call, the client skips the network for 5 s. The next call after that tries the API again, so
starting the API mid-demo switches the UI over to live data by itself. Runs started on demo data stay on demo
data, because their ids start with `demo-`.

| Switch | Effect |
|---|---|
| `?demo=1` in the URL, or `VITE_DEMO=1` | Always use the fixtures. |
| `VITE_NO_MOCKS=1` | Never fall back: pages show "API offline" with the start command. |

## Pages

| Route | Page |
|---|---|
| `/` | **Live.** Pick a scenario, choose Scripted or Live, and press Run (`POST /api/sessions`). The page then polls `/api/sessions/{id}/events?after=N` every 400 ms until the run is done. On the left is the agent's timeline. On the right is the egress feed of decision cards, newest first. A pinned strip shows the two taint lights, the lockdown state (with a "lethal trifecta" explainer) and the allowed / rewritten / blocked counters. A blocked request also raises a toast. |
| `/playground` | **Playground.** Build one outbound request and send it to `POST /api/inspect`, then see the decision card. Six one-click examples use the synthetic customer C-1042. |
| `/ledger` | **Ledger.** Hash-chained records, newest first, with copyable HMAC and previous-hash values. Expand a record to see what left (`sent` / `sent_url`). **Verify chain** reports the chain as intact (with the head hash) or broken at record N. `/ledger?seq=N` highlights one record; the decision cards link here. |
| `/benchmark` | **Benchmark.** From `/api/bench`. Headline tiles show catch rate, false alarms, utility and p50 latency against Regex DLP. Two grouped bar charts (leak cases caught, benign cases left alone) have n on each category, a fixed 0–100 % axis and a table view. An examples table follows. If `{available: false}`, the page shows the `python -m bench.run` command instead. |
| `/policy` | **Policy & vault.** Lists the allowlisted destinations, the always-blocked kinds, the masked confidential terms, and the vault summary (sources, field names, fingerprint counts, key id). |

## The decision card (`src/components/DecisionCard.tsx`)

- **Tried to send.** Renders `attempted[field]` segments, with every hit highlighted. Hover, focus or tap a hit to see its Finding: layer, kind, encoding, explanation, source and severity. Screen readers get the same text inline. Short parameters with no hits (`topic=general`) collapse into one quiet line.
- **Actually sent.** Shows `sent_url` and `sent` exactly as returned. When the request was blocked, it shows "Nothing left the machine" instead.
- **Footer.** Shows `rewritten_by`, total latency, the finding count and the ledger link. **Details** opens the time per layer (`destination`, `taint`, `scan`, `split`, `context`, `rewrite`), all findings, and the session's taint state at that call.
- **Monitor mode.** When `mode === "monitor"`, a banner says the decision was logged, not enforced.
- **Masking backstop.** If a finding is anchored in a field but no segment points at it, the card rebuilds the original offsets from the surrounding hits and shows the finding's masked `preview` in that place, never the plain text.

## Conventions

- Action colours are fixed: allowed is green, rewritten or redacted is amber, blocked is brick. Each always comes with an icon and a word.
- The benchmark series colours (`--series-*`) were validated for colour-vision deficiency in both themes, in the order Regex → Presidio → rules → full.
- Motion is limited to 120–220 ms and is off under `prefers-reduced-motion`. The blocked card announces itself once with a soft ring.
- The page is responsive down to 360 px. Wide tables scroll inside their card, and the page itself never scrolls sideways.
