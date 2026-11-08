/**
 * The main screen, prompt first.
 *
 *  - Before a run: only the prompt console, centred and hero-sized under a one-line headline.
 *  - On Run (or a guided demo): the prompt glides up to the top (framer `layout="position"`, ~600 ms),
 *    then the status rack, the Agent monitor and the Gate rise in, staggered, each with its CRT
 *    power-on. Decisions keep arriving as monitors in the Gate, newest first.
 *  - Clear reverses it: the monitors fold away and the prompt glides back to the centre.
 *
 * The prompt keeps the same width in both states (the hero column is exactly the width of the
 * revealed prompt column), so the move is a pure translate: no text stretching, no layout jump.
 * Under prefers-reduced-motion the swap is instant.
 */
import { AnimatePresence, LayoutGroup, motion, useReducedMotion, type Transition } from "framer-motion";
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
import { cx } from "../components/ui";
import { SCENARIO_FALLBACK_TITLE, fmtTime, plural } from "../lib/format";
import { countsOf, decisionsOf, restoreLatest, taintOf, useLive } from "../state/live";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
/** when the monitors start rising, after the prompt has mostly arrived (s) */
const REVEAL_AT = 0.34;
const STAGGER = 0.1;

export default function Console() {
  const live = useLive();
  const toast = useToast();
  const scenarios = useApi(() => api.scenarios());
  const reduce = !!useReducedMotion();

  useEffect(() => { void restoreLatest(); }, []);

  const decisions = useMemo(() => decisionsOf(live.events), [live.events]);
  const newestFirst = useMemo(() => [...decisions].reverse(), [decisions]);
  const counts = useMemo(() => countsOf(decisions), [decisions]);
  const taint = taintOf(live.events, live.session);
  const busy = live.starting || live.running;
  const latest = newestFirst[0];
  const s = live.session;
  // Reveal once the API has accepted a run (a rejected prompt never flashes the monitors).
  const revealed = !!s;

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

  // Scroll: back to the top when the console resets; on narrow screens, bring the rack into view on reveal.
  const rackRef = useRef<HTMLDivElement>(null);
  const wasRevealed = useRef(revealed);
  useEffect(() => {
    if (wasRevealed.current === revealed) return;
    wasRevealed.current = revealed;
    const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
    if (!revealed) {
      if (window.scrollY > 0) window.scrollTo({ top: 0, behavior });
      return;
    }
    if (window.matchMedia("(max-width: 1279.98px)").matches) {
      const t = setTimeout(() => {
        const el = rackRef.current;
        if (!el) return;
        const top = el.getBoundingClientRect().top + window.scrollY - 84;
        if (top > window.scrollY + 40) window.scrollTo({ top, behavior });
      }, reduce ? 0 : (REVEAL_AT + 0.25) * 1000);
      return () => clearTimeout(t);
    }
  }, [revealed, reduce]);

  const move: Transition = reduce ? { duration: 0 } : { duration: 0.62, ease: EASE };
  const rise = (i: number) => reduce
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0 } } }
    : {
      initial: { opacity: 0, y: 28, scale: 0.985 },
      animate: { opacity: 1, y: 0, scale: 1, transition: { delay: REVEAL_AT + i * STAGGER, duration: 0.5, ease: EASE } },
      exit: { opacity: 0, y: 18, scale: 0.99, transition: { duration: 0.2, ease: "easeIn" as const } },
    };
  const powerAt = (i: number) => (reduce ? 0 : Math.round((REVEAL_AT + i * STAGGER + 0.12) * 1000));

  const runTitle = !s ? null
    : s.scenario === CUSTOM_SCENARIO ? "Your prompt"
      : scenarios.data?.find((x) => x.name === s.scenario)?.title ?? SCENARIO_FALLBACK_TITLE[s.scenario] ?? s.scenario;
  const errored = s?.status === "error" || live.events.some((e) => e.type === "error");

  return (
    <LayoutGroup>
      {revealed && <h1 className="sr-only">LeakGate console</h1>}

      <div
        className={cx(
          "relative",
          revealed
            ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]"
            : "flex flex-col items-center md:min-h-[calc(100svh-170px)] md:justify-center md:pb-[5vh]",
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {!revealed && (
            <motion.div
              key="hero"
              className="mb-6 w-full max-w-3xl px-2 text-center sm:mb-8"
              initial={reduce ? false : { opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0, transition: reduce ? { duration: 0 } : { duration: 0.45, delay: 0.25, ease: EASE } }}
              exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -18, transition: { duration: 0.22, ease: "easeIn" } }}
            >
              <div className="eyebrow flex items-center justify-center gap-2 text-chrome-2">
                <Led state="brand" size="sm" pulse />
                A firewall for AI agents
              </div>
              <h1 className="mt-3 font-display text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:text-[44px]"
                style={{ textShadow: "0 4px 40px rgb(var(--accent-rgb) / 0.35)" }}>
                Give the agent a task.{" "}
                <span className="bg-gradient-to-r from-[#3fe1ff] via-[#b685ff] to-[#ff6fe0] bg-clip-text text-transparent">
                  See what tries to leave.
                </span>
              </h1>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          layout="position"
          transition={move}
          className={cx("w-full min-w-0", !revealed && "xl:max-w-[calc(100%-424px)]")}
        >
          <PromptConsole className="h-full" />
        </motion.div>

        <AnimatePresence mode="popLayout">
          {revealed && (
            <motion.div key="rack" className="min-w-0" {...rise(0)}>
              <div ref={rackRef} className="h-full">
                <StatusRack taint={taint} counts={counts} className="h-full" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="popLayout">
        {revealed && (
          <motion.div key="bay" className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start 2xl:gap-8"
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 16, transition: { duration: 0.2, ease: "easeIn" } }}>
            {/* ---- the agent (the wrapper is the sticky element: a sticky child can't leave its wrapper) */}
            <motion.div className="min-w-0 lg:sticky lg:top-[88px] lg:self-start" {...rise(1)}>
              <Monitor
                title="Agent"
                titleId="agent-title"
                plate="LG-02 · Claims agent"
                led={errored ? "alarm" : busy ? "ok" : "brand"}
                ledPulse={busy}
                tone="idle"
                glow={busy}
                padded={false}
                delay={powerAt(1)}
                right={s && (
                  <span className="hidden min-w-0 items-center gap-2 text-[11.5px] text-chrome-2 sm:flex" title={`Session ${s.session_id}`}>
                    <span className="max-w-[12rem] truncate font-medium text-chrome">{runTitle}</span>
                    <span className="text-chrome-3">· {s.mode} · {fmtTime(s.started)}</span>
                  </span>
                )}
              >
                <Timeline
                  events={live.events}
                  running={busy}
                  className="max-h-[28rem] min-h-[9rem] px-3.5 py-3 sm:px-4"
                  fitBottom={62}
                />
                <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 font-mono text-[11px] text-ink-3">
                  <span>{plural(live.events.length, "event")}</span>
                  <span className={errored ? "text-crit" : busy ? "text-good" : undefined}>{busy ? "running" : s?.status ?? "starting"}</span>
                </div>
              </Monitor>
            </motion.div>

            {/* ---- the gate */}
            <motion.section aria-labelledby="gate-title" className="min-w-0" {...rise(2)}>
              <div className="rack mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <Led state={latest ? ACTION_TONE[latest.action].led : "off"} size="lg" pulse={busy && !!latest} />
                <h2 id="gate-title" className="crt-title text-[14px]">Gate</h2>
                <span className="text-caption text-chrome-2">Every decision, newest first</span>
                <span className="crt-plate ml-auto">{plural(decisions.length, "decision")}</span>
              </div>
              {newestFirst.length === 0 ? (
                <Monitor led={busy ? "brand" : "off"} ledPulse={busy} plate="LG-03 · Egress" tone="brand" delay={powerAt(2)}
                  bodyClassName="flex min-h-[15rem] flex-col items-center justify-center px-6 py-10 text-center">
                  <div className="glow-soft font-crt text-[30px] leading-none tracking-[0.1em] text-brand">
                    {busy ? <>LISTENING<span className="cursor-block ml-1 align-[-0.12em]" aria-hidden /></> : "NO TRAFFIC"}
                  </div>
                  <p className="mt-3 max-w-md text-support text-ink-3">
                    {busy
                      ? "Waiting for the agent's first outbound request…"
                      : "This run made no outbound requests."}
                  </p>
                </Monitor>
              ) : (
                <div className="space-y-7">
                  <AnimatePresence initial={false}>
                    {newestFirst.map((d, i) => (
                      <DecisionCard key={d.request_id} decision={d} fresh={live.fresh.has(d.request_id)}
                        delay={live.fresh.has(d.request_id) ? 0 : powerAt(2) + Math.min(i, 5) * 70} />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </LayoutGroup>
  );
}
