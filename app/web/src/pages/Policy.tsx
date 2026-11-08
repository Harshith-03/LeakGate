import { Ban, Check, Cpu, Database, EyeOff, KeyRound, Lock, PenLine, ShieldCheck, X } from "lucide-react";
import { api } from "../api/client";
import type { Policy, VaultSummary } from "../api/types";
import { useApi } from "../api/useApi";
import { ModeChip } from "../components/chips";
import { Chip, CopyButton, ErrorState, IconBadge, PageHeader, Panel, PanelTitle, Skeleton, Stat } from "../components/ui";
import { CHANNEL_LABEL, kindLabel } from "../lib/format";

export default function PolicyPage() {
  const policy = useApi(() => api.policy());
  const vault = useApi(() => api.vault());

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Policy & vault"
        subtitle="Where the agent may send data, what never leaves, and what LeakGate knows about your private data (which is never the data itself)."
      />
      <div className="space-y-6">
        {policy.error && !policy.data ? (
          <ErrorState error={policy.error} onRetry={policy.reload} />
        ) : !policy.data ? (
          <Skeleton className="h-64 rounded-card" />
        ) : (
          <PolicyView p={policy.data} />
        )}
        {vault.error && !vault.data ? (
          <ErrorState error={vault.error} onRetry={vault.reload} />
        ) : !vault.data ? (
          <Skeleton className="h-48 rounded-card" />
        ) : (
          <VaultView v={vault.data} />
        )}
      </div>
    </>
  );
}

function PolicyView({ p }: { p: Policy }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Policy" icon={<ShieldCheck size={17} />} tone="brand"
          value={<span className="block break-words font-mono text-[15px] font-medium leading-snug tracking-normal [overflow-wrap:anywhere]" title={p.name}>{p.name.split("-").map((w, i, a) => <span key={i}>{w}{i < a.length - 1 ? "-" : ""}<wbr /></span>)}</span>}>
          <div className="mt-3"><ModeChip mode={p.mode} /></div>
          <p className="mt-2 text-caption text-ink-3">
            {p.mode === "enforce"
              ? "Decisions are enforced: rewrites and blocks apply."
              : "Monitor mode: every decision is logged, but the original request is sent."}
          </p>
        </Stat>
        <Stat label="Approved destinations" icon={<Check size={17} />} value={<span className="tnum">{p.destinations.length}</span>}
          sub="Everything else is blocked once private data is read" />
        <Stat label="Rewrite channels" icon={<PenLine size={17} />} value={<span className="tnum">{p.rewrite_channels.length}</span>}
          sub={p.rewrite_channels.map((c) => CHANNEL_LABEL[c] ?? c).join(", ") || "None"} />
        <Stat label="Context model" icon={<Cpu size={17} />} tone={p.use_context_model ? "good" : "neutral"}
          value={p.use_context_model ? "On" : "Off"}
          sub={p.use_context_model ? "Local model checks what rules can't see" : "Rules only (layers 1-4)"} />
      </div>

      <Panel padded={false}>
        <div className="px-[var(--pad-card)] pt-[var(--pad-card)]">
          <PanelTitle hint="The only hosts the agent may reach once it has read private data. In lockdown (private data + web content), hosts not allowed in lockdown are cut too.">Allowlisted destinations</PanelTitle>
        </div>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
            <caption className="sr-only">Allowlisted destinations</caption>
            <thead>
              <tr className="border-y border-line bg-surface-2 text-micro font-semibold uppercase tracking-[0.06em] text-ink-3">
                <th scope="col" className="py-2.5 pl-[var(--pad-card)] pr-3">Host</th>
                <th scope="col" className="px-3 py-2.5">Channels</th>
                <th scope="col" className="px-3 py-2.5">Purpose</th>
                <th scope="col" className="px-3 py-2.5 pr-[var(--pad-card)]">In lockdown</th>
              </tr>
            </thead>
            <tbody>
              {p.destinations.map((d) => (
                <tr key={d.host} className="border-b border-line align-top last:border-0">
                  <td className="py-3 pl-[var(--pad-card)] pr-3 font-mono text-[12.5px] font-medium text-ink">{d.host}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">{d.channels.map((c) => <Chip key={c} className="border-line bg-surface text-ink-2">{CHANNEL_LABEL[c] ?? c}</Chip>)}</div>
                  </td>
                  <td className="px-3 py-3 text-ink-2">{d.purpose}</td>
                  <td className="px-3 py-3 pr-[var(--pad-card)]">
                    {d.allow_in_lockdown
                      ? <span className="inline-flex items-center gap-1.5 font-medium text-good"><Check size={14} aria-hidden />Allowed</span>
                      : <span className="inline-flex items-center gap-1.5 font-medium text-ink-3"><X size={14} aria-hidden />Not in lockdown</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelTitle hint="Findings of these kinds are blocked outright, never rewritten.">Always blocked</PanelTitle>
          <div className="flex flex-wrap gap-1.5">
            {p.block_kinds.map((k) => (
              <Chip key={k} className="border-transparent bg-crit-soft text-crit" icon={<Ban size={12} />} title={k}>{kindLabel(k)}</Chip>
            ))}
          </div>
          <p className="mt-3 text-caption text-ink-3">Encoded or split attempts, and any host off the allowlist once private data has been read, are blocked too.</p>
        </Panel>
        <Panel>
          <PanelTitle hint="Fingerprinted when the policy loads. The API only ever shows them masked.">Confidential terms</PanelTitle>
          {p.confidential_terms.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {p.confidential_terms.map((t, i) => (
                <li key={i}><Chip className="border-line bg-surface-2 font-mono text-ink-2" icon={<EyeOff size={12} className="text-ink-3" />}>{t}</Chip></li>
              ))}
            </ul>
          ) : (
            <p className="text-support text-ink-3">No confidential terms configured.</p>
          )}
        </Panel>
      </div>
    </>
  );
}

function VaultView({ v }: { v: VaultSummary }) {
  return (
    <Panel>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start">
        <IconBadge tone="brand" size="lg"><Lock size={20} /></IconBadge>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[18px] font-semibold leading-tight text-ink">Vault</h2>
          <p className="mt-1 text-body text-ink-2">LeakGate stores keyed hashes of your private data, never the data.</p>
          <p className="mt-1 text-support text-ink-3">
            That is how it recognises a customer's SSN in base64 or a phone number spelled out, without keeping a copy to leak.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 self-start rounded-control border border-line bg-surface-2 py-1 pl-3 pr-1" title="First 8 hex characters of SHA-256 of the install key: identifies the key, reveals nothing">
          <KeyRound size={13} className="text-ink-3" aria-hidden />
          <span className="text-caption text-ink-3">Key ID</span>
          <code className="font-mono text-[12.5px] font-medium text-ink">{v.key_id}</code>
          <CopyButton text={v.key_id} label="Copy key ID" />
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MiniStat label="Fingerprints" value={v.fingerprints} />
        <MiniStat label="Sources" value={v.sources.length} />
        <MiniStat label="Confidential terms" value={v.confidential_terms} />
      </div>

      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
          <caption className="sr-only">Vault sources: field names and fingerprint counts, no values</caption>
          <thead>
            <tr className="border-b border-line text-micro font-semibold uppercase tracking-[0.06em] text-ink-3">
              <th scope="col" className="py-2 pr-3">Source</th>
              <th scope="col" className="px-3 py-2">Fields (names only)</th>
              <th scope="col" className="py-2 pl-3 text-right">Fingerprints</th>
            </tr>
          </thead>
          <tbody>
            {v.sources.map((s) => (
              <tr key={s.source} className="border-b border-line align-top last:border-0">
                <td className="py-3 pr-3">
                  <span className="inline-flex items-center gap-2 font-mono text-[12.5px] font-medium text-ink">
                    <Database size={13} className="text-ink-3" aria-hidden />{s.source}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(s.fields ?? []).map((f) => <span key={f} className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2">{f}</span>)}
                  </div>
                </td>
                <td className="tnum py-3 pl-3 text-right font-medium text-ink">{s.fingerprints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-panel bg-surface-2 px-4 py-3">
      <div className="text-caption font-medium text-ink-3">{label}</div>
      <div className="tnum mt-1 font-display text-[24px] font-semibold leading-none text-ink">{value.toLocaleString()}</div>
    </div>
  );
}
