/**
 * The run's status rack: two indicator lamps (private data read, web content read), the LOCKDOWN
 * lamp they light together, and 7-segment counters for allowed / rewritten / blocked. It lays itself
 * out by its own width (container queries): a single row when wide, stacked when it sits in a column.
 */
import type { CSSProperties, ReactNode } from "react";
import type { TaintState } from "../api/types";
import { Led, SevenSeg, useTicker } from "./crt";
import { InfoTip } from "./HoverCard";
import { cx } from "./ui";

const TRIFECTA =
  "An agent that can read private data, read untrusted content and send messages out can be tricked by that content into leaking the data. "
  + "Once the first two have happened, LeakGate shrinks the third to approved destinations only, and treats links that came from web pages as hostile.";

export interface RunCounts { allow: number; rewrite: number; redact: number; block: number; monitored: number }

export function StatusRack({ taint, counts, className }: { taint: TaintState; counts: RunCounts; className?: string }) {
  const lockdown = taint.lockdown || (taint.private && taint.untrusted);
  const pages = taint.untrusted_sources.length;
  return (
    <section aria-label="Run status" className={cx("rack @container flex flex-col p-3 sm:p-3.5", className)}>
      <div className="mb-2.5 flex items-center gap-2 px-0.5">
        <span className="crt-screw" aria-hidden />
        <span className="eyebrow text-chrome-3">Session status</span>
        <span className="crt-vents ml-auto" aria-hidden />
        <span className="crt-screw" aria-hidden />
      </div>
      <div className="grid flex-1 grid-cols-2 grid-rows-[auto_1fr_auto] gap-2.5 @min-[860px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] @min-[860px]:grid-rows-[auto]">
        <Lamp
          on={taint.private}
          label="Private data read"
          sub={taint.private ? (taint.private_sources.join(", ") || "Yes") : "Not yet"}
        />
        <Lamp
          on={taint.untrusted}
          label="Web content read"
          sub={taint.untrusted ? (pages ? `${pages} page${pages === 1 ? "" : "s"} from the web` : "Yes") : "Not yet"}
        />
        <div
          role="status"
          aria-live="polite"
          className="lamp col-span-2 flex min-w-0 items-center gap-3 px-3.5 py-2.5 @min-[860px]:col-span-1"
          data-on={lockdown ? "" : undefined}
          style={{ "--lamp": "var(--crit-rgb)" } as CSSProperties}
        >
          <Led state={lockdown ? "alarm" : taint.private ? "warn" : "off"} size="lg" pulse={lockdown} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className={cx("font-crt text-[26px] leading-none tracking-[0.14em]", lockdown ? "glow text-[#ffe0db]" : "text-[#6c7480]")}>LOCKDOWN</span>
              <span className={cx("eyebrow text-[9.5px]", lockdown ? "text-[#ffc9c2]" : "text-chrome-3")}>{lockdown ? "On" : "Off"}</span>
            </div>
            <div className={cx("mt-1 text-caption leading-snug", lockdown ? "text-[#ffd2cc]" : "text-chrome-2")}>
              {lockdown
                ? "Only approved destinations. Links from web pages are treated as hostile."
                : taint.private
                  ? "Private data read, so unknown hosts are blocked. Lockdown once web content is read too."
                  : "Lights when both lamps are on: the lethal trifecta guard."}
            </div>
          </div>
          <InfoTip label="Why lockdown? The lethal trifecta" className={lockdown ? "text-[#ffe0db]" : "text-chrome-2"}>
            <span className="block font-semibold text-ink">The “lethal trifecta”</span>
            <span className="mt-1 block">{TRIFECTA}</span>
          </InfoTip>
        </div>
        <Counters counts={counts} className="col-span-2 @min-[860px]:col-span-1" />
      </div>
    </section>
  );
}

function Lamp({ on, label, sub }: { on: boolean; label: string; sub: string }) {
  return (
    <div className="lamp flex min-w-0 items-center gap-3 px-3 py-2.5" data-on={on ? "" : undefined}
      style={{ "--lamp": "var(--warn-rgb)" } as CSSProperties}>
      <Led state={on ? "warn" : "off"} size="lg" />
      <div className="min-w-0">
        <div className={cx("text-[12.5px] font-semibold leading-snug", on ? "glow-soft text-[#fff0d9]" : "text-chrome-2")}>
          {label}<span className="sr-only">: {on ? "yes" : "no"}</span>
        </div>
        <div className={cx("truncate text-caption leading-snug", on ? "text-[#ffd9a3]" : "text-chrome-3")} title={sub}>{sub}</div>
      </div>
    </div>
  );
}

/** Allowed / rewritten / blocked on 7-segment readouts. Redactions count with rewrites (both change what leaves). */
export function Counters({ counts, className }: { counts: RunCounts; className?: string }) {
  const items: { key: string; label: string; n: number; color: string; title?: string }[] = [
    { key: "allow", label: "Allowed", n: counts.allow, color: "var(--good)" },
    { key: "rewrite", label: "Rewritten", n: counts.rewrite + counts.redact, color: "var(--warn)",
      title: counts.redact ? `${counts.rewrite} rewritten, ${counts.redact} redacted` : undefined },
    { key: "block", label: "Blocked", n: counts.block, color: "var(--crit)" },
  ];
  return (
    <div className={cx("grid grid-cols-3 gap-2", className)}>
      {items.map(({ key, ...it }) => <Readout key={key} {...it} />)}
    </div>
  );
}

function Readout({ label, n, color, title }: { label: string; n: number; color: string; title?: string }): ReactNode {
  const shown = useTicker(n);
  return (
    <div title={title} className="readout flex min-w-[5.25rem] flex-col items-center justify-center px-2.5 pb-1.5 pt-2">
      <SevenSeg value={shown} digits={2} color={color} height={30} />
      <div className="eyebrow mt-1.5 text-[9.5px] text-chrome-2">
        {label}<span className="sr-only">: {n}</span>
      </div>
    </div>
  );
}
