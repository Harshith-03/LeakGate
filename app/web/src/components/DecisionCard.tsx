/**
 * The hero of the product: one egress decision. "Tried to send" renders the API's pre-masked
 * segments with every hit highlighted (hover or focus a hit for its Finding); "Actually sent"
 * renders `sent` exactly as returned. Nothing here ever sees a raw sensitive value.
 */
import { motion } from "framer-motion";
import {
  ArrowRight, ChevronDown, Cpu, Eye, FileLock2, Hash, Lock, ShieldCheck, ShieldX, Timer, Wrench,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Decision, Finding, Segment } from "../api/types";
import {
  ACTION_LABEL, ENCODING_LABEL, LAYER_HINT, LAYER_LABEL, SEVERITY_LABEL, flatten, fmtMs, fmtTime, kindLabel, valueText,
} from "../lib/format";
import { ActionChip, ChannelChip, KindChip, LayerChip, severityTone } from "./chips";
import { FloatingCard, useHoverCard } from "./HoverCard";
import { cx } from "./ui";

export function DecisionCard({ decision: d, fresh = false, compact = false }: {
  decision: Decision; fresh?: boolean; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const blocked = d.action === "block";
  const monitor = d.mode === "monitor";
  const fields = Object.entries(d.attempted ?? {}).map(([f, segs]) => [f, maskForgotten(f, segs, d.findings)] as [string, Segment[]]);
  const referenced = new Set(fields.flatMap(([, segs]) => segs).map((s) => s.finding).filter((i): i is number => i !== null && i !== undefined));
  const unanchored = d.findings.map((f, i) => ({ f, i })).filter(({ i }) => !referenced.has(i));
  const kinds = [...new Set(d.findings.map((f) => f.kind))];

  return (
    <motion.article
      id={`decision-${d.request_id}`}
      tabIndex={-1}
      layout="position"
      initial={fresh ? { opacity: 0, y: 10, scale: blocked ? 0.985 : 1 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      aria-label={`${ACTION_LABEL[d.action]}: ${d.tool} to ${d.destination}`}
      className={cx(
        "@container min-w-0 scroll-mt-24 overflow-hidden rounded-card border bg-surface outline-none lg:scroll-mt-52 focus-visible:ring-2 focus-visible:ring-focus",
        blocked ? "border-crit/45 shadow-sm" : "border-line shadow-xs",
        blocked && fresh && "ring-once",
      )}
    >
      {blocked && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-crit/25 bg-crit-soft px-[var(--pad-card)] py-2.5">
          <span className="inline-flex items-center gap-2 font-display text-[15px] font-semibold text-crit">
            <ShieldX size={17} aria-hidden />
            {monitor ? "Would have been blocked" : "Stopped before it left the machine"}
          </span>
          <span className="flex flex-wrap gap-1.5">
            {kinds.slice(0, 4).map((k) => <KindChip key={k} kind={k} tone="crit" />)}
          </span>
        </div>
      )}
      {monitor && d.action !== "allow" && (
        <div className="flex items-start gap-2 border-b border-warn/25 bg-warn-soft px-[var(--pad-card)] py-2.5 text-support text-ink" role="note">
          <Eye size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <span>
            <strong className="font-semibold">Monitor mode: logged, not enforced.</strong>{" "}
            LeakGate would have {d.action === "block" ? "blocked" : d.action === "redact" ? "redacted" : "rewritten"} this request,
            but the policy is in monitor mode, so the original request went out.
          </span>
        </div>
      )}

      <div className="p-[var(--pad-card)]">
        {/* who → where */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <ActionChip action={d.action} size="lg" />
          <span className="inline-flex min-w-0 items-center gap-1.5 text-body">
            <span className="font-mono text-[12.5px] text-ink-2">{d.tool}</span>
            <ArrowRight size={14} className="shrink-0 text-ink-3" aria-label="to" />
            <span className={cx("min-w-0 break-all font-semibold", blocked ? "text-crit" : "text-ink")}>{d.destination}</span>
          </span>
          <ChannelChip channel={d.channel} />
          <span className="tnum ml-auto text-caption text-ink-3">{fmtTime(d.ts)}</span>
        </div>

        <p className="mt-3 text-[14.5px] leading-relaxed text-ink">{d.reason}</p>

        {/* the comparison */}
        <div className={cx("mt-4 grid gap-3", !compact && "@xl:grid-cols-2")}>
          <Well title="Tried to send" tone={blocked ? "crit" : d.action === "allow" ? "neutral" : "warn"}>
            <Attempted decision={d} fields={fields} />
          </Well>
          <Well title="Actually sent" tone={blocked ? "good" : "neutral"}>
            <Sent decision={d} />
          </Well>
        </div>

        {unanchored.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-micro font-semibold uppercase tracking-[0.07em] text-ink-3">Also found</div>
            <div className="flex flex-wrap gap-1.5">
              {unanchored.map(({ f, i }) => <FindingPill key={i} finding={f} />)}
            </div>
          </div>
        )}

        {/* meta */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-caption text-ink-3">
          {d.rewritten_by && (
            <span className="inline-flex items-center gap-1.5 font-medium text-ink-2">
              {d.rewritten_by === "model" ? <Cpu size={13} className="text-brand" /> : <Wrench size={13} className="text-ink-3" />}
              {d.action === "redact" ? "Redacted" : "Rewritten"} {d.rewritten_by === "model" ? "by local model" : "by rules"}
            </span>
          )}
          <span className="tnum inline-flex items-center gap-1.5" title="Total inspection time">
            <Timer size={13} /> {fmtMs(d.latency_ms)}
          </span>
          {d.findings.length > 0 && (
            <span className="inline-flex items-center gap-1.5"><FileLock2 size={13} />{d.findings.length} finding{d.findings.length === 1 ? "" : "s"}</span>
          )}
          {d.ledger_seq !== null && d.ledger_seq !== undefined && (
            <Link to={`/ledger?seq=${d.ledger_seq}`} className="tnum inline-flex items-center gap-1 rounded-md font-medium text-brand hover:text-brand-hover">
              <Hash size={13} />Ledger {d.ledger_seq}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={detailsId}
            className="press ml-auto inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-medium text-ink-2 hover:bg-surface-3 hover:text-ink"
          >
            Details
            <ChevronDown size={14} className={cx("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
          </button>
        </div>

        <div id={detailsId} hidden={!open}>
          {open && <Details decision={d} />}
        </div>
      </div>
    </motion.article>
  );
}

// ---------------------------------------------------------------- tried vs sent

function Well({ title, tone, children }: { title: string; tone: "neutral" | "warn" | "crit" | "good"; children: ReactNode }) {
  const bar = { neutral: "bg-line-strong", warn: "bg-warn", crit: "bg-crit", good: "bg-good" }[tone];
  return (
    <section className="relative min-w-0 overflow-hidden rounded-panel border border-line bg-surface-2 py-3 pl-4 pr-3.5">
      <span aria-hidden className={cx("absolute inset-y-0 left-0 w-[3px]", bar)} />
      <h3 className="mb-2 text-micro font-semibold uppercase tracking-[0.07em] text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="mb-0.5 font-mono text-[11px] text-ink-3">{children}</div>;
}

const PRIMARY_FIELDS = /^(query|url|urls(\[\d+\])?|body|content|text|prompt)$/;
const SHORT = 40;

/**
 * Fields that carry the story (anything with a hit, the query/URL, long text) get their own block;
 * short plain parameters like topic=general collapse into one quiet line so the hits stand out.
 */
function majorFields(d: Decision): Set<string> {
  const out = new Set<string>();
  for (const [field, segs] of Object.entries(d.attempted ?? {})) {
    const hit = segs.some((s) => s.finding !== null && s.finding !== undefined) || d.findings.some((f) => f.field === field);
    const len = segs.reduce((n, s) => n + s.text.length, 0);
    if (hit || PRIMARY_FIELDS.test(field) || len > SHORT) out.add(field);
  }
  return out;
}

function MinorLine({ items }: { items: [string, string][] }) {
  if (items.length === 0) return null;
  return (
    <p className="font-mono text-[11.5px] text-ink-3 [overflow-wrap:anywhere]">
      {items.map(([k, v]) => `${k}=${v}`).join("  ·  ")}
    </p>
  );
}

/**
 * Defence in depth: if a finding is anchored (start/end) inside a field but no segment points at it,
 * the API left that span as plain text. Plain segments are verbatim slices of the original string,
 * so their original offsets can be rebuilt from the anchored hits around them; the forgotten span is
 * then replaced by the finding's masked preview. If any offset is unknown, the segments are kept as is.
 */
export function maskForgotten(field: string, segs: Segment[], findings: Finding[]): Segment[] {
  const referenced = new Set(segs.map((s) => s.finding).filter((i): i is number => i !== null && i !== undefined));
  const missing = findings
    .map((f, i) => ({ f, i }))
    .filter(({ f, i }) => !referenced.has(i) && f.field === field && f.start !== null && f.end !== null && f.end > f.start);
  if (missing.length === 0) return segs;

  // original [start, end) of every segment
  const spans: { seg: Segment; start: number; end: number }[] = [];
  let pos = 0;
  for (const seg of segs) {
    if (seg.finding !== null && seg.finding !== undefined) {
      const f = findings[seg.finding];
      if (!f || f.start === null || f.end === null || f.field !== field) return segs;
      spans.push({ seg, start: f.start, end: f.end });
      pos = f.end;
    } else {
      spans.push({ seg, start: pos, end: pos + seg.text.length });
      pos += seg.text.length;
    }
  }

  let out: Segment[] = [];
  for (const sp of spans) {
    if (sp.seg.finding !== null && sp.seg.finding !== undefined) { out.push(sp.seg); continue; }
    const inside = missing.filter(({ f }) => f.start! >= sp.start && f.end! <= sp.end).sort((a, b) => a.f.start! - b.f.start!);
    let cursor = sp.start;
    for (const { f, i } of inside) {
      if (f.start! < cursor) continue;
      if (f.start! > cursor) out.push({ text: sp.seg.text.slice(cursor - sp.start, f.start! - sp.start), finding: null });
      out.push({ text: f.preview, finding: i });
      cursor = f.end!;
    }
    if (cursor < sp.end) out.push({ text: sp.seg.text.slice(cursor - sp.start), finding: null });
  }
  out = out.filter((s) => s.text.length > 0);
  return out;
}

function Attempted({ decision: d, fields }: { decision: Decision; fields: [string, Segment[]][] }) {
  if (fields.length === 0) return <p className="text-support text-ink-3">No text fields in this request.</p>;
  const major = majorFields(d);
  const minor = fields.filter(([f]) => !major.has(f)).map(([f, segs]) => [f, segs.map((s) => s.text).join("")] as [string, string]);
  return (
    <div className="space-y-2.5">
      {fields.filter(([f]) => major.has(f)).map(([field, segs]) => (
        <div key={field} className="min-w-0">
          <FieldLabel>{field}</FieldLabel>
          <p className="break-words text-[13.5px] leading-[1.75] text-ink-2 [overflow-wrap:anywhere]">
            {segs.map((s, i) => <SegmentView key={i} seg={s} findings={d.findings} />)}
          </p>
        </div>
      ))}
      <MinorLine items={minor} />
    </div>
  );
}

function SegmentView({ seg, findings }: { seg: Segment; findings: Finding[] }) {
  if (seg.finding === null || seg.finding === undefined || !findings[seg.finding]) return <>{seg.text}</>;
  return <Hit text={seg.text} finding={findings[seg.finding]} />;
}

/** A highlighted hit. Hover, focus or tap shows its Finding; screen readers get the same as inline text. */
function Hit({ text, finding: f }: { text: string; finding: Finding }) {
  const { open, pos, width, triggerProps } = useHoverCard<HTMLElement>(310);
  const tone = severityTone(f.severity);
  const c = tone === "crit" ? "var(--crit)" : "var(--warn)";
  return (
    <>
      <mark
        {...triggerProps}
        tabIndex={0}
        className="cursor-help rounded-[5px] px-1 py-px font-medium text-ink outline-none [box-decoration-break:clone] focus-visible:ring-2 focus-visible:ring-focus"
        style={{
          background: `color-mix(in srgb, ${c} 16%, transparent)`,
          boxShadow: `inset 0 -2px 0 ${c}`,
        }}
      >
        {text}
        <span className="sr-only">
          {` (found: ${kindLabel(f.kind)}, ${LAYER_LABEL[f.layer]} layer${f.encoding !== "plain" ? `, ${ENCODING_LABEL[f.encoding]}` : ""}. ${f.explanation})`}
        </span>
      </mark>
      <FloatingCard open={open} pos={pos} width={width}>
        <FindingDetail finding={f} />
      </FloatingCard>
    </>
  );
}

export function FindingDetail({ finding: f }: { finding: Finding }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <KindChip kind={f.kind} tone={severityTone(f.severity)} />
        <LayerChip layer={f.layer} />
        {f.encoding !== "plain" && (
          <span className="inline-flex h-6 items-center rounded-full bg-info-soft px-2.5 text-caption font-medium text-info">{ENCODING_LABEL[f.encoding]}</span>
        )}
      </div>
      <p className="mt-2.5 text-support leading-snug text-ink">{f.explanation}</p>
      <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-caption">
        <dt className="text-ink-3">Value</dt><dd className="min-w-0 break-all font-mono text-[11.5px] text-ink">{f.preview}</dd>
        {f.source_ref && <><dt className="text-ink-3">Source</dt><dd className="min-w-0 break-all font-mono text-[11.5px] text-ink">{f.source_ref}</dd></>}
        <dt className="text-ink-3">Field</dt><dd className="min-w-0 break-all font-mono text-[11.5px] text-ink-2">{f.field}</dd>
        <dt className="text-ink-3">Severity</dt><dd className="text-ink-2">{SEVERITY_LABEL[f.severity]}</dd>
      </dl>
    </div>
  );
}

function FindingPill({ finding: f }: { finding: Finding }) {
  const { open, pos, width, triggerProps } = useHoverCard<HTMLButtonElement>(310);
  const tone = severityTone(f.severity);
  return (
    <>
      <button
        type="button"
        {...triggerProps}
        className={cx(
          "press inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-caption font-medium",
          tone === "crit" ? "border-crit/30 bg-crit-soft text-crit" : "border-warn/30 bg-warn-soft text-warn",
        )}
      >
        {kindLabel(f.kind)}
        <span className="font-mono text-[11px] text-ink-2">{f.preview}</span>
        <span className="sr-only">{`. ${LAYER_LABEL[f.layer]} layer. ${f.explanation}`}</span>
      </button>
      <FloatingCard open={open} pos={pos} width={width}><FindingDetail finding={f} /></FloatingCard>
    </>
  );
}

function Sent({ decision: d }: { decision: Decision }) {
  const left = (d.sent !== null && d.sent !== undefined) || !!d.sent_url;
  if (!left) {
    if (d.mode === "monitor" && d.action !== "allow") {
      return <p className="text-support text-ink-2">The original request went out (monitor mode). It isn't shown here.</p>;
    }
    return (
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-good-soft text-good" aria-hidden>
          <ShieldCheck size={15} />
        </span>
        <div>
          <p className="font-display text-[15px] font-semibold text-ink">Nothing left the machine</p>
          <p className="mt-0.5 text-support text-ink-3">The agent got an error instead of a response. The attempt is in the ledger as keyed hashes only.</p>
        </div>
      </div>
    );
  }
  // http/extract: the URL that left is the meaningful part (the payload is often just {params: {}}).
  const rows = flatten(d.sent ?? {}).filter(([, v]) => v !== "{}" && v !== "[]");
  if (d.sent_url && !rows.some(([k]) => k === "url")) rows.unshift(["url", d.sent_url]);
  const order = ["url", ...Object.keys(d.attempted ?? {})];
  const major = majorFields(d);
  const isMajor = ([k, v]: [string, unknown]) =>
    typeof v === "string" && (major.has(k) || PRIMARY_FIELDS.test(k) || v.length > SHORT);
  const text = rows.filter(isMajor).sort((a, b) => rank(order, a[0]) - rank(order, b[0]));
  const minor = rows.filter((r) => !isMajor(r)).map(([k, v]) => [k, valueText(v)] as [string, string]);
  return (
    <div className="space-y-2.5">
      {text.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <FieldLabel>{k}</FieldLabel>
          <p className="break-words text-[13.5px] leading-[1.75] text-ink [overflow-wrap:anywhere]">{valueText(v)}</p>
        </div>
      ))}
      <MinorLine items={minor} />
      {rows.length === 0 && <p className="text-support text-ink-3">An empty request.</p>}
    </div>
  );
}

const rank = (order: string[], k: string) => { const i = order.indexOf(k); return i < 0 ? 999 : i; };

// ---------------------------------------------------------------- details

/** layer_ms keys as the engine reports them (the scan runs patterns and fingerprints in one pass). */
const TIMING_ORDER = ["destination", "taint", "scan", "pattern", "fingerprint", "split", "context", "rewrite"];
const TIMING_LABEL: Record<string, string> = {
  scan: "Scan (patterns + fingerprints)",
  split: "Split buffer",
  rewrite: "Rewrite (local model)",
};
const TIMING_HINT: Record<string, string> = {
  scan: "Pattern and keyed-fingerprint matching, on the text and its decoded variants",
  split: "Checks whether this piece completes a value sent in parts earlier",
  rewrite: "The local model rewrites the query without the private details; the result is re-scanned",
};

function Details({ decision: d }: { decision: Decision }) {
  const lm = d.layer_ms ?? {};
  const keys = [...TIMING_ORDER.filter((k) => k in lm), ...Object.keys(lm).filter((k) => !TIMING_ORDER.includes(k))];
  const max = Math.max(...keys.map((k) => lm[k] ?? 0), 0.0001);
  return (
    <div className="mt-4 grid gap-5 @xl:grid-cols-2">
      <section>
        <h3 className="mb-2 text-micro font-semibold uppercase tracking-[0.07em] text-ink-3">Time per layer</h3>
        {keys.length === 0 ? (
          <p className="text-support text-ink-3">No per-layer timing reported.</p>
        ) : (
          <ul className="space-y-1.5">
            {keys.map((k) => {
              const v = lm[k] ?? 0;
              const label = TIMING_LABEL[k] ?? LAYER_LABEL[k as keyof typeof LAYER_LABEL] ?? k;
              return (
                <li key={k} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-2.5 text-caption"
                  title={TIMING_HINT[k] ?? LAYER_HINT[k as keyof typeof LAYER_HINT] ?? undefined}>
                  <span className="truncate text-ink-2">{label}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                    <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(1.5, (v / max) * 100)}%` }} />
                  </span>
                  <span className="tnum w-16 text-right text-ink">{fmtMs(v)}</span>
                </li>
              );
            })}
            <li className="grid grid-cols-[minmax(0,11rem)_1fr_auto] gap-2.5 border-t border-line pt-1.5 text-caption">
              <span className="font-medium text-ink">Total</span><span /><span className="tnum w-16 text-right font-medium text-ink">{fmtMs(d.latency_ms)}</span>
            </li>
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-micro font-semibold uppercase tracking-[0.07em] text-ink-3">Session state at this call</h3>
        <ul className="space-y-1.5 text-caption text-ink-2">
          <li className="flex items-start gap-2">
            <Dot on={d.taint.private} /> <span>Private data read{d.taint.private_sources.length ? `: ${d.taint.private_sources.join(", ")}` : ""}</span>
          </li>
          <li className="flex items-start gap-2">
            <Dot on={d.taint.untrusted} />
            <span>Untrusted web content read{d.taint.untrusted_sources.length ? ` (${d.taint.untrusted_sources.length} page${d.taint.untrusted_sources.length === 1 ? "" : "s"})` : ""}</span>
          </li>
          <li className="flex items-center gap-2 font-medium text-ink">
            <Lock size={12} className={d.taint.lockdown ? "text-brand" : "text-ink-3"} /> {d.taint.lockdown ? "Lockdown was on" : "No lockdown"}
          </li>
        </ul>
        <div className="mt-3 font-mono text-[11px] text-ink-3 [overflow-wrap:anywhere]">request {d.request_id} · session {d.session_id}</div>
      </section>
      {d.findings.length > 0 && (
        <section className="@xl:col-span-2">
          <h3 className="mb-2 text-micro font-semibold uppercase tracking-[0.07em] text-ink-3">All findings, in layer order</h3>
          <ol className="space-y-2">
            {d.findings.map((f, i) => (
              <li key={i} className="rounded-control border border-line bg-surface-2 p-3"><FindingDetail finding={f} /></li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Dot({ on }: { on: boolean }) {
  return <span aria-hidden className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", on ? "bg-warn" : "border border-line-strong")} />;
}
