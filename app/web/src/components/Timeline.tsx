import {
  AlertTriangle, ArrowUpRight, CheckCircle2, ClipboardList, ExternalLink, FileText, Globe, Info, Lock, MessageCircle,
  Network, Wrench, FileLock2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentEvent, EventType, TaintState } from "../api/types";
import { fmtTime, hostOf } from "../lib/format";
import { ActionChip } from "./chips";
import { cx } from "./ui";

const ICON: Record<EventType, { icon: ReactNode; tone: string; label: string }> = {
  task: { icon: <ClipboardList size={15} />, tone: "bg-brand-tint text-brand", label: "Task" },
  thought: { icon: <MessageCircle size={15} />, tone: "bg-surface-3 text-ink-2", label: "Agent thought" },
  tool_call: { icon: <Wrench size={15} />, tone: "bg-surface-3 text-ink-2", label: "Tool call" },
  tool_result: { icon: <FileText size={15} />, tone: "bg-surface-3 text-ink-2", label: "Tool result" },
  egress: { icon: <ArrowUpRight size={15} />, tone: "bg-info-soft text-info", label: "Outbound request" },
  answer: { icon: <CheckCircle2 size={15} />, tone: "bg-good-soft text-good", label: "Answer" },
  error: { icon: <AlertTriangle size={15} />, tone: "bg-crit-soft text-crit", label: "Error" },
  info: { icon: <Info size={15} />, tone: "bg-surface-3 text-ink-2", label: "Note" },
};

/** Scroll to an egress card in the feed and move focus there, so keyboard users land on it too. */
export function revealDecision(requestId: string) {
  const el = document.getElementById(`decision-${requestId}`);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  el.focus({ preventScroll: true });
}

export function Timeline({ events, running }: { events: AgentEvent[]; running: boolean }) {
  const box = useRef<HTMLOListElement>(null);
  const stick = useRef(true);

  // Follow new events while the reader is at the bottom; leave them alone if they scrolled up.
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <ol
      ref={box}
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}
      aria-label="Agent timeline"
      aria-live="polite"
      className="scroll-thin max-h-[26rem] space-y-0 overflow-y-auto pr-1 lg:max-h-[calc(100vh-15rem)] lg:pr-2"
    >
      {events.map((e, i) => (
        <EventRow key={e.seq} event={e} prev={events[i - 1]?.taint} last={i === events.length - 1 && !running} />
      ))}
      {running && (
        <li className="relative flex items-center gap-3 pb-1 pl-0 pt-1 text-support text-ink-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden>
            <span className="live-dot h-2 w-2 rounded-full bg-brand" />
          </span>
          Agent is working…
        </li>
      )}
    </ol>
  );
}

const SOCKET_GUARD = { icon: <Network size={15} />, tone: "bg-crit-soft text-crit", label: "Socket guard" };

function EventRow({ event: e, prev, last }: { event: AgentEvent; prev?: TaintState; last: boolean }) {
  // The socket guard (a backstop below the SDK) reports through info events; give them the "stopped" look.
  const meta = e.type === "info" && /socket guard/i.test(e.title) ? SOCKET_GUARD : ICON[e.type] ?? ICON.info;
  const turnedPrivate = e.taint?.private && !prev?.private;
  const turnedUntrusted = e.taint?.untrusted && !prev?.untrusted;
  const lockdownNow = (e.taint?.lockdown ?? (e.taint?.private && e.taint?.untrusted)) && !(prev?.lockdown ?? (prev?.private && prev?.untrusted));
  return (
    <li className="relative flex gap-3 pb-4">
      {!last && <span aria-hidden className="absolute bottom-0 left-4 top-9 w-px bg-line" />}
      <span className={cx("relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full", meta.tone)} aria-hidden>{meta.icon}</span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0 text-[13.5px] font-medium leading-snug text-ink">
            <span className="sr-only">{meta.label}: </span>
            {e.type === "egress" && e.decision ? <EgressLine event={e} /> : e.title}
          </div>
          <time className="tnum shrink-0 text-micro text-ink-3" dateTime={e.ts}>{fmtTime(e.ts)}</time>
        </div>
        {e.detail && e.type !== "egress" && (e.type === "answer" ? <Answer event={e} /> : <Detail text={e.detail} />)}
        {(turnedPrivate || turnedUntrusted || lockdownNow) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {turnedPrivate && <TaintTag icon={<FileLock2 size={12} />}>Private data read</TaintTag>}
            {turnedUntrusted && <TaintTag icon={<Globe size={12} />}>Untrusted web content read</TaintTag>}
            {lockdownNow && (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-hero px-2.5 text-caption font-semibold text-on-hero">
                <Lock size={12} aria-hidden /> Lockdown on
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function EgressLine({ event: e }: { event: AgentEvent }) {
  const d = e.decision!;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <ActionChip action={d.action} />
      <span className="min-w-0">{e.title || d.destination}</span>
      {e.title && <span className="min-w-0 break-all text-caption font-normal text-ink-3">→ {d.destination}</span>}
      <button
        type="button"
        onClick={() => revealDecision(d.request_id)}
        className="press inline-flex h-6 items-center gap-1 rounded-full px-2 text-caption font-medium text-brand hover:bg-brand-tint"
      >
        View card <ArrowUpRight size={12} aria-hidden />
      </button>
    </span>
  );
}

function TaintTag({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-warn-soft px-2.5 text-caption font-medium text-warn">
      <span aria-hidden>{icon}</span>{children}
    </span>
  );
}

function Detail({ text }: { text: string }) {
  const long = text.length > 240;
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <p className={cx("whitespace-pre-line break-words text-support text-ink-3 [overflow-wrap:anywhere]", long && !open && "line-clamp-3")}>{text}</p>
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
    <div className="mt-2 rounded-panel bg-brand-tint px-4 py-3">
      <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink">{e.detail}</p>
      {e.citations?.length > 0 && (
        <div className="mt-3 border-t border-brand/15 pt-2.5">
          <div className="mb-1 text-micro font-semibold uppercase tracking-[0.07em] text-ink-3">Sources</div>
          <ol className="space-y-1">
            {e.citations.map((c, i) => (
              <li key={i} className="flex min-w-0 items-baseline gap-2 text-caption">
                <span className="tnum shrink-0 text-ink-3">[{i + 1}]</span>
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
