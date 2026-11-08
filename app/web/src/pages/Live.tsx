import { AnimatePresence } from "framer-motion";
import { Loader2, Play, Radio, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type { RunMode, ScenarioInfo } from "../api/types";
import { useApi } from "../api/useApi";
import { DecisionCard } from "../components/DecisionCard";
import { RunStatus } from "../components/TaintPanel";
import { Timeline } from "../components/Timeline";
import { useToast } from "../components/Toast";
import {
  Button, EmptyState, ErrorState, Note, PageHeader, Panel, PanelTitle, Segmented, Skeleton, cx,
} from "../components/ui";
import { SCENARIO_FALLBACK_TITLE, fmtTime, plural } from "../lib/format";
import { clearRun, countsOf, decisionsOf, restoreLatest, startRun, taintOf, useLive } from "../state/live";

function readPref(key: string, fallback: string) {
  try { return sessionStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key: string, v: string) {
  try { sessionStorage.setItem(key, v); } catch { /* fine */ }
}

export default function Live() {
  const scenarios = useApi(() => api.scenarios());
  const live = useLive();
  const toast = useToast();
  const [scenario, setScenarioState] = useState(() => readPref("lg.scenario", "research"));
  const [mode, setModeState] = useState<RunMode>(() => (readPref("lg.mode", "scripted") === "live" ? "live" : "scripted"));
  const setScenario = (s: string) => { setScenarioState(s); writePref("lg.scenario", s); };
  const setMode = (m: RunMode) => { setModeState(m); writePref("lg.mode", m); };

  useEffect(() => { void restoreLatest(); }, []);

  const list = scenarios.data ?? [];
  const current: ScenarioInfo | undefined = list.find((s) => s.name === scenario) ?? list[0];
  const modes = current?.modes?.length ? current.modes : (["scripted"] as RunMode[]);
  const effectiveMode: RunMode = modes.includes(mode) ? mode : modes[0];

  const decisions = useMemo(() => decisionsOf(live.events), [live.events]);
  const newestFirst = useMemo(() => [...decisions].reverse(), [decisions]);
  const counts = useMemo(() => countsOf(decisions), [decisions]);
  const taint = taintOf(live.events, live.session);
  const busy = live.starting || live.running;

  // A blocked attack is the moment to notice, even when the feed is scrolled out of view (phones).
  const toasted = useRef(new Set<string>());
  useEffect(() => {
    for (const d of decisions) {
      if (d.action === "block" && live.fresh.has(d.request_id) && !toasted.current.has(d.request_id)) {
        toasted.current.add(d.request_id);
        toast({ tone: "crit", title: `Blocked: ${d.tool} → ${d.destination}`, body: d.reason });
      }
    }
  }, [decisions, live.fresh, toast]);

  const run = () => { if (current) void startRun(current.name, effectiveMode); };
  const scenarioTitle = (name: string) => list.find((s) => s.name === name)?.title ?? SCENARIO_FALLBACK_TITLE[name] ?? name;

  return (
    <>
      <PageHeader
        eyebrow="Northwind Mutual · claims-research agent"
        title="Live"
        subtitle="Run the agent and watch every request it tries to send. LeakGate allows it, rewrites it, or blocks it, and shows you exactly what left."
      />

      {/* ---- scenario + run */}
      <Panel className="mb-4">
        {scenarios.error && !scenarios.data ? (
          <ErrorState error={scenarios.error} onRetry={scenarios.reload} />
        ) : (
          <div className="flex flex-col gap-4">
            <fieldset>
              <legend className="mb-2.5 text-caption font-medium text-ink-3">Scenario</legend>
              {scenarios.loading && !scenarios.data ? (
                <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[104px] rounded-panel" />)}</div>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  {list.map((s) => {
                    const active = current?.name === s.name;
                    return (
                      <label
                        key={s.name}
                        className={cx(
                          "press relative flex cursor-pointer flex-col rounded-panel border px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
                          active ? "border-brand/50 bg-brand-tint" : "border-line bg-surface hover:border-line-strong hover:bg-surface-2",
                          busy && "cursor-not-allowed opacity-70",
                        )}
                      >
                        <input
                          type="radio"
                          name="scenario"
                          value={s.name}
                          checked={active}
                          disabled={busy}
                          onChange={() => setScenario(s.name)}
                          className="sr-only"
                        />
                        <span className="flex items-center gap-2">
                          <span aria-hidden className={cx("inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2", active ? "border-brand" : "border-line-strong")}>
                            {active && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
                          </span>
                          <span className="font-display text-[15px] font-semibold text-ink">{s.title}</span>
                        </span>
                        <span className="mt-1.5 text-caption leading-snug text-ink-3">{s.description}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
              <Segmented<RunMode>
                label="Run mode"
                value={effectiveMode}
                onChange={setMode}
                options={modes.map((m) => ({
                  value: m,
                  label: m === "scripted" ? "Scripted" : "Live",
                  title: m === "scripted" ? "Deterministic replay of the agent's steps (safe for a demo)" : "A real agent run against Tavily and the local model",
                }))}
              />
              <Button variant="primary" onClick={run} disabled={busy || !current}
                icon={busy ? <Loader2 size={15} className="spin" /> : <Play size={15} />}>
                {live.starting ? "Starting…" : live.running ? "Running…" : "Run scenario"}
              </Button>
              {live.session && !busy && (
                <Button variant="ghost" onClick={clearRun} icon={<RotateCcw size={14} />}>Clear</Button>
              )}
              {live.session && (
                <span className="text-caption text-ink-3 sm:ml-auto">
                  <span className="font-medium text-ink-2">{scenarioTitle(live.session.scenario)}</span>
                  {" · "}{live.session.mode}{" · started "}{fmtTime(live.session.started)}{" · "}{plural(live.events.length, "event")}
                  {" · "}<span className={live.session.status === "error" ? "text-crit" : undefined}>{busy ? "running" : live.session.status}</span>
                </span>
              )}
            </div>
            {live.error && <Note tone="crit">{live.error}</Note>}
          </div>
        )}
      </Panel>

      {/* ---- taint + counters (sticky on wide screens so lockdown stays in view) */}
      <div className="z-30 mb-6 rounded-card border border-line bg-bg/90 p-2.5 backdrop-blur-md lg:sticky lg:top-16" aria-label="Run status">
        <RunStatus taint={taint} counts={counts} />
      </div>

      {!live.session && !busy ? (
        <EmptyState title="Pick a scenario and press Run" icon={<Radio size={20} />}>
          The agent's steps appear on the left. Every request it tries to send out of the machine appears on the right as a decision card:
          what it tried to send next to what actually left.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section aria-labelledby="timeline-title" className="min-w-0">
            <Panel>
              <PanelTitle id="timeline-title" hint="What the agent is doing, step by step.">Agent timeline</PanelTitle>
              {live.events.length === 0 ? (
                <div className="space-y-3" aria-busy="true">
                  {[0, 1, 2].map((i) => <div key={i} className="flex gap-3"><Skeleton className="h-8 w-8 rounded-full" /><Skeleton className="h-8 flex-1" /></div>)}
                </div>
              ) : (
                <Timeline events={live.events} running={busy} />
              )}
            </Panel>
          </section>

          <section aria-labelledby="feed-title" className="min-w-0">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="feed-title" className="font-display text-[18px] font-semibold leading-tight tracking-[-0.01em] text-ink">Egress decisions</h2>
                <p className="mt-1 text-support text-ink-3">Every request that tried to leave the machine, newest first.</p>
              </div>
            </div>
            {newestFirst.length === 0 ? (
              <div className="flex items-center gap-3 rounded-card border border-dashed border-line-strong bg-surface-2/70 px-5 py-6 text-support text-ink-3">
                <ShieldCheck size={18} className="shrink-0 text-ink-3" aria-hidden />
                {busy ? "Waiting for the agent's first outbound request…" : "This run made no outbound requests."}
              </div>
            ) : (
              <div className="space-y-4">
                <AnimatePresence initial={false}>
                  {newestFirst.map((d) => (
                    <DecisionCard key={d.request_id} decision={d} fresh={live.fresh.has(d.request_id)} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
