import { BarChart3, Gauge, Info, ShieldCheck, Sparkles, Table2, Timer } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, useDataSource } from "../api/client";
import type { BenchReport, BenchSystem } from "../api/types";
import { useApi } from "../api/useApi";
import {
  Chip, CopyButton, EmptyState, ErrorState, Note, PageHeader, Panel, PanelTitle, Segmented, Skeleton, Stat, cx,
} from "../components/ui";
import { fmtDateTime, fmtMs, fmtPct } from "../lib/format";
import { useThemeColors } from "../lib/useThemeColors";

const BENCH_CMD = "python -m bench.run";

/** Fixed series order = the order the palette was validated in (adjacent pairs pass CVD checks). */
const SYSTEM_ORDER = ["regex_dlp", "presidio", "leakgate_rules", "leakgate_full"];
const SERIES_TOKEN: Record<string, string> = {
  regex_dlp: "series-regex", presidio: "series-presidio", leakgate_rules: "series-rules", leakgate_full: "series-full",
};
const TOKENS = ["series-regex", "series-presidio", "series-rules", "series-full", "grid", "axis", "ink", "ink-2", "ink-3", "surface", "line"] as const;

const BENIGN = new Set(["benign_public", "benign_tricky"]);
const isBenign = (cat: string) => BENIGN.has(cat) || cat.startsWith("benign");

export default function Benchmark() {
  const bench = useApi(() => api.bench());
  const source = useDataSource();

  return (
    <>
      <PageHeader
        eyebrow="Proof"
        title="Benchmark"
        subtitle="How often each system keeps private data from leaving, how often it gets in the way of normal research, and what it costs in time. Same cases, same scoring, for every system."
      />
      {bench.error && !bench.data ? (
        <ErrorState error={bench.error} onRetry={bench.reload} />
      ) : bench.loading && !bench.data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-card" />)}</div>
      ) : !bench.data || !bench.data.available ? (
        <EmptyState title="No benchmark results yet" icon={<BarChart3 size={20} />}>
          Run the benchmark from the repo root; the results land in <code className="font-mono">outputs/bench.json</code> and show up here.
          <div className="mx-auto mt-4 flex max-w-xs items-center gap-2 rounded-control border border-line bg-surface py-1.5 pl-3 pr-1.5 text-left">
            <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink-2">{BENCH_CMD}</code>
            <CopyButton text={BENCH_CMD} label="Copy command" />
          </div>
        </EmptyState>
      ) : (
        <Report report={bench.data} demo={source === "demo"} />
      )}
    </>
  );
}

function Report({ report, demo }: { report: BenchReport; demo: boolean }) {
  const colors = useThemeColors(TOKENS);
  const systems = useMemo(
    () => [...report.systems].sort((a, b) => rank(a.name) - rank(b.name)),
    [report.systems],
  );
  const lg = systems.find((s) => s.name === "leakgate_full") ?? systems.find((s) => s.name === "leakgate_rules")
    ?? systems.find((s) => s.name.startsWith("leakgate"));
  const rx = systems.find((s) => s.name === "regex_dlp");
  const colorOf = (name: string) => (SERIES_TOKEN[name] ? colors[SERIES_TOKEN[name] as (typeof TOKENS)[number]] : colors["ink-3"]);

  const cats = useMemo(() => {
    const keys = new Set<string>(Object.keys(report.categories ?? {}));
    systems.forEach((s) => Object.keys(s.per_category ?? {}).forEach((k) => keys.add(k)));
    return [...keys];
  }, [report.categories, systems]);
  const label = (k: string) => report.categories?.[k] ?? k.replace(/_/g, " ");

  return (
    <div className="space-y-6">
      {demo && (
        <Note tone="info" icon={<Info size={15} />}>
          <strong className="font-semibold">Illustrative numbers from the demo fixtures</strong>, not a benchmark run. Start the API and run{" "}
          <code className="font-mono">{BENCH_CMD}</code> for real results.
        </Note>
      )}

      {/* ---- headline */}
      {lg && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <RateTile label="Catch rate" icon={<ShieldCheck size={17} />} tone="brand" lg={lg} rx={rx} pick={(s) => s.catch_rate}
            sub="Leak cases where the private value did not leave" colorOf={colorOf} digits={1} />
          <RateTile label="False alarm rate" icon={<Gauge size={17} />} tone="neutral" lg={lg} rx={rx} pick={(s) => s.false_alarm_rate}
            sub="Benign cases blocked or altered (lower is better)" colorOf={colorOf} digits={1} />
          <RateTile label="Utility" icon={<Sparkles size={17} />} tone="neutral" lg={lg} rx={rx} pick={(s) => s.utility}
            sub="Research terms that survived into what was sent" colorOf={colorOf} digits={1} />
          <Stat
            label="Latency (p50)"
            icon={<Timer size={17} />}
            value={<span className="tnum">{fmtMs(lg.p50_ms)}</span>}
            sub={<>p95 {fmtMs(lg.p95_ms)}{rx && <> · {rx.label}: p50 {fmtMs(rx.p50_ms)}</>}</>}
          >
            <p className="mt-2 text-caption text-ink-3">{lg.label}. The p95 includes local-model rewrites.</p>
          </Stat>
        </div>
      )}

      <Legend systems={systems} colorOf={colorOf} report={report} />
      <RunNotes systems={systems} />

      <CategoryPanel
        title="Leak cases: share caught"
        hint="A case counts as caught when the private value did not leave in any encoding: blocked, or rewritten and the sent payload no longer contains it."
        cats={cats.filter((c) => !isBenign(c))}
        counts={report.category_counts}
        systems={systems}
        label={label}
        colorOf={colorOf}
        colors={colors}
        measure="caught"
      />
      <CategoryPanel
        title="Benign cases: share left alone"
        hint="Nothing private was present, so the right answer is to let the request through unchanged."
        cats={cats.filter(isBenign)}
        counts={report.category_counts}
        systems={systems}
        label={label}
        colorOf={colorOf}
        colors={colors}
        measure="left alone"
      />

      <Examples report={report} systems={systems} label={label} />

      <Panel tone="muted">
        <PanelTitle>How the numbers are scored</PanelTitle>
        <ul className="space-y-1.5 text-support text-ink-2">
          <li><strong className="font-semibold text-ink">Catch rate</strong> (leak cases): the private value did not leave. Blocked, or rewritten/redacted and the sent payload no longer contains it, checked against each case's ground-truth secrets in all encodings.</li>
          <li><strong className="font-semibold text-ink">False alarm rate</strong> (benign cases): blocked or altered when nothing private was present.</li>
          <li><strong className="font-semibold text-ink">Utility</strong> (cases with research terms to keep that weren't blocked): the share of those terms that survived into what was sent. A blocked benign case scores 0.</li>
          <li><strong className="font-semibold text-ink">Systems</strong>: Regex DLP is patterns only (what most DLP does); LeakGate rules is layers 1-4; LeakGate full adds the local model (context layer and rewrites).</li>
        </ul>
      </Panel>
    </div>
  );
}

const rank = (name: string) => { const i = SYSTEM_ORDER.indexOf(name); return i < 0 ? 99 : i; };

// ---------------------------------------------------------------- tiles

function RateTile({ label, icon, tone, lg, rx, pick, sub, colorOf, digits = 0 }: {
  label: string; icon: ReactNode; tone: "brand" | "neutral"; lg: BenchSystem; rx?: BenchSystem;
  pick: (s: BenchSystem) => number | null; sub: string; colorOf: (n: string) => string; digits?: number;
}) {
  const rows = [lg, rx].filter((s): s is BenchSystem => !!s);
  return (
    <Stat label={label} icon={icon} tone={tone} value={<span className="tnum">{fmtPct(pick(lg), digits)}</span>}>
      <div className="mt-3 space-y-1.5" aria-label={`${label}: ${rows.map((s) => `${s.label} ${fmtPct(pick(s), digits)}`).join(", ")}`}>
        {rows.map((s) => {
          const v = pick(s);
          return (
            <div key={s.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 text-caption" aria-hidden>
              <span className="truncate text-ink-2">{s.label}</span>
              <span className="tnum text-right font-medium text-ink">{fmtPct(v, digits)}</span>
              <span className={cx("col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-3", v === null && "hatch")}>
                {v !== null && <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%`, background: colorOf(s.name) }} />}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2.5 text-caption text-ink-3">{sub}</p>
    </Stat>
  );
}

function Legend({ systems, colorOf, report }: { systems: BenchSystem[]; colorOf: (n: string) => string; report: BenchReport }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-caption font-medium text-ink-2" aria-label="Legend">
        {systems.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-2">
            <span aria-hidden className="h-3 w-3 rounded-[3px]" style={{ background: colorOf(s.name) }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="text-caption text-ink-3">
        <span className="tnum">{report.n_cases}</span> cases · run {fmtDateTime(report.run_at)} · model <span className="font-mono text-[11.5px]">{report.model}</span>
        {report.llm_cache && <> · model cache {report.llm_cache}</>}
      </div>
    </div>
  );
}

/** Errors, a missing local model or wall time: shown so the numbers are read in context. */
function RunNotes({ systems }: { systems: BenchSystem[] }) {
  const notes: string[] = [];
  for (const s of systems) {
    if (s.errors) notes.push(`${s.label}: ${s.errors} case${s.errors === 1 ? "" : "s"} errored (counted as not caught / not left alone).`);
    if (s.model_available === false) notes.push(`${s.label}: the local model was unavailable during this run, so its numbers are rules-only.`);
  }
  const walls = systems.filter((s) => typeof s.wall_s === "number");
  return (
    <>
      {notes.length > 0 && <Note tone="warn" icon={<Info size={15} />}>{notes.map((n) => <div key={n}>{n}</div>)}</Note>}
      {walls.length > 0 && (
        <p className="text-caption text-ink-3">
          Wall time: {walls.map((s) => `${s.label} ${s.wall_s} s`).join(" · ")}.
          {systems.some((s) => s.n_leak_cases !== undefined) && (
            <> Cases per system: {systems.filter((s) => s.n_leak_cases !== undefined).map((s) => `${s.n_leak_cases} leak + ${s.n_benign_cases ?? 0} benign`)[0]}.</>
          )}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- per-category chart

interface CatRow { key: string; label: string; n: number; [system: string]: number | string | null }

function CategoryPanel({ title, hint, cats, counts, systems, label, colorOf, colors, measure }: {
  title: string; hint: string; cats: string[]; counts?: Record<string, number>; systems: BenchSystem[]; label: (k: string) => string;
  colorOf: (n: string) => string; colors: Record<(typeof TOKENS)[number], string>; measure: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const rows: CatRow[] = cats.map((c) => {
    const n = counts?.[c] ?? Math.max(0, ...systems.map((s) => s.per_category?.[c]?.n ?? 0));
    const row: CatRow = { key: c, label: label(c), n };
    for (const s of systems) {
      const pc = s.per_category?.[c];
      row[s.name] = pc && pc.n > 0 ? (pc.correct / pc.n) * 100 : null;
    }
    return row;
  });
  if (rows.length === 0) return null;
  const bar = 10;
  const height = rows.length * (systems.length * (bar + 3) + 22) + 44;

  return (
    <Panel>
      <PanelTitle
        hint={hint}
        right={
          <Segmented<"chart" | "table">
            size="sm"
            label={`${title}: view`}
            value={view}
            onChange={setView}
            options={[
              { value: "chart", label: <><BarChart3 size={13} aria-hidden />Chart</> },
              { value: "table", label: <><Table2 size={13} aria-hidden />Table</> },
            ]}
          />
        }
      >
        {title}
      </PanelTitle>
      {view === "table" ? (
        <CategoryTable rows={rows} systems={systems} measure={measure} />
      ) : (
        <figure className="m-0">
          <figcaption className="sr-only">
            Horizontal grouped bar chart: share of cases {measure} per category (0 to 100 percent) for {systems.map((s) => s.label).join(", ")}.
            Use the Table button for the exact values.
          </figcaption>
          <div style={{ height }} role="img" aria-label={`${title}, per category`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 18, left: 4 }} barGap={3} barCategoryGap={11}>
                <CartesianGrid horizontal={false} stroke={colors.grid} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fontSize: 12, fill: colors["ink-3"] }}
                  tickLine={false}
                  axisLine={{ stroke: colors.axis }}
                  label={{ value: `Share of cases ${measure}`, position: "insideBottom", offset: -12, fontSize: 12, fill: colors["ink-3"] }}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={150}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tick={(p: TickProps) => <CatTick {...p} rows={rows} colors={colors} />}
                />
                <Tooltip
                  cursor={{ fill: colors.grid, opacity: 0.6 }}
                  content={(p: TipProps) => <CatTip {...p} systems={systems} colorOf={colorOf} rows={rows} measure={measure} />}
                />
                {systems.map((s) => (
                  <Bar key={s.name} dataKey={s.name} name={s.label} fill={colorOf(s.name)} barSize={bar} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
      )}
    </Panel>
  );
}

interface TickProps { x?: number | string; y?: number | string; payload?: { value?: string } }

/** Category label wrapped to two lines, with n underneath. */
function CatTick({ x = 0, y = 0, payload, rows, colors }: TickProps & { rows: CatRow[]; colors: Record<string, string> }) {
  const text = payload?.value ?? "";
  const row = rows.find((r) => r.label === text);
  const lines = wrap(text, 22).slice(0, 2);
  const lx = Number(x) - 8;
  const top = Number(y) - ((lines.length + 1) * 14) / 2 + 10;
  return (
    <g>
      {lines.map((l, i) => (
        <text key={i} x={lx} y={top + i * 14} textAnchor="end" fontSize={12} fill={colors["ink-2"]}>{l}</text>
      ))}
      <text x={lx} y={top + lines.length * 14} textAnchor="end" fontSize={11} fill={colors["ink-3"]}>n={row?.n ?? "?"}</text>
    </g>
  );
}

function wrap(s: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of s.split(" ")) {
    if ((line + " " + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  if (out.length > 2) out[1] = `${out[1]}…`;
  return out;
}

interface TipProps { active?: boolean; label?: string | number; payload?: readonly { dataKey?: unknown; value?: unknown }[] }

function CatTip({ active, label, payload, systems, colorOf, rows, measure }: TipProps & {
  systems: BenchSystem[]; colorOf: (n: string) => string; rows: CatRow[]; measure: string;
}) {
  if (!active || !payload?.length) return null;
  const row = rows.find((r) => r.label === label);
  return (
    <div className="rounded-control border border-line bg-surface px-3 py-2.5 text-caption shadow-lg">
      <div className="font-semibold text-ink">{label}</div>
      <div className="mb-1.5 text-ink-3">n={row?.n} · share {measure}</div>
      {systems.map((s) => {
        const pc = s.per_category?.[row?.key ?? ""];
        return (
          <div key={s.name} className="flex items-center gap-2 py-0.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colorOf(s.name) }} />
            <span className="flex-1 text-ink-2">{s.label}</span>
            <span className="tnum font-medium text-ink">{pc ? `${Math.round((pc.correct / pc.n) * 100)}%` : "–"}</span>
            <span className="tnum text-ink-3">{pc ? `${pc.correct}/${pc.n}` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

function CategoryTable({ rows, systems, measure }: { rows: CatRow[]; systems: BenchSystem[]; measure: string }) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
        <caption className="sr-only">Share of cases {measure} per category and system</caption>
        <thead>
          <tr className="border-b border-line text-micro font-semibold uppercase tracking-[0.06em] text-ink-3">
            <th scope="col" className="py-2 pr-3">Category</th>
            <th scope="col" className="px-3 py-2 text-right">n</th>
            {systems.map((s) => <th key={s.name} scope="col" className="px-3 py-2 text-right">{s.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line last:border-0">
              <th scope="row" className="py-2 pr-3 font-medium text-ink">{r.label}</th>
              <td className="tnum px-3 py-2 text-right text-ink-3">{r.n}</td>
              {systems.map((s) => {
                const pc = s.per_category?.[r.key];
                return (
                  <td key={s.name} className="tnum px-3 py-2 text-right text-ink">
                    {pc ? <>{Math.round((pc.correct / pc.n) * 100)}% <span className="text-ink-3">({pc.correct}/{pc.n})</span></> : "–"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- examples

type OutcomeTone = "good" | "crit" | "warn" | "neutral";

/**
 * Outcome meaning depends on the case. Leak cases: blocked / rewritten / redacted / cleaned are good,
 * leaked is a miss. Benign cases: allowed is good, altered or blocked is a false alarm.
 */
function outcomeTone(category: string, outcome: string): OutcomeTone {
  const o = outcome.toLowerCase();
  if (o === "error" || o === "n/a") return "neutral";
  if (isBenign(category)) {
    if (o === "allowed") return "good";
    if (["altered", "blocked", "rewritten", "redacted", "cleaned"].includes(o)) return "warn";
    return "neutral";
  }
  if (o === "leaked" || o === "allowed") return "crit";
  if (["blocked", "rewritten", "redacted", "cleaned"].includes(o)) return "good";
  return "neutral";
}

const OUTCOME_HINT: Record<string, string> = {
  cleaned: "Allowed, and the checker found no secret in what left",
  altered: "Changed although nothing private was present (a false alarm)",
  error: "The system failed on this case",
};

const TONE_CLASS: Record<OutcomeTone, string> = {
  good: "border-transparent bg-good-soft text-good",
  crit: "border-transparent bg-crit-soft text-crit",
  warn: "border-transparent bg-warn-soft text-warn",
  neutral: "border-transparent bg-surface-3 text-ink-2",
};

function Examples({ report, systems, label }: { report: BenchReport; systems: BenchSystem[]; label: (k: string) => string }) {
  if (!report.examples?.length) return null;
  return (
    <Panel padded={false}>
      <div className="px-[var(--pad-card)] pt-[var(--pad-card)]">
        <PanelTitle hint="A few cases from the run, with what each system did. Leaked is a miss; on benign cases, blocked or altered is a false alarm.">
          Example cases
        </PanelTitle>
      </div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
          <caption className="sr-only">Example benchmark cases and each system's outcome</caption>
          <thead>
            <tr className="border-y border-line bg-surface-2 text-micro font-semibold uppercase tracking-[0.06em] text-ink-3">
              <th scope="col" className="py-2.5 pl-[var(--pad-card)] pr-3">Case</th>
              <th scope="col" className="px-3 py-2.5">What it tests</th>
              {systems.map((s) => <th key={s.name} scope="col" className="px-3 py-2.5">{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {report.examples.map((ex) => (
              <tr key={ex.case_id} className="border-b border-line align-top last:border-0">
                <td className="py-2.5 pl-[var(--pad-card)] pr-3">
                  <div className="font-mono text-[12px] text-ink">{ex.case_id}</div>
                  <div className="text-caption text-ink-3">{label(ex.category)}</div>
                </td>
                <td className="px-3 py-2.5 text-ink-2">{ex.description}</td>
                {systems.map((s) => {
                  const o = ex.outcomes?.[s.name];
                  return (
                    <td key={s.name} className="px-3 py-2.5">
                      {o ? (
                        <Chip className={cx(TONE_CLASS[outcomeTone(ex.category, o)])} title={OUTCOME_HINT[o]}>
                          {isBenign(ex.category) && o !== "allowed" && outcomeTone(ex.category, o) === "warn" ? `${o} · false alarm` : o.replace(/_/g, " ")}
                        </Chip>
                      ) : <span className="text-ink-3">–</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
