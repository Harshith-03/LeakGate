import { motion } from "framer-motion";
import { Ban, CheckCircle2, Lock, LockOpen, PenLine } from "lucide-react";
import type { ReactNode } from "react";
import type { TaintState } from "../api/types";
import { InfoTip } from "./HoverCard";
import { cx } from "./ui";

const TRIFECTA =
  "An agent that can read private data, read untrusted content and send messages out can be tricked by that content into leaking the data. "
  + "Once the first two have happened, LeakGate shrinks the third to approved destinations only, and treats links that came from web pages as hostile.";

export interface RunCounts { allow: number; rewrite: number; redact: number; block: number; monitored: number }

/**
 * The persistent run indicator: two lights (private data read, untrusted web content read), the
 * lockdown they trigger together, and the allowed / rewritten / blocked counters. One row on wide
 * screens so it can stay pinned without eating the page.
 */
export function RunStatus({ taint, counts }: { taint: TaintState; counts: RunCounts }) {
  const lockdown = taint.lockdown || (taint.private && taint.untrusted);
  const pages = taint.untrusted_sources.length;
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-2.5 @min-[920px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.45fr)_auto]">
        <Light
          on={taint.private}
          label="Private data read"
          sub={taint.private ? (taint.private_sources.join(", ") || "Yes") : "Not yet"}
        />
        <Light
          on={taint.untrusted}
          label="Untrusted web content read"
          sub={taint.untrusted ? (pages ? `${pages} page${pages === 1 ? "" : "s"} from the web` : "Yes") : "Not yet"}
        />
        <div
          role="status"
          aria-live="polite"
          className={cx(
            "col-span-2 flex min-w-0 items-center gap-3 rounded-panel px-3.5 py-2.5 transition-colors duration-200 @min-[920px]:col-span-1",
            lockdown ? "bg-hero text-on-hero" : "bg-surface-3/70 text-ink-2",
          )}
        >
          <span className={cx("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full", lockdown ? "bg-on-hero/12" : "bg-surface")} aria-hidden>
            {lockdown ? <Lock size={16} /> : <LockOpen size={16} className="text-ink-3" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className={cx("text-[13.5px] font-semibold leading-snug", lockdown ? "text-on-hero" : "text-ink")}>
              {lockdown ? "Lockdown: only approved destinations" : taint.private ? "Allowlist only" : "No lockdown"}
            </div>
            <div className={cx("text-caption leading-snug", lockdown ? "text-on-hero-2" : "text-ink-3")}>
              {lockdown
                ? "Links from web pages are treated as hostile."
                : taint.private
                  ? "Private data read, so unknown hosts are blocked. Lockdown when web content is read too."
                  : "Turns on when both lights are on."}
            </div>
          </div>
          <InfoTip label="Why lockdown? The lethal trifecta" className={lockdown ? "text-on-hero" : "text-ink-3"}>
            <span className="block font-semibold text-ink">The “lethal trifecta”</span>
            <span className="mt-1 block">{TRIFECTA}</span>
          </InfoTip>
        </div>
        <Counters counts={counts} className="col-span-2 @min-[920px]:col-span-1" />
      </div>
    </div>
  );
}

function Light({ on, label, sub }: { on: boolean; label: string; sub: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-panel border border-line bg-surface px-3.5 py-2.5">
      <span className="relative inline-flex h-3.5 w-3.5 shrink-0" aria-hidden>
        <motion.span
          className={cx("absolute inset-0 rounded-full", on ? "bg-warn" : "border-2 border-line-strong")}
          initial={false}
          animate={on ? { scale: [1, 1.35, 1] } : { scale: 1 }}
          transition={{ duration: 0.4 }}
          style={on ? { boxShadow: "0 0 0 4px color-mix(in srgb, var(--warn) 22%, transparent)" } : undefined}
        />
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold leading-snug text-ink">
          {label}<span className="sr-only">: {on ? "yes" : "no"}</span>
        </div>
        <div className="truncate text-caption leading-snug text-ink-3" title={sub}>{sub}</div>
      </div>
    </div>
  );
}

/** Allowed / rewritten / blocked. Redactions count with rewrites (both change what leaves). */
export function Counters({ counts, className }: { counts: RunCounts; className?: string }) {
  const items: { key: string; label: string; n: number; icon: ReactNode; tone: string; title?: string }[] = [
    { key: "allow", label: "Allowed", n: counts.allow, icon: <CheckCircle2 size={13} />, tone: "text-good" },
    { key: "rewrite", label: "Rewritten", n: counts.rewrite + counts.redact, icon: <PenLine size={13} />, tone: "text-warn",
      title: counts.redact ? `${counts.rewrite} rewritten, ${counts.redact} redacted` : undefined },
    { key: "block", label: "Blocked", n: counts.block, icon: <Ban size={13} />, tone: "text-crit" },
  ];
  return (
    <div className={cx("grid grid-cols-3 gap-2.5", className)}>
      {items.map((it) => (
        <div key={it.key} title={it.title} className="min-w-[5.5rem] rounded-panel border border-line bg-surface px-3 py-2">
          <div className="tnum font-display text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink">{it.n}</div>
          <div className="mt-1 flex items-center gap-1 text-caption font-medium text-ink-2">
            <span className={it.tone} aria-hidden>{it.icon}</span>{it.label}
          </div>
        </div>
      ))}
    </div>
  );
}
