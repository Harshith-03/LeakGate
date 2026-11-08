/**
 * What the agent is doing, as a compact terminal log: one line per event with a type tag, the
 * title, an optional detail (clamped, expandable) and the moments the session's taint changed.
 * Egress lines carry the gate's verdict and jump to the matching decision monitor.
 */
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentEvent, EventType, TaintState } from "../api/types";
import { ACTION_LABEL, fmtTime, hostOf } from "../lib/format";
import { ACTION_TONE } from "./chips";
import { cx } from "./ui";

const TAG: Record<EventType, { label: string; cls: string; sr: string }> = {
  task: { label: "Task", cls: "text-brand ring-brand/40 bg-brand-tint", sr: "Task" },
  thought: { label: "Think", cls: "text-ink-3 ring-line-strong bg-transparent", sr: "Agent thought" },
  tool_call: { label: "Call", cls: "text-ink-2 ring-line-strong bg-surface-3/60", sr: "Tool call" },
  tool_result: { label: "Result", cls: "text-ink-2 ring-line-strong bg-surface-3/60", sr: "Tool result" },
  egress: { label: "Egress", cls: "text-info ring-info/40 bg-info-soft", sr: "Outbound request" },
  answer: { label: "Answer", cls: "text-good ring-good/45 bg-good-soft", sr: "Answer" },
  error: { label: "Error", cls: "text-crit ring-crit/45 bg-crit-soft", sr: "Error" },
  info: { label: "Note", cls: "text-info ring-info/35 bg-transparent", sr: "Note" },
};
const GUARD = { label: "Guard", cls: "text-crit ring-crit/45 bg-crit-soft", sr: "Socket guard" };
/** The live agent attaches this explainer to every tool call; it lives in the tag's tooltip instead. */
const BOILERPLATE = /^The agent's own tool call\./;

/** Scroll to an egress card in the feed and move focus there, so keyboard users land on it too. */
export function revealDecision(requestId: string) {
  const el = document.getElementById(`decision-${requestId}`);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  el.focus({ preventScroll: true });
}

/**
 * `fitBottom`: on wide screens, cap the log's height so it ends `fitBottom` px above the bottom of the
 * viewport wherever the monitor sits (it grows as the page scrolls and the monitor sticks), so the
 * newest line is always on screen.
 */
export function Timeline({ events, running, className, fitBottom }: {
  events: AgentEvent[]; running: boolean; className?: string; fitBottom?: number;
}) {
  const box = useRef<HTMLOListElement>(null);
  const stick = useRef(true);

  // Follow new events while the reader is at the bottom; leave them alone if they scrolled up.
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length, running]);

  useEffect(() => {
    const el = box.current;
    if (!el || fitBottom === undefined) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    let raf = 0;
    const fit = () => {
      raf = 0;
      if (!wide.matches) { el.style.maxHeight = ""; return; }
      const top = Math.max(0, el.getBoundingClientRect().top);
      el.style.maxHeight = `${Math.max(300, Math.round(window.innerHeight - top - fitBottom))}px`;
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(fit); };
    fit();
    // the monitor moves without a scroll when something above it changes size (e.g. guided demos fold out)
    const ro = new ResizeObserver(queue);
    ro.observe(document.body);
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    wide.addEventListener("change", queue);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
      wide.removeEventListener("change", queue);
    };
  }, [fitBottom]);

  return (
    <ol
      ref={box}
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}
      aria-label="Agent timeline"
      aria-live="polite"
      className={cx("scroll-thin overflow-y-auto pr-1", className)}
    >
      {events.map((e, i) => (
        <EventRow key={e.seq} event={e} prev={events[i - 1]?.taint} />
      ))}
      {running && (
        <li className="flex items-center gap-2 py-2 pl-[4.9rem] font-mono text-[12px] text-ink-3 max-sm:pl-0">
          <span className="text-brand">▸</span> agent is working<span className="cursor-block" aria-hidden />
        </li>
      )}
    </ol>
  );
}

function EventRow({ event: e, prev }: { event: AgentEvent; prev?: TaintState }) {
  const guard = e.type === "info" && /socket guard/i.test(e.title);
  const tag = guard ? GUARD : TAG[e.type] ?? TAG.info;
  const turnedPrivate = e.taint?.private && !prev?.private;
  const turnedUntrusted = e.taint?.untrusted && !prev?.untrusted;
  const lockdownNow = (e.taint?.lockdown ?? (e.taint?.private && e.taint?.untrusted)) && !(prev?.lockdown ?? (prev?.private && prev?.untrusted));
  const compromised = e.type === "thought" && /^\(compromised\)/i.test(e.title);
  const d = e.decision;
  const detail = e.detail && !BOILERPLATE.test(e.detail) ? e.detail : null;

  if (e.type === "task") {
    return (
      <li className="mb-2 border-b border-line pb-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="eyebrow text-brand"><span className="sr-only">{tag.sr}: </span>Prompt</span>
          <time className="tnum hidden font-mono text-[11px] text-ink-3 sm:block" dateTime={e.ts}>{fmtTime(e.ts)}</time>
        </div>
        <p className="glow-soft mt-1.5 break-words font-mono text-[13px] leading-relaxed text-brand [overflow-wrap:anywhere]">
          <span aria-hidden className="mr-1.5 text-brand/70">&gt;</span>{e.title}
        </p>
        {detail && <p className="mt-1 text-caption text-ink-3">{detail}</p>}
      </li>
    );
  }

  return (
    <li className="grid grid-cols-[4.4rem_minmax(0,1fr)] gap-x-2.5 py-[7px] max-sm:grid-cols-1 max-sm:gap-y-1">
      <span className="pt-px">
        {e.type === "egress" && d ? (
          <span className={cx("inline-flex h-[19px] w-full items-center justify-center rounded-[4px] font-mono text-[9.5px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset max-sm:w-auto max-sm:px-1.5", ACTION_TONE[d.action].chip)}>
            {ACTION_LABEL[d.action]}
          </span>
        ) : (
          <span title={e.type === "tool_call" && e.detail ? e.detail : undefined}
            className={cx("inline-flex h-[19px] w-full items-center justify-center rounded-[4px] font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] ring-1 ring-inset max-sm:w-auto max-sm:px-1.5", compromised ? "bg-crit-soft text-crit ring-crit/45" : tag.cls)}>
            {tag.label}
          </span>
        )}
        <span className="sr-only">{tag.sr}: </span>
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <div className={cx(
            "min-w-0 break-words text-[13px] leading-snug [overflow-wrap:anywhere]",
            e.type === "tool_call" ? "font-mono text-[12.5px] text-ink" : e.type === "thought" ? (compromised ? "text-[#ffb9b1]" : "text-ink-2") : e.type === "error" ? "font-medium text-crit" : "font-medium text-ink",
          )}>
            {e.type === "egress" && d ? (
              <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="font-mono text-[12.5px]">{e.title || d.tool}</span>
                <span className="break-all text-caption font-normal text-ink-3">→ {d.destination}</span>
                <button
                  type="button"
                  onClick={() => revealDecision(d.request_id)}
                  className="press inline-flex h-5 items-center gap-0.5 rounded px-1 text-caption font-medium text-brand hover:bg-brand-tint"
                >
                  View<ArrowUpRight size={12} aria-hidden />
                </button>
              </span>
            ) : e.title}
          </div>
          <time className="tnum hidden shrink-0 font-mono text-[11px] text-ink-3 sm:block" dateTime={e.ts}>{fmtTime(e.ts)}</time>
        </div>
        {detail && e.type !== "egress" && (e.type === "answer" ? <Answer event={e} /> : <Detail text={detail} />)}
        {(turnedPrivate || turnedUntrusted || lockdownNow) && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {turnedPrivate && <TaintTag tone="warn">Private data read</TaintTag>}
            {turnedUntrusted && <TaintTag tone="warn">Web content read</TaintTag>}
            {lockdownNow && <TaintTag tone="crit">Lockdown on</TaintTag>}
          </div>
        )}
      </div>
    </li>
  );
}

function TaintTag({ tone, children }: { tone: "warn" | "crit"; children: string }) {
  return (
    <span className={cx(
      "glow-soft inline-flex h-5 items-center gap-1.5 rounded-[4px] px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset",
      tone === "crit" ? "bg-crit-soft text-crit ring-crit/45" : "bg-warn-soft text-warn ring-warn/40",
    )}>
      <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", tone === "crit" ? "bg-crit" : "bg-warn")} style={{ boxShadow: "0 0 6px currentColor" }} />
      {children}
    </span>
  );
}

function Detail({ text }: { text: string }) {
  const long = text.length > 200 || text.split("\n").length > 3;
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-0.5">
      <p className={cx("whitespace-pre-line break-words text-support text-ink-3 [overflow-wrap:anywhere]", long && !open && "line-clamp-2")}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="mt-0.5 rounded-md text-caption font-medium text-brand hover:text-brand-hover">
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function Answer({ event: e }: { event: AgentEvent }) {
  return (
    <div className="well mt-2 py-3 pl-4 pr-3.5">
      <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-good" style={{ boxShadow: "0 0 10px var(--good)" }} />
      <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink">{e.detail}</p>
      {e.citations?.length > 0 && (
        <div className="mt-3 border-t border-line pt-2.5">
          <div className="eyebrow mb-1 text-ink-3">Sources</div>
          <ol className="space-y-1">
            {e.citations.map((c, i) => (
              <li key={i} className="flex min-w-0 items-baseline gap-2 text-caption">
                <span className="tnum shrink-0 font-mono text-ink-3">[{i + 1}]</span>
                <a href={c.url} target="_blank" rel="noopener noreferrer"
                  className="group inline-flex min-w-0 items-baseline gap-1 rounded-md text-ink-2 hover:text-brand">
                  <span className="min-w-0">{c.title}</span>
                  <span className="shrink-0 text-ink-3">· {hostOf(c.url)}</span>
                  <ExternalLink size={11} className="shrink-0 self-center text-ink-3" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
