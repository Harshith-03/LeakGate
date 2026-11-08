import { ChevronRight, Link2, Loader2, RefreshCw, ScrollText, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Action, LedgerRecord, LedgerStatus } from "../api/types";
import { useApi } from "../api/useApi";
import { ACTION_TONE } from "../components/chips";
import { Monitor } from "../components/crt";
import {
  Button, CopyButton, EmptyState, ErrorState, PageHeader, Segmented, Skeleton, cx,
} from "../components/ui";
import { ACTION_LABEL, fmtDateTime, flatten, kindLabel, shortHash, valueText } from "../lib/format";

type Filter = "all" | "allow" | "changed" | "block";

/** seq · time · action · tool → destination · kinds · attempted HMAC · prev hash */
const COLS = "lg:grid-cols-[1.25rem_3.25rem_10.5rem_6.5rem_minmax(0,1.3fr)_minmax(0,1fr)_8.5rem_8.5rem]";

export default function Ledger() {
  const ledger = useApi(() => api.ledger(200));
  const [params] = useSearchParams();
  const focusSeq = Number(params.get("seq") ?? NaN);
  const [filter, setFilter] = useState<Filter>("all");
  const [openSeq, setOpenSeq] = useState<number | null>(Number.isFinite(focusSeq) ? focusSeq : null);
  const [verify, setVerify] = useState<LedgerStatus | null>(null);
  const [verifyError, setVerifyError] = useState<ApiError | null>(null);
  const [verifying, setVerifying] = useState(false);

  const brokenAt = verify?.broken_at ?? null;
  const rows = useMemo(() => {
    const all = [...(ledger.data ?? [])].sort((a, b) => b.seq - a.seq);
    if (filter === "all") return all;
    if (filter === "changed") return all.filter((r) => r.action === "rewrite" || r.action === "redact");
    return all.filter((r) => r.action === filter);
  }, [ledger.data, filter]);

  const counts = useMemo(() => {
    const c: Record<Action, number> = { allow: 0, rewrite: 0, redact: 0, block: 0 };
    for (const r of ledger.data ?? []) c[r.action] = (c[r.action] ?? 0) + 1;
    return c;
  }, [ledger.data]);

  // Arriving from a decision card's "Ledger N" link: bring that row into view.
  useEffect(() => {
    if (!Number.isFinite(focusSeq) || !ledger.data) return;
    requestAnimationFrame(() => document.getElementById(`ledger-${focusSeq}`)?.scrollIntoView({ block: "center" }));
  }, [focusSeq, ledger.data]);

  const runVerify = async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      setVerify(await api.verifyLedger());
    } catch (e) {
      setVerifyError(e instanceof ApiError ? e : new ApiError("http", String(e)));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Proof"
        title="Egress ledger"
        subtitle="Every decision is appended to a hash chain: a keyed HMAC of what the agent tried to send, the clean payload that actually left, and the hash of the record before it. Edit any line and verification fails from that point on."
        actions={
          <>
            <Button variant="run" size="lg" onClick={runVerify} disabled={verifying} className="uppercase"
              icon={verifying ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}>
              {verifying ? "Verifying" : "Verify chain"}
            </Button>
            <Button size="lg" onClick={ledger.reload} icon={<RefreshCw size={15} />}>Refresh</Button>
          </>
        }
      />

      {(verify || verifyError) && (
        <div className="mb-7" role="status" aria-live="polite">
          {verifyError ? <ErrorState error={verifyError} onRetry={runVerify} /> : verify && <VerifyResult key={`${verify.records}-${verify.head}`} s={verify} />}
        </div>
      )}

      {ledger.error && !ledger.data ? (
        <ErrorState error={ledger.error} onRetry={ledger.reload} />
      ) : ledger.loading && !ledger.data ? (
        <Monitor title="Hash chain" led="off"><div className="space-y-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div></Monitor>
      ) : (ledger.data ?? []).length === 0 ? (
        <EmptyState title="The ledger is empty" icon={<ScrollText size={20} />}>
          Run the agent on the Console or inspect a request in the Inspector. Every decision lands here.
        </EmptyState>
      ) : (
        <Monitor
          title="Hash chain"
          plate="LG-06 · Append-only"
          led={brokenAt !== null ? "alarm" : verify?.ok ? "ok" : "brand"}
          padded={false}
          right={<span className="hidden font-mono text-[11px] text-chrome-3 sm:inline">newest first · up to 200</span>}
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-[var(--pad-card)] py-3">
            <Segmented<Filter>
              size="sm"
              label="Filter by action"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: <>All <span className="tnum font-mono opacity-75">{(ledger.data ?? []).length}</span></> },
                { value: "allow", label: <>Allowed <span className="tnum font-mono opacity-75">{counts.allow}</span></> },
                { value: "changed", label: <>Rewritten <span className="tnum font-mono opacity-75">{counts.rewrite + counts.redact}</span></> },
                { value: "block", label: <>Blocked <span className="tnum font-mono opacity-75">{counts.block}</span></> },
              ]}
            />
          </div>
          <div className={cx("hidden gap-x-3 border-b border-line px-[var(--pad-card)] py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3 lg:grid", COLS)} aria-hidden>
            <span /><span>Seq</span><span>Time</span><span>Action</span><span>Tool → destination</span><span>Kinds</span><span>Attempted HMAC</span><span>Prev hash</span>
          </div>
          <ol aria-label="Ledger records, newest first" className="font-mono text-[12.5px]">
            {rows.map((r) => (
              <Row key={r.seq} r={r} open={openSeq === r.seq} highlight={r.seq === focusSeq}
                broken={brokenAt !== null && r.seq >= brokenAt}
                onToggle={() => setOpenSeq((s) => (s === r.seq ? null : r.seq))} />
            ))}
          </ol>
          {rows.length === 0 && <p className="px-[var(--pad-card)] py-6 text-support text-ink-3">No records match this filter.</p>}
        </Monitor>
      )}
    </>
  );
}

function VerifyResult({ s }: { s: LedgerStatus }) {
  if (s.ok) {
    return (
      <Monitor title="Chain verified" led="ok" ledPulse tone="good" glow plate="SHA-256 · HMAC">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <ShieldCheck size={24} className="glow shrink-0 text-good" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="glow font-display text-[16px] font-semibold text-good">Chain intact: {s.records} record{s.records === 1 ? "" : "s"} verified</div>
            <div className="mt-0.5 text-support text-ink-2">Every record links to the one before it, and nothing has been edited, removed or reordered.</div>
          </div>
          {s.head && (
            <div className="field flex min-w-0 items-center gap-1 py-1 pl-3 pr-1">
              <span className="text-caption text-ink-3">Head</span>
              <code className="truncate font-mono text-[12px] text-ink" title={s.head}>{shortHash(s.head, 16)}</code>
              <CopyButton text={s.head} label="Copy head hash" />
            </div>
          )}
        </div>
      </Monitor>
    );
  }
  return (
    <Monitor title="Chain broken" led="alarm" ledBlink tone="crit" glow className="crt-alarm">
      <div className="flex items-start gap-3">
        <ShieldAlert size={24} className="glow mt-0.5 shrink-0 text-crit" aria-hidden />
        <div className="min-w-0">
          <div className="glow font-display text-[16px] font-semibold text-crit">
            Chain broken{s.broken_at !== null ? ` at record ${s.broken_at}` : ""}
          </div>
          <div className="mt-0.5 text-support text-ink-2">
            {s.broken_at !== null
              ? `Record ${s.broken_at} doesn't match the hash the next link expects: it, or something before it, was edited, removed or reordered. Records from ${s.broken_at} on can't be trusted.`
              : "Verification failed."} {s.records} record{s.records === 1 ? "" : "s"} checked.
          </div>
        </div>
      </div>
    </Monitor>
  );
}

function Row({ r, open, highlight, broken, onToggle }: {
  r: LedgerRecord; open: boolean; highlight: boolean; broken: boolean; onToggle: () => void;
}) {
  const id = `ledger-detail-${r.seq}`;
  const tone = ACTION_TONE[r.action];
  return (
    <li id={`ledger-${r.seq}`} className={cx("scroll-mt-28 border-b border-line last:border-0", highlight ? "bg-brand-tint" : broken && "bg-crit-soft/70")}>
      <div className={cx("grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-[var(--pad-card)] py-2.5 transition-colors hover:bg-white/[0.025]", COLS)}>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} aria-label={`${open ? "Hide" : "Show"} record ${r.seq} payload`}
          className="press -ml-1 mt-px inline-flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-white/[0.07] hover:text-ink">
          <ChevronRight size={14} className={cx("transition-transform motion-reduce:transition-none", open && "rotate-90")} />
        </button>
        {/* phones: seq + time on one line, action on the right */}
        <span className="tnum text-ink lg:pt-0.5">
          <span className="text-ink-3">#</span>{String(r.seq).padStart(4, "0")}
          <span className="ml-2 text-[11.5px] text-ink-3 lg:hidden">{fmtDateTime(r.ts)}</span>
        </span>
        <span className="tnum hidden pt-0.5 text-[11.5px] text-ink-2 lg:block">{fmtDateTime(r.ts)}</span>
        <span className={cx("glow-soft pt-0.5 text-[11px] font-bold uppercase tracking-[0.08em] max-lg:col-start-3 max-lg:row-start-1", tone.text)}>
          {ACTION_LABEL[r.action]}
        </span>
        <span className="min-w-0 max-lg:col-span-2 max-lg:col-start-2">
          <span className="text-ink-3">{r.tool} → </span>
          <span className={cx("break-all font-semibold", r.action === "block" ? "text-crit" : "text-ink")}>{r.destination}</span>
        </span>
        <span className="flex min-w-0 flex-wrap gap-1 max-lg:col-span-2 max-lg:col-start-2">
          {r.kinds.length ? r.kinds.map((k) => (
            <span key={k} className="rounded-[4px] bg-surface-3 px-1.5 py-px font-sans text-micro font-medium text-ink-2 ring-1 ring-inset ring-line-strong">{kindLabel(k)}</span>
          )) : <span className="text-ink-3 max-lg:hidden">–</span>}
        </span>
        <span className="hidden lg:block"><HashCell value={r.attempted_hmac} label="attempted HMAC" /></span>
        <span className="hidden lg:block"><HashCell value={r.prev_hash} label="previous hash" /></span>
      </div>
      <div id={id} hidden={!open} className="border-t border-line bg-black/25 px-[var(--pad-card)] pb-4 pt-3 lg:pl-[calc(var(--pad-card)+2rem)]">
        {open && <RecordDetail r={r} />}
      </div>
    </li>
  );
}

function HashCell({ value, label }: { value: string | null; label: string }) {
  if (!value) return <span className="text-ink-3">–</span>;
  return (
    <span className="-mt-1 inline-flex items-center gap-0.5">
      <code className="text-[11.5px] text-ink-2" title={value}>{shortHash(value, 10)}</code>
      <CopyButton text={value} label={`Copy ${label}`} />
    </span>
  );
}

function RecordDetail({ r }: { r: LedgerRecord }) {
  const rows = (r.sent ? flatten(r.sent) : []).filter(([, v]) => v !== "{}" && v !== "[]");
  if (r.sent_url && !rows.some(([k]) => k === "url")) rows.unshift(["url", r.sent_url]);
  return (
    <div className="grid gap-4 font-sans md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        <div className="eyebrow mb-1.5 text-ink-3">What actually left</div>
        {rows.length > 0 ? (
          <dl className="well space-y-1.5 p-3">
            {rows.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="font-mono text-[11px] text-ink-3">{k}</dt>
                <dd className="break-words font-mono text-[12.5px] text-ink [overflow-wrap:anywhere]">{valueText(v)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="well flex items-center gap-2 p-3 text-support text-ink-2">
            <ShieldCheck size={15} className="shrink-0 text-good" aria-hidden />
            {r.sent === null && !r.sent_url
              ? "Nothing left the machine. Only the HMAC of the attempt is stored."
              : "An empty payload left (no fields)."}
          </p>
        )}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] content-start gap-x-3 gap-y-1.5 text-caption">
        <dt className="text-ink-3">Sent SHA-256</dt>
        <dd className="flex min-w-0 items-center gap-0.5">
          {r.sent_sha256 ? <><code className="truncate font-mono text-[11.5px] text-ink-2" title={r.sent_sha256}>{shortHash(r.sent_sha256, 16)}</code><CopyButton text={r.sent_sha256} label="Copy sent SHA-256" /></> : <span className="text-ink-3">–</span>}
        </dd>
        <dt className="text-ink-3">Attempted HMAC</dt>
        <dd className="flex min-w-0 items-start gap-0.5"><span className="min-w-0 break-all font-mono text-[11.5px] text-ink-2">{r.attempted_hmac}</span><CopyButton text={r.attempted_hmac} label="Copy attempted HMAC" /></dd>
        <dt className="text-ink-3">Prev hash</dt>
        <dd className="flex min-w-0 items-start gap-0.5"><span className="min-w-0 break-all font-mono text-[11.5px] text-ink-2">{r.prev_hash || "–"}</span>{r.prev_hash && <CopyButton text={r.prev_hash} label="Copy previous hash" />}</dd>
        <dt className="text-ink-3">Findings</dt><dd className="tnum text-ink-2">{r.findings}</dd>
        <dt className="text-ink-3">Channel</dt><dd className="text-ink-2">{r.channel}</dd>
        <dt className="text-ink-3">Session</dt><dd className="min-w-0 break-all font-mono text-[11.5px] text-ink-2">{r.session_id}</dd>
        <dt className="text-ink-3">Request</dt><dd className="min-w-0 break-all font-mono text-[11.5px] text-ink-2">{r.request_id}</dd>
      </dl>
    </div>
  );
}
