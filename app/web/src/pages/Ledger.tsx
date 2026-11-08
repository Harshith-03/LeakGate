import { ChevronDown, Link2, Loader2, RefreshCw, ScrollText, ShieldAlert, ShieldCheck } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Action, LedgerRecord, LedgerStatus } from "../api/types";
import { useApi } from "../api/useApi";
import { ActionChip } from "../components/chips";
import {
  Button, CopyButton, EmptyState, ErrorState, PageHeader, Panel, Segmented, Skeleton, cx,
} from "../components/ui";
import { fmtDateTime, flatten, kindLabel, shortHash, valueText } from "../lib/format";

type Filter = "all" | "allow" | "changed" | "block";

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
            <Button variant="primary" onClick={runVerify} disabled={verifying}
              icon={verifying ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />}>
              {verifying ? "Verifying…" : "Verify chain"}
            </Button>
            <Button onClick={ledger.reload} icon={<RefreshCw size={14} />}>Refresh</Button>
          </>
        }
      />

      {(verify || verifyError) && (
        <div className="mb-6" role="status" aria-live="polite">
          {verifyError ? <ErrorState error={verifyError} onRetry={runVerify} /> : verify && <VerifyResult s={verify} />}
        </div>
      )}

      {ledger.error && !ledger.data ? (
        <ErrorState error={ledger.error} onRetry={ledger.reload} />
      ) : ledger.loading && !ledger.data ? (
        <Panel padded={false} className="p-4"><div className="space-y-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div></Panel>
      ) : (ledger.data ?? []).length === 0 ? (
        <EmptyState title="The ledger is empty" icon={<ScrollText size={20} />}>
          Run a scenario on the Live page or inspect a request in the Playground. Every decision lands here.
        </EmptyState>
      ) : (
        <Panel padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-[var(--pad-card)] py-3">
            <Segmented<Filter>
              size="sm"
              label="Filter by action"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: <>All <span className="tnum text-ink-3">{(ledger.data ?? []).length}</span></> },
                { value: "allow", label: <>Allowed <span className="tnum text-ink-3">{counts.allow}</span></> },
                { value: "changed", label: <>Rewritten <span className="tnum text-ink-3">{counts.rewrite + counts.redact}</span></> },
                { value: "block", label: <>Blocked <span className="tnum text-ink-3">{counts.block}</span></> },
              ]}
            />
            <span className="text-caption text-ink-3">Newest first · up to 200 records</span>
          </div>
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left text-[13px]">
              <caption className="sr-only">Egress ledger records, newest first</caption>
              <thead>
                <tr className="border-b border-line bg-surface-2 text-micro font-semibold uppercase tracking-[0.06em] text-ink-3">
                  <th scope="col" className="w-8 py-2.5 pl-4" aria-label="Expand" />
                  <th scope="col" className="px-3 py-2.5">Seq</th>
                  <th scope="col" className="px-3 py-2.5">Time</th>
                  <th scope="col" className="px-3 py-2.5">Tool → destination</th>
                  <th scope="col" className="px-3 py-2.5">Action</th>
                  <th scope="col" className="px-3 py-2.5">Kinds</th>
                  <th scope="col" className="px-3 py-2.5">Attempted HMAC</th>
                  <th scope="col" className="px-3 py-2.5 pr-4">Prev hash</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.seq} r={r} open={openSeq === r.seq} highlight={r.seq === focusSeq}
                    broken={brokenAt !== null && r.seq >= brokenAt}
                    onToggle={() => setOpenSeq((s) => (s === r.seq ? null : r.seq))} />
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p className="px-[var(--pad-card)] py-6 text-support text-ink-3">No records match this filter.</p>}
          </div>
        </Panel>
      )}
    </>
  );
}

function VerifyResult({ s }: { s: LedgerStatus }) {
  if (s.ok) {
    return (
      <div className="flex flex-col gap-3 rounded-card border border-good/30 bg-good-soft px-5 py-4 sm:flex-row sm:items-center">
        <ShieldCheck size={22} className="shrink-0 text-good" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[16px] font-semibold text-ink">Chain intact: {s.records} record{s.records === 1 ? "" : "s"} verified</div>
          <div className="mt-0.5 text-support text-ink-2">Every record links to the one before it, and nothing has been edited, removed or reordered.</div>
        </div>
        {s.head && (
          <div className="flex min-w-0 items-center gap-1 rounded-control border border-line bg-surface py-1 pl-3 pr-1">
            <span className="text-caption text-ink-3">Head</span>
            <code className="truncate font-mono text-[12px] text-ink" title={s.head}>{shortHash(s.head, 16)}</code>
            <CopyButton text={s.head} label="Copy head hash" />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-card border border-crit/35 bg-crit-soft px-5 py-4">
      <ShieldAlert size={22} className="mt-0.5 shrink-0 text-crit" aria-hidden />
      <div className="min-w-0">
        <div className="font-display text-[16px] font-semibold text-ink">
          Chain broken{s.broken_at !== null ? ` at record ${s.broken_at}` : ""}
        </div>
        <div className="mt-0.5 text-support text-ink-2">
          {s.broken_at !== null
            ? `Record ${s.broken_at} doesn't match the hash the next link expects: it, or something before it, was edited, removed or reordered. Records from ${s.broken_at} on can't be trusted.`
            : "Verification failed."} {s.records} record{s.records === 1 ? "" : "s"} checked.
        </div>
      </div>
    </div>
  );
}

function Row({ r, open, highlight, broken, onToggle }: {
  r: LedgerRecord; open: boolean; highlight: boolean; broken: boolean; onToggle: () => void;
}) {
  const id = `ledger-detail-${r.seq}`;
  return (
    <Fragment>
      <tr
        id={`ledger-${r.seq}`}
        className={cx(
          "border-b border-line align-top transition-colors",
          highlight ? "bg-brand-tint" : broken ? "bg-crit-soft/60" : "hover:bg-surface-2",
        )}
      >
        <td className="py-2.5 pl-4">
          <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} aria-label={`${open ? "Hide" : "Show"} record ${r.seq} payload`}
            className="press inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink">
            <ChevronDown size={15} className={cx("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
          </button>
        </td>
        <td className="tnum px-3 py-2.5 pt-3.5 font-medium text-ink">{r.seq}</td>
        <td className="tnum whitespace-nowrap px-3 py-2.5 pt-3.5 text-ink-2">{fmtDateTime(r.ts)}</td>
        <td className="px-3 py-2.5 pt-3">
          <div className="font-mono text-[12px] text-ink-2">{r.tool}</div>
          <div className={cx("break-all font-medium", r.action === "block" ? "text-crit" : "text-ink")}>{r.destination}</div>
        </td>
        <td className="px-3 py-2.5 pt-3"><ActionChip action={r.action} /></td>
        <td className="px-3 py-2.5 pt-3">
          {r.kinds.length ? (
            <div className="flex max-w-[16rem] flex-wrap gap-1">
              {r.kinds.map((k) => <span key={k} className="rounded-md bg-surface-3 px-1.5 py-0.5 text-micro font-medium text-ink-2">{kindLabel(k)}</span>)}
            </div>
          ) : <span className="text-ink-3">–</span>}
        </td>
        <td className="px-3 py-2.5 pt-3"><HashCell value={r.attempted_hmac} label="attempted HMAC" /></td>
        <td className="px-3 py-2.5 pr-4 pt-3"><HashCell value={r.prev_hash} label="previous hash" /></td>
      </tr>
      <tr id={id} hidden={!open} className="border-b border-line bg-surface-2">
        <td />
        <td colSpan={7} className="px-3 pb-4 pr-4 pt-2">
          {open && <RecordDetail r={r} />}
        </td>
      </tr>
    </Fragment>
  );
}

function HashCell({ value, label }: { value: string | null; label: string }) {
  if (!value) return <span className="text-ink-3">–</span>;
  return (
    <span className="inline-flex items-center gap-0.5">
      <code className="font-mono text-[11.5px] text-ink-2" title={value}>{shortHash(value, 10)}</code>
      <CopyButton text={value} label={`Copy ${label}`} />
    </span>
  );
}

function RecordDetail({ r }: { r: LedgerRecord }) {
  const rows = (r.sent ? flatten(r.sent) : []).filter(([, v]) => v !== "{}" && v !== "[]");
  if (r.sent_url && !rows.some(([k]) => k === "url")) rows.unshift(["url", r.sent_url]);
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        <div className="mb-1.5 text-micro font-semibold uppercase tracking-[0.07em] text-ink-3">What actually left</div>
        {rows.length > 0 ? (
          <dl className="space-y-1.5 rounded-control border border-line bg-surface p-3">
            {rows.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="font-mono text-[11px] text-ink-3">{k}</dt>
                <dd className="break-words text-[13px] text-ink [overflow-wrap:anywhere]">{valueText(v)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="flex items-center gap-2 rounded-control border border-line bg-surface p-3 text-support text-ink-2">
            <ShieldCheck size={15} className="text-good" aria-hidden />
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
        <dd className="min-w-0 break-all font-mono text-[11.5px] text-ink-2">{r.attempted_hmac}</dd>
        <dt className="text-ink-3">Prev hash</dt>
        <dd className="min-w-0 break-all font-mono text-[11.5px] text-ink-2">{r.prev_hash || "–"}</dd>
        <dt className="text-ink-3">Findings</dt><dd className="tnum text-ink-2">{r.findings}</dd>
        <dt className="text-ink-3">Channel</dt><dd className="text-ink-2">{r.channel}</dd>
        <dt className="text-ink-3">Session</dt><dd className="min-w-0 break-all font-mono text-[11.5px] text-ink-2">{r.session_id}</dd>
        <dt className="text-ink-3">Request</dt><dd className="min-w-0 break-all font-mono text-[11.5px] text-ink-2">{r.request_id}</dd>
      </dl>
    </div>
  );
}
