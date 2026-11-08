# LeakGate: web dashboard (`app/web`)

React 19 + TypeScript + Vite + Tailwind v4, with Recharts, framer-motion and lucide-react. Inter, DM Sans,
JetBrains Mono and VT323 are bundled through `@fontsource`: nothing is loaded from a CDN, and there is no
analytics. The look is a dark, retro-futurist **control room**: every section is a CRT monitor floating above a
WebGL starfield (see [Design system](#design-system)).

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
| `npm run preview` | Serves `dist/` on 127.0.0.1:4180 with the same `/api` proxy (`--port 4190` for a second copy). |
| `npm run typecheck` | `tsc -b` only. |

To use another API port: `$env:VITE_API_TARGET = "http://127.0.0.1:8110"; npm run dev`.

## Demo data (works with no API)

If the API is unreachable (connection refused, the proxy's 5xx, or HTML where JSON was expected), every call is
answered by in-browser fixtures in `src/mocks/`, and the top bar shows a **Demo data** badge. The fixtures follow
the real scripted scenarios (`research`, `injection`, `insider`) and the four prompt presets. A free-form prompt
gets a short scripted stand-in that follows what the prompt asks for (look up a customer, search, send data to a
URL, post to a paste site, walk into the planted page), with the same event shapes and masking as the live agent.
Runs release their events over time so the Console polls them exactly as it polls the API; every decision is
appended to a hash-linked demo ledger; the Inspector uses a small rule-based stand-in. Everything is synthetic
and arrives pre-masked like the API's.

After a failed call, the client skips the network for 5 s. The next call after that tries the API again, so
starting the API mid-demo switches the UI over to live data by itself. Runs started on demo data stay on demo
data, because their ids start with `demo-`. If an older API has no `/api/presets`, the bundled copy of the
presets (`src/lib/presets.ts`) is used.

| Switch | Effect |
|---|---|
| `?demo=1` in the URL, or `VITE_DEMO=1` | Always use the fixtures. |
| `VITE_NO_MOCKS=1` | Never fall back: pages show "API offline" with the start command. |

## Pages

Navigation is five hardware keys in the top bar (a key row at the bottom on phones). Status LEDs on the right:
policy mode, Tavily live/replay, local model, socket guard (with its block count).

| Route | Page |
|---|---|
| `/` | **Console.** The prompt console (below), the session status rack, and two monitors: **Agent** (what the agent is doing, as a compact terminal log; sticky on wide screens and sized to end inside the viewport so the newest line is always visible) and **Gate** (every decision, newest first, each one a CRT monitor). A blocked request also raises a toast. `/live` redirects here. |
| `/inspector` | **Inspector** (formerly Playground). Build one outbound request and send it to `POST /api/inspect`, then see the decision monitor. Six one-press examples use the synthetic customer C-1042. `/playground` redirects here. |
| `/ledger` | **Ledger.** Hash-chained records as terminal lines, newest first, with copyable HMAC and previous-hash values. Expand a line to see what left (`sent` / `sent_url`). **Verify chain** reports the chain as intact (with the head hash) or broken at record N. `/ledger?seq=N` highlights one record; the decision monitors link here. |
| `/benchmark` | **Benchmark.** From `/api/bench`. Headline monitors (catch rate, false alarms, utility, p50 latency against Regex DLP); two phosphor bar charts (leak cases caught, benign cases left alone) with n on each category, a fixed 0–100 % axis, value labels and a table view; an examples table. If `{available: false}`, the page shows the `python -m bench.run` command instead. |
| `/policy` | **Policy & vault.** Allowlisted destinations, always-blocked kinds, masked confidential terms, and the vault summary (sources, field names, fingerprint counts, key id). |

### The prompt console (`src/components/PromptConsole.tsx`)

- A terminal-style prompt box (`adjuster@northwind:~$`) with a blinking block cursor when idle. **Enter** runs,
  **Shift+Enter** adds a line; a counter enforces the API's 2,000-character limit.
- The four presets from `GET /api/presets` are keys under the box; one press fills the prompt and sets the switch.
- **Plant a poisoned web page** is a slide switch with an LED (red when armed).
- **Run** (the ivory key) sends `POST /api/sessions {scenario: "custom", mode: "live", prompt, plant_poison}` and then
  polls `/api/sessions/{id}/events?after=N` like any run (`src/state/live.ts`). A custom run takes 20–90 s. A `400 {detail}`
  is shown in the console, and the previous run stays on screen.
- **Guided demos** fold out from the bezel: the three scripted scenarios run in one press, with a Scripted / Live rocker.
- The polling loop reads the session status before the events, so a run that finishes between two polls never loses its
  final answer.

### The status rack (`src/components/StatusRack.tsx`)

Two lamps (private data read, web content read) light amber; the **LOCKDOWN** lamp lights red when both are on, with
a one-line explanation and an (i) for the "lethal trifecta". Allowed / rewritten / blocked are 7-segment readouts that
count up.

### The decision monitor (`src/components/DecisionCard.tsx`)

- **Bezel.** LED and phosphor colour by action (green allowed, amber rewritten or redacted, red blocked), the action word,
  `tool → destination`, the channel plate and the time. A blocked decision glows red; on arrival it blinks its LED three
  times, glitches the screen once (under 400 ms) and pulses a red alarm ring.
- **Tried to send.** Renders `attempted[field]` segments, with every hit highlighted. Hover, focus or tap a hit to see its
  Finding: layer, kind, encoding, explanation, source and severity. Screen readers get the same text inline. Short
  parameters with no hits (`topic=general`) collapse into one quiet line.
- **Actually sent.** Shows `sent_url` and `sent` exactly as returned. When the request was blocked, it shows "Nothing left
  the machine" instead.
- **Footer.** `rewritten_by`, total latency, the finding count and the ledger link. **Details** opens the time per layer
  (`destination`, `taint`, `scan`, `split`, `context`, `rewrite`), all findings, and the session's taint state at that call.
- **Monitor mode.** When `mode === "monitor"`, a banner says the decision was logged, not enforced.
- **Masking backstop.** If a finding is anchored in a field but no segment points at it, the card rebuilds the original
  offsets from the surrounding hits and shows the finding's masked `preview` in that place, never the plain text.

## Design system

Dark only. Tokens live in `src/index.css`; the hardware lives in `src/components/crt.tsx`; shared primitives (keys,
rockers, fields, notes, states) in `src/components/ui.tsx`.

| Piece | Where | Notes |
|---|---|---|
| Starfield | `components/Starfield.tsx`, `.space` | Raw WebGL, one `GL_POINTS` draw call: ~160–1,100 stars in three parallax depths with slow drift, twinkle, a little colour variation and a touch of scroll parallax. DPR capped at 1.5, ~30 fps, paused while the tab is hidden, one static frame under `prefers-reduced-motion`. The nebula is a CSS gradient underneath, which is also the fallback without WebGL. |
| Monitor | `<Monitor>`, `.crt` | Moulded graphite bezel (layered gradients, top bevel highlight, fine SVG grain, screws, an embossed model plate), a status LED and the title on the bezel, and a recessed screen. |
| Screen | `<Screen>`, `.crt-screen`, `.crt-fx` | Curved-glass feel: radial falloff, inner vignette, top-left glare. Scanlines are a 3 px repeating gradient; a soft luminous band rolls down over 9 s; a white veil flickers at under 2 % luminance. All of it sits above the content and never takes pointer events. |
| Power-on | `.crt-on` | A bright horizontal line opens into the picture in ~430 ms when a monitor mounts; `delay` staggers groups. |
| Phosphor | `data-tone` | One family per state: idle pale green, brand cyan, good green, warn amber, crit red. Body text is soft off-white phosphor (`--ink`, `--ink-2`, `--ink-3`, all ≥ 4.5:1 on the screen). `.glow` / `.glow-soft` for headings and readouts. |
| LEDs | `<Led>`, `.led` | `ok` green, `warn` amber, `alarm` red, `info`, `brand`, `off`. `pulse` for activity, `blink` (×3) for a fresh block. |
| Keys | `Button`, `.key` | Physical keycaps that travel down when pressed; `run` is the ivory key (the one primary action per screen), `primary` cyan, `secondary` graphite. |
| Rockers | `Segmented`, `Tabs`, nav, `.rocker` | A recessed track with one latched key. |
| Switch | `<ToggleSwitch>`, `.switch` | A metal knob in a recessed slot, with an LED and the state in words. |
| Readouts | `<SevenSeg>`, `useTicker`, `.readout` | Real 7-segment digits (unlit segments faintly visible); numbers tick to their new value. |
| Rack | `.rack`, `<StatusRack>` | Anodised faceplate for the status rack, section header plates and the top bar. |
| Shadows | `--shadow-monitor`, `--shadow-monitor-lift` | Stacked: contact, mid, a long 84 px drop with a strong offset, and a far 120 px ambient. Hover lifts a monitor and fades in a longer pre-rendered shadow (opacity only). Active or alarmed screens add a coloured glow. |
| Type | `font-sans` Inter (chrome), `font-mono` JetBrains Mono (screen content), `font-display` DM Sans (titles), `font-crt` VT323 (big readouts and a few labels, sparingly). |

Component classes live in `@layer components`, so Tailwind utilities on the same element still win (for example
`lg:sticky` on a monitor).

## Conventions

- Action colours are fixed: allowed is green, rewritten or redacted is amber, blocked is red. Each always comes with an
  icon and a word.
- The benchmark series colours (`--series-*`) keep the validated hue order Regex → Presidio → rules → full, lifted to
  phosphor brightness; every chart also has value labels and a table view.
- Motion: framer-motion page transitions (fade, slight lift and scale), staggered power-on, ticking counters, LED pulses,
  hover lift. Everything holds still under `prefers-reduced-motion` (CSS animations off, framer `reducedMotion="user"`,
  a static starfield frame).
- Responsive from 360 px: monitors stack, the nav becomes a bottom key row, and the page never scrolls sideways (wide
  tables scroll inside their monitor). Checked at 1920×1080, 1440×900 and 390 px.
