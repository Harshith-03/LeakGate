/**
 * The main control: a terminal-style prompt box (with a blinking block cursor), suggested prompts as
 * keys, a "Plant a poisoned web page" switch, and a big Run key. The guided demos (the three scripted
 * scenarios) fold out underneath as a secondary control.
 *
 * Run sends `POST /api/sessions {scenario: "custom", mode: "live", prompt, plant_poison}`; a guided demo
 * sends `{scenario, mode}`. Both stream into the Agent and Gate monitors through state/live.ts.
 */
import { AnimatePresence, motion } from "framer-motion";
import { Biohazard, ChevronDown, CornerDownLeft, Loader2, Play, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError } from "../api/client";
import { PROMPT_MAX, type Preset, type RunMode, type ScenarioInfo, type Workspace } from "../api/types";
import { useApi } from "../api/useApi";
import { presetsFor, WORKSPACE_INFO } from "../lib/presets";
import { clearRun, startPrompt, startRun, useLive } from "../state/live";
import { useStatus } from "../state/status";
import { Led, Monitor, SelectorKnob, ToggleSwitch } from "./crt";
import { Segmented, cx } from "./ui";

function readPref(key: string, fallback: string) {
  try { return sessionStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key: string, v: string) {
  try { sessionStorage.setItem(key, v); } catch { /* fine */ }
}

/** Presets from the API; the bundled copy if this API predates /api/presets. */
async function loadPresets(ws: Workspace): Promise<Preset[]> {
  try {
    const list = await api.presets(ws);
    return Array.isArray(list) && list.length ? list : presetsFor(ws);
  } catch (e) {
    if (e instanceof ApiError && e.kind !== "offline") return presetsFor(ws);
    throw e;
  }
}

export function PromptConsole({ className }: { className?: string }) {
  const live = useLive();
  const { status } = useStatus();
  const [ws, setWsState] = useState<Workspace>(() => (readPref("lg.ws", "insurance") === "pharma" ? "pharma" : "insurance"));
  const presets = useApi(() => loadPresets(ws), [ws]);
  const info = WORKSPACE_INFO[ws];
  const scenarios = useApi(() => api.scenarios());
  const [prompt, setPromptState] = useState(() => readPref("lg.prompt", ""));
  const [poison, setPoisonState] = useState(() => readPref("lg.poison", "0") === "1");
  const [focused, setFocused] = useState(false);
  const [demosOpen, setDemosOpen] = useState(false);
  const [mode, setModeState] = useState<RunMode>(() => (readPref("lg.mode", "scripted") === "live" ? "live" : "scripted"));
  const area = useRef<HTMLTextAreaElement>(null);
  const demosId = useId();
  const hintId = useId();

  const setPrompt = (v: string) => { setPromptState(v); writePref("lg.prompt", v); };
  const setPoison = (v: boolean) => { setPoisonState(v); writePref("lg.poison", v ? "1" : "0"); };
  const setMode = (m: RunMode) => { setModeState(m); writePref("lg.mode", m); };
  const setWs = (w: Workspace) => {
    if (w === ws) return;
    setWsState(w);
    writePref("lg.ws", w);
    // a suggested prompt from the other company makes no sense here; a hand-typed one is kept
    if (presetsFor(ws).some((p) => p.prompt === prompt)) setPrompt("");
    setPoison(false);
  };

  const busy = live.starting || live.running;
  const len = prompt.length;
  const tooLong = len > PROMPT_MAX;
  const canRun = !busy && prompt.trim().length > 0 && !tooLong;
  const modelOff = status ? !status.model_available : false;

  const run = () => { if (canRun) void startPrompt(prompt.trim(), poison, ws); };
  const runDemo = (s: ScenarioInfo) => {
    if (busy) return;
    const m: RunMode = s.modes.includes(mode) ? mode : s.modes[0] ?? "scripted";
    void startRun(s.name, m);
  };
  const pick = (p: Preset) => {
    setPrompt(p.prompt);
    setPoison(!!p.plant_poison);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      run();
    }
  };

  // keep the end of a long prompt in view as it grows
  useEffect(() => {
    const el = area.current?.parentElement?.parentElement;
    if (el && focused) el.scrollTop = el.scrollHeight;
  }, [len, focused]);

  const led = live.error ? "alarm" : busy ? "ok" : "brand";

  return (
    <Monitor
      className={className}
      title="Prompt console"
      plate="LG-01 · Terminal"
      led={led}
      ledPulse={busy}
      ledLabel={busy ? "Running" : live.error ? "Error" : "Ready"}
      tone="brand"
      glow={focused}
      right={ws === "insurance" &&
        <button
          type="button"
          onClick={() => setDemosOpen((o) => !o)}
          aria-expanded={demosOpen}
          aria-controls={demosId}
          className="key key-flat h-7 gap-1 rounded-md px-2.5 text-[12px] font-medium text-chrome"
        >
          Guided demos
          <ChevronDown size={14} className={cx("transition-transform motion-reduce:transition-none", demosOpen && "rotate-180")} />
        </button>
      }
      footer={
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <ToggleSwitch
              checked={poison}
              onChange={setPoison}
              disabled={busy}
              label="Plant a poisoned web page"
              sub="A red-team page with hidden instructions joins the search results"
            />
            <div className="ml-auto flex items-center gap-3">
              <span id={hintId} className={cx("tnum hidden font-mono text-[11.5px] sm:inline", tooLong ? "text-crit" : len > PROMPT_MAX * 0.9 ? "text-warn" : "text-chrome-3")}>
                {len.toLocaleString()} / {PROMPT_MAX.toLocaleString()}
              </span>
              {live.session && !busy && (
                <button type="button" onClick={clearRun} className="key key-flat h-9 gap-1.5 rounded-md px-3 text-[12.5px] text-chrome-2">
                  <RotateCcw size={13} aria-hidden /> Clear
                </button>
              )}
              <button
                type="button"
                onClick={run}
                disabled={!canRun}
                className="key key-ivory h-12 gap-2.5 rounded-[11px] px-6 text-[14px] font-bold uppercase tracking-[0.16em]"
                title="Run the prompt (Enter)"
              >
                <Led state={busy ? "ok" : "off"} pulse={busy} size="sm" />
                {busy ? <Loader2 size={16} className="spin" aria-hidden /> : <Play size={16} fill="currentColor" aria-hidden />}
                {live.starting ? "Starting" : live.running ? "Running" : "Run"}
              </button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {demosOpen && (
              <motion.div
                id={demosId}
                key="demos"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-1 flex flex-wrap items-center gap-2.5 border-t border-black/40 pt-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
                  <span className="eyebrow mr-1 text-chrome-3">Guided demos</span>
                  {(scenarios.data ?? []).map((s) => {
                    const scriptedOnly = !s.modes.includes(mode);
                    return (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => runDemo(s)}
                        disabled={busy}
                        title={`${s.description}${scriptedOnly ? " (scripted only)" : ""}`}
                        className="key h-8 rounded-md px-3 text-[12.5px]"
                      >
                        <Play size={12} aria-hidden className="text-chrome-3" />
                        {s.title}
                        {scriptedOnly && <span className="text-[11px] font-normal text-chrome-3">· scripted</span>}
                      </button>
                    );
                  })}
                  {scenarios.error && !scenarios.data && <span className="text-caption text-chrome-3">Scenarios unavailable.</span>}
                  <Segmented<RunMode>
                    size="sm"
                    label="Guided demo mode"
                    value={mode}
                    onChange={setMode}
                    className="sm:ml-auto"
                    options={[
                      { value: "scripted", label: "Scripted", title: "Deterministic replay of the agent's steps; every decision is made live by the real gate" },
                      { value: "live", label: "Live", title: "A real agent run against Tavily and the local model" },
                    ]}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <SelectorKnob<Workspace>
          label="Workspace"
          value={ws}
          onChange={setWs}
          disabled={busy}
          options={[{ value: "insurance", label: "Insurance" }, { value: "pharma", label: "Pharma" }]}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={ws}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="min-w-[16rem] flex-1 text-support text-ink-3"
          >
            {info.blurb} LeakGate sits between it and the internet: it rewrites private details out of searches, blocks leaks,
            and records every decision.
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="well px-3.5 py-3 sm:px-4">
        <label className="flex flex-wrap items-baseline gap-x-2 font-mono text-[12px]">
          <span className="text-good glow-soft">{info.user}</span>
          <span className="text-ink-3">:~$</span>
          <span className="sr-only">Prompt for the agent</span>
          <span className="ml-auto hidden items-center gap-1 text-[11px] text-ink-3 sm:inline-flex">
            <CornerDownLeft size={11} aria-hidden /> run · shift+<CornerDownLeft size={11} aria-hidden /> new line
          </span>
        </label>
        <div className="scroll-thin mt-1.5 max-h-[38vh] overflow-y-auto">
          <div className="grid font-mono text-[15px] leading-[1.6]">
            <div aria-hidden className="pointer-events-none col-start-1 row-start-1 whitespace-pre-wrap break-words text-ink [overflow-wrap:anywhere]"
              style={{ textShadow: "0 0 10px rgb(var(--brand-rgb) / 0.3)" }}>
              {!focused && !prompt && <span className="cursor-block mr-1.5" />}
              {prompt || <span className="text-ink-3" style={{ textShadow: "none" }}>{info.placeholder}</span>}
              {!focused && prompt && <span className="cursor-block" />}
              {"​"}
            </div>
            <textarea
              ref={area}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onKey}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              rows={3}
              spellCheck={false}
              aria-label="Prompt for the agent"
              aria-describedby={hintId}
              aria-invalid={tooLong || undefined}
              className="col-start-1 row-start-1 min-h-[4.8em] w-full resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent p-0 text-transparent caret-brand outline-none [overflow-wrap:anywhere] selection:bg-brand/30"
            />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Suggested prompts">
        <span className="eyebrow mr-0.5 text-ink-3">Try</span>
        {(presets.data ?? presetsFor(ws)).map((p) => {
          const active = prompt === p.prompt;
          return (
            <button
              key={p.title}
              type="button"
              onClick={() => pick(p)}
              disabled={busy}
              aria-pressed={active}
              title={p.prompt}
              className={cx(
                "press inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium ring-1 ring-inset transition-colors disabled:opacity-50",
                active ? "bg-brand-tint text-brand ring-brand/50" : "bg-surface-3/70 text-ink-2 ring-line-strong hover:bg-surface-3 hover:text-ink",
              )}
            >
              {p.plant_poison && <Biohazard size={13} className="text-crit" aria-label="plants a poisoned page" />}
              {p.title}
            </button>
          );
        })}
      </div>

      {(live.error || tooLong || (modelOff && !busy)) && (
        <div className="mt-3 space-y-1 font-mono text-[12px]" role="alert">
          {live.error && <p className="text-crit"><span aria-hidden>✕ </span>{live.error}</p>}
          {tooLong && <p className="text-crit"><span aria-hidden>✕ </span>Keep the prompt under {PROMPT_MAX.toLocaleString()} characters.</p>}
          {modelOff && !busy && (
            <p className="text-warn"><span aria-hidden>! </span>The local model is off: free-form prompts need Ollama. Guided demos in Scripted mode still work.</p>
          )}
        </div>
      )}
    </Monitor>
  );
}
