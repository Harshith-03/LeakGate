/**
 * The main screen. Top: the prompt console and the session status rack. Below: the Agent monitor
 * (what the agent is doing, sticky on wide screens) next to the Gate (every decision, newest first,
 * each one a CRT monitor). A blocked attack also raises a toast, so it is noticed even off-screen.
 */
import { AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";
import { api } from "../api/client";
import { CUSTOM_SCENARIO } from "../api/types";
import { useApi } from "../api/useApi";
import { ACTION_TONE } from "../components/chips";
import { Led, Monitor } from "../components/crt";
import { DecisionCard } from "../components/DecisionCard";
import { PromptConsole } from "../components/PromptConsole";
import { StatusRack } from "../components/StatusRack";
import { Timeline } from "../components/Timeline";
import { useToast } from "../components/Toast";
import { SCENARIO_FALLBACK_TITLE, fmtTime, plural } from "../lib/format";
import { countsOf, decisionsOf, restoreLatest, taintOf, useLive } from "../state/live";

export default function Console() {
  const live = useLive();
  const toast = useToast();
  const scenarios = useApi(() => api.scenarios());

  useEffect(() => { void restoreLatest(); }, []);

  const decisions = useMemo(() => decisionsOf(live.events), [live.events]);
  const newestFirst = useMemo(() => [...decisions].reverse(), [decisions]);
  const counts = useMemo(() => countsOf(decisions), [decisions]);
  const taint = taintOf(live.events, live.session);
  const busy = live.starting || live.running;
  const latest = newestFirst[0];

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

  const s = live.session;
  const runTitle = !s ? null
    : s.scenario === CUSTOM_SCENARIO ? "Your prompt"
      : scenarios.data?.find((x) => x.name === s.scenario)?.title ?? SCENARIO_FALLBACK_TITLE[s.scenario] ?? s.scenario;
  const errored = s?.status === "error" || live.events.some((e) => e.type === "error");

  return (
    <>
      <h1 className="sr-only">LeakGate console</h1>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] 2xl:gap-6">
        <PromptConsole />
        <StatusRack taint={taint} counts={counts} />
      </div>

      <div className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start 2xl:gap-8">
        {/* ---- the agent */}
        <Monitor
          className="lg:sticky lg:top-[88px]"
          title="Agent"
          titleId="agent-title"
          plate="LG-02 · Claims agent"
          led={!s && !busy ? "off" : errored ? "alarm" : busy ? "ok" : "brand"}
          ledPulse={busy}
          tone="idle"
          padded={false}
          right={s && (
            <span className="hidden min-w-0 items-center gap-2 text-[11.5px] text-chrome-2 sm:flex" title={`Session ${s.session_id}`}>
              <span className="max-w-[12rem] truncate font-medium text-chrome">{runTitle}</span>
              <span className="text-chrome-3">· {s.mode} · {fmtTime(s.started)}</span>
            </span>
          )}
        >
          {!s && !busy ? (
            <div className="flex min-h-[15rem] flex-col items-center justify-center px-6 py-10 text-center">
              <div className="glow font-crt text-[34px] leading-none tracking-[0.08em] text-brand">
                AWAITING INPUT<span className="cursor-block ml-1 align-[-0.12em]" aria-hidden />
              </div>
              <p className="mt-3 max-w-sm text-support text-ink-3">
                Type a prompt above or pick a suggestion. Every step the agent takes shows up here.
              </p>
            </div>
          ) : (
            <>
              <Timeline
                events={live.events}
                running={busy}
                className="max-h-[28rem] px-3.5 py-3 sm:px-4"
                fitBottom={62}
              />
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 font-mono text-[11px] text-ink-3">
                <span>{plural(live.events.length, "event")}</span>
                <span className={errored ? "text-crit" : busy ? "text-good" : undefined}>{busy ? "running" : s?.status ?? "starting"}</span>
              </div>
            </>
          )}
        </Monitor>

        {/* ---- the gate */}
        <section aria-labelledby="gate-title" className="min-w-0">
          <div className="rack mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
            <Led state={latest ? ACTION_TONE[latest.action].led : "off"} size="lg" pulse={busy && !!latest} />
            <h2 id="gate-title" className="crt-title text-[14px]">Gate</h2>
            <span className="text-caption text-chrome-2">Every decision, newest first</span>
            <span className="crt-plate ml-auto">{plural(decisions.length, "decision")}</span>
          </div>
          {newestFirst.length === 0 ? (
            <Monitor led="off" plate="LG-03 · Egress" bodyClassName="flex min-h-[15rem] flex-col items-center justify-center px-6 py-10 text-center">
              <div className="font-crt text-[30px] leading-none tracking-[0.1em] text-ink-3">
                {busy ? <>LISTENING<span className="cursor-block ml-1 align-[-0.12em]" aria-hidden /></> : "NO TRAFFIC"}
              </div>
              <p className="mt-3 max-w-md text-support text-ink-3">
                {busy
                  ? "Waiting for the agent's first outbound request…"
                  : s
                    ? "This run made no outbound requests."
                    : "Every request the agent tries to send out of the machine lands here: what it tried to send next to what actually left."}
              </p>
            </Monitor>
          ) : (
            <div className="space-y-7">
              <AnimatePresence initial={false}>
                {newestFirst.map((d, i) => (
                  <DecisionCard key={d.request_id} decision={d} fresh={live.fresh.has(d.request_id)} delay={live.fresh.has(d.request_id) ? 0 : Math.min(i, 5) * 70} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
