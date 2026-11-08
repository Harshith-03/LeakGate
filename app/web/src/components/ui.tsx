/**
 * Design-system primitives. Every page composes these instead of hand-rolling card, button or input
 * styles. In the control-room language a card is a CRT monitor (see crt.tsx), a button is a physical
 * key, a segmented control is a rocker of latching keys, and an input is a recessed terminal field.
 */
import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronDown, Copy, Inbox, PlugZap, RefreshCw, Search, X } from "lucide-react";
import { Link, type LinkProps } from "react-router-dom";
import type { ApiError } from "../api/client";
import { cx } from "../lib/cx";
import { Led, Monitor, Screen, type LedState, type ScreenTone } from "./crt";

export { cx };

// ---------------------------------------------------------------- layout
/** Page title on the starfield: a mono eyebrow with an LED, a clean title, one calm line under it. */
export function PageHeader({ title, subtitle, actions, eyebrow, led = "brand" }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; led?: LedState;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="eyebrow mb-2.5 flex items-center gap-2 text-chrome-3">
            <Led state={led} size="sm" />
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-[26px] leading-[1.1] font-semibold tracking-[-0.02em] text-white sm:text-[32px]"
          style={{ textShadow: "0 2px 28px rgb(var(--accent-rgb) / 0.35)" }}>
          {title}
        </h1>
        {subtitle && <div className="mt-2.5 max-w-[72ch] text-body text-chrome-2">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5 md:shrink-0">{actions}</div>}
    </header>
  );
}

type Tone = "default" | "muted" | "sage" | "hero";
const PANEL_TONE: Record<Tone, ScreenTone> = { default: "idle", muted: "idle", sage: "good", hero: "brand" };

/** A plain monitor with no title strip: bezel + screen. Prefer `Monitor` when the section has a title. */
export function Panel({ children, className, padded = true, tone = "default", as: Tag = "section", ...rest }: {
  children: ReactNode; className?: string; padded?: boolean; tone?: Tone; as?: ElementType;
} & Omit<ComponentPropsWithoutRef<"section">, "className" | "children">) {
  return (
    <Tag className={cx("crt", className)} data-tone={PANEL_TONE[tone]} {...rest}>
      <Screen padded={padded}>{children}</Screen>
    </Tag>
  );
}
export const Card = Panel;

/** A title inside a screen (the bezel title of a Monitor is usually better). */
export function PanelTitle({ children, hint, right, id }: { children: ReactNode; hint?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-[16rem]">
        <h2 id={id} className="glow-soft font-display text-heading font-semibold text-ink">{children}</h2>
        {hint && <p className="mt-1 text-support text-ink-3">{hint}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/** A heading that sits between monitors, on the starfield. */
export function SectionTitle({ children, hint, right }: { children: ReactNode; hint?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="font-display text-[18px] leading-tight font-semibold tracking-[-0.01em] text-white">{children}</h2>
        {hint && <p className="mt-1 text-support text-chrome-2">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

/** A quiet in-flow link, always in the brand colour so it reads as interactive. */
export function TextLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cx("group inline-flex items-center gap-1 rounded-md text-support font-medium text-brand hover:text-brand-hover", className)}
    >
      {children}
      <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </Link>
  );
}

// ---------------------------------------------------------------- chips
export function Chip({ children, className, title, icon, wrap }: {
  children: ReactNode; className?: string; title?: string; icon?: ReactNode; wrap?: boolean;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex max-w-full items-center gap-1.5 border px-2 text-caption font-medium",
        wrap ? "min-h-6 rounded-chip py-1 leading-snug" : "h-6 shrink-0 whitespace-nowrap rounded-chip leading-none",
        className ?? "border-line-strong/70 bg-surface-3 text-ink-2",
      )}
    >
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      {wrap ? <span className="min-w-0 break-words">{children}</span> : children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <code className="rounded-md border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-ink-2">{children}</code>;
}

type IconTone = "neutral" | "brand" | "good" | "warn" | "crit" | "info" | "hero" | "onTint" | "onTintBrand" | "onTintGood";
const ICON_TONE: Record<IconTone, string> = {
  neutral: "bg-surface-3 text-ink-2 ring-line-strong",
  brand: "bg-brand-tint text-brand ring-brand/35",
  good: "bg-good-soft text-good ring-good/35",
  warn: "bg-warn-soft text-warn ring-warn/35",
  crit: "bg-crit-soft text-crit ring-crit/40",
  info: "bg-info-soft text-info ring-info/35",
  hero: "bg-hero text-on-hero ring-crit/40",
  onTint: "bg-surface text-ink-2 ring-line-strong",
  onTintBrand: "bg-brand-tint text-brand ring-brand/35",
  onTintGood: "bg-good-soft text-good ring-good/35",
};
export function IconBadge({ children, tone = "neutral", size = "md", className }: {
  children: ReactNode; tone?: IconTone; size?: "sm" | "md" | "lg" | "xl"; className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "glow-soft inline-flex shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
        size === "sm" ? "h-7 w-7" : size === "lg" ? "h-12 w-12" : size === "xl" ? "h-14 w-14 sm:h-16 sm:w-16" : "h-8 w-8 sm:h-9 sm:w-9",
        ICON_TONE[tone], className,
      )}
      style={{ boxShadow: "0 0 18px -4px currentColor" }}
    >
      {children}
    </span>
  );
}

/** Inline callout for caveats, footers and mode banners. */
export function Note({ children, tone = "neutral", icon, className }: {
  children: ReactNode; tone?: "neutral" | "info" | "warn" | "good" | "crit"; icon?: ReactNode; className?: string;
}) {
  const t = {
    neutral: "bg-surface-3 text-ink-2 ring-line-strong/70",
    info: "bg-info-soft text-ink ring-info/30",
    warn: "bg-warn-soft text-ink ring-warn/30",
    good: "bg-good-soft text-ink ring-good/30",
    crit: "bg-crit-soft text-ink ring-crit/35",
  }[tone];
  const ic = { neutral: "text-ink-3", info: "text-info", warn: "text-warn", good: "text-good", crit: "text-crit" }[tone];
  return (
    // relative: monitors are positioned, so their long drop shadows would otherwise paint over this note
    <div className={cx("relative flex items-start gap-2.5 rounded-panel px-4 py-3 text-support ring-1 ring-inset", t, className)}>
      {icon && <span className={cx("mt-px shrink-0", ic)}>{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- controls
export type ButtonVariant = "primary" | "secondary" | "subtle" | "ghost" | "danger" | "good" | "run";
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "key key-cyan",
  secondary: "key",
  subtle: "key key-flat text-brand",
  ghost: "rounded-control text-ink-2 transition-colors hover:bg-white/[0.06] hover:text-ink",
  danger: "key key-danger",
  good: "key key-good",
  run: "key key-ivory",
};
export function buttonClass(variant: ButtonVariant = "secondary", size: "sm" | "md" | "lg" = "md", className?: string) {
  return cx(
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-semibold disabled:opacity-45",
    size === "sm" ? "h-8 px-3 text-[12.5px]" : size === "lg" ? "h-12 px-6 text-[14px] tracking-[0.08em]" : "h-9 px-4 text-[13px]",
    BTN_VARIANT[variant], className,
  );
}

export function Button({ children, onClick, variant = "secondary", size = "md", disabled, icon, type = "button", title, className, ...aria }: {
  children?: ReactNode; onClick?: () => void; variant?: ButtonVariant;
  size?: "sm" | "md" | "lg"; disabled?: boolean; icon?: ReactNode; type?: "button" | "submit"; title?: string; className?: string;
  "aria-label"?: string; "aria-pressed"?: boolean; "aria-expanded"?: boolean; "aria-controls"?: string;
}) {
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} className={buttonClass(variant, size, className)} {...aria}>
      {icon}
      {children}
    </button>
  );
}

export function ButtonLink({ to, children, variant = "secondary", size = "md", icon, className, ...rest }: {
  to: string; children: ReactNode; variant?: ButtonVariant; size?: "sm" | "md" | "lg"; icon?: ReactNode; className?: string;
} & Omit<LinkProps, "to" | "className" | "children">) {
  return (
    <Link to={to} className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export interface SegOption<T extends string> { value: T; label: ReactNode; title?: string }
/** A rocker of latching keys for filters and modes. Scrolls sideways on narrow screens instead of wrapping. */
export function Segmented<T extends string>({ value, onChange, options, size = "md", label, className }: {
  value: T; onChange: (v: T) => void; options: SegOption<T>[]; size?: "sm" | "md"; label: string; className?: string;
}) {
  return (
    <div className={cx("no-scrollbar max-w-full overflow-x-auto", className)}>
      <div role="radiogroup" aria-label={label} className="rocker">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={o.title}
              onClick={() => onChange(o.value)}
              className={cx(
                "rocker-key focus-visible:outline-offset-[-2px]",
                size === "sm" ? "h-7 px-2.5 text-caption" : "h-8 px-3 text-[13px]",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Rocker tabs with counts (one idiom for "pick a bucket"). */
export function Tabs<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label: string;
}) {
  return (
    <div className="no-scrollbar max-w-full overflow-x-auto">
      <div role="tablist" aria-label={label} className="rocker">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(o.value)}
              className="rocker-key h-8 px-3 text-[13px] focus-visible:outline-offset-[-2px]"
            >
              {o.label}
              {o.count !== undefined && <span className="tnum font-mono text-[11px] opacity-80">{o.count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const FIELD = "field";

export function Select<T extends string>({ value, onChange, options, label, stacked, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; stacked?: boolean; className?: string;
}) {
  return (
    <label className={cx("text-caption text-ink-3", stacked ? "block" : "inline-flex items-center gap-2", className)}>
      <span className="eyebrow shrink-0 text-ink-3">{label}</span>
      <span className={cx("relative", stacked ? "mt-1.5 block" : "inline-block min-w-0 flex-1")}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className={cx(FIELD, "h-9 w-full max-w-full appearance-none truncate pl-3 pr-8 font-mono text-[12.5px]")}
        >
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
      </span>
    </label>
  );
}

export function TextInput({ className, ...props }: ComponentPropsWithoutRef<"input">) {
  return <input {...props} className={cx(FIELD, "h-9 w-full px-3 font-mono text-[12.5px]", className)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow text-ink-3">{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {hint && <span className="mt-1 block text-micro text-ink-3">{hint}</span>}
    </label>
  );
}

/**
 * The typed text lives in local state. When `value` comes from the URL, React Router applies the
 * update in a transition, so binding the input straight to it drops keystrokes while typing fast.
 * We resync only when `value` changes from outside (Clear filters, back/forward).
 */
export function SearchInput({ value, onChange, placeholder, label, className }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string;
}) {
  const [text, setText] = useState(value);
  const written = useRef(value);
  useEffect(() => {
    if (value !== written.current) { written.current = value; setText(value); }
  }, [value]);
  const update = (v: string) => { written.current = v; setText(v); onChange(v); };
  return (
    <label className={cx("relative flex items-center", className)}>
      <Search size={15} aria-hidden className="pointer-events-none absolute left-3 text-ink-3" />
      <input
        type="search"
        value={text}
        onChange={(e) => update(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={cx(FIELD, "h-9 w-full pl-9 pr-8 text-[13px] [&::-webkit-search-cancel-button]:hidden")}
      />
      {text && (
        <button type="button" aria-label="Clear search" onClick={() => update("")}
          className="absolute right-1.5 flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-white/10 hover:text-ink">
          <X size={13} />
        </button>
      )}
    </label>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={done ? "Copied" : label}
      aria-label={label}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }, () => {});
      }}
      className={cx(
        "press inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-white/[0.07]",
        done ? "text-good" : "text-ink-3 hover:text-ink",
      )}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

// ---------------------------------------------------------------- long lists
/** Render long feeds in pages so the first paint stays light; every item stays one click away. */
export function useIncremental<T>(items: T[], step: number, resetKey: string) {
  const [n, setN] = useState(step);
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) { setKey(resetKey); setN(step); }
  return {
    visible: items.slice(0, n),
    shown: Math.min(n, items.length),
    total: items.length,
    hasMore: n < items.length,
    more: () => setN((v) => v + step),
    all: () => setN(items.length),
    step,
  };
}

export function ShowMore({ shown, total, hasMore, more, all, step, noun }: {
  shown: number; total: number; hasMore: boolean; more: () => void; all: () => void; step: number; noun: string;
}) {
  if (!hasMore) return null;
  return (
    <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
      <span className="tnum text-support text-ink-3">Displaying {shown} of {total} {noun}</span>
      <div className="flex gap-2">
        <Button onClick={more}>Show {Math.min(step, total - shown)} more</Button>
        <Button variant="ghost" onClick={all}>Show all</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- states
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("skeleton", className)} />;
}

export function SkeletonCards({ n = 3, className }: { n?: number; className?: string }) {
  return (
    <div className={cx("space-y-5", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }).map((_, i) => (
        <Panel key={i}>
          <div className="flex gap-2"><Skeleton className="h-6 w-20" /><Skeleton className="h-6 w-28" /></div>
          <Skeleton className="mt-4 h-5 w-2/3" />
          <Skeleton className="mt-2.5 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-5/6" />
          <Skeleton className="mt-5 h-16 w-full rounded-panel" />
        </Panel>
      ))}
    </div>
  );
}

/** An idle screen: what to do next, said in one or two lines. */
export function EmptyState({ title, children, icon, plate = "NO SIGNAL", className }: {
  title: string; children?: ReactNode; icon?: ReactNode; plate?: string; className?: string;
}) {
  return (
    <Monitor led="off" plate={plate} className={className} bodyClassName="flex flex-col items-center justify-center px-6 py-12 text-center">
      <IconBadge tone="brand" size="lg" className="mb-4">{icon ?? <Inbox size={20} />}</IconBadge>
      <div className="glow-soft font-display text-heading font-semibold text-ink">{title}</div>
      {children && <div className="mt-1.5 max-w-md text-support text-ink-3">{children}</div>}
    </Monitor>
  );
}

const START_CMD = "python -m uvicorn app.api.main:app --host 127.0.0.1 --port 8100";

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  if (error.kind === "offline") {
    return (
      <Monitor role="alert" led="warn" ledPulse title="API offline" plate="LINK DOWN" tone="warn" bodyClassName="p-6 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <IconBadge tone="warn" size="lg"><PlugZap size={20} /></IconBadge>
          <div className="min-w-0 flex-1">
            <p className="text-body text-ink-2">
              The local LeakGate API isn't answering. Start it from the repo root (it only listens on 127.0.0.1):
            </p>
            <div className="field mt-3 flex items-center gap-2 py-1.5 pl-3 pr-1.5">
              <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">{START_CMD}</code>
              <CopyButton text={START_CMD} label="Copy command" />
            </div>
            {onRetry && <div className="mt-4"><Button onClick={onRetry} icon={<RefreshCw size={14} />}>Retry</Button></div>}
          </div>
        </div>
      </Monitor>
    );
  }
  return (
    <Monitor role="alert" led="alarm" tone="crit" title={error.kind === "not_found" ? "Not found" : "Something went wrong"}>
      <div className="flex items-start gap-3">
        <IconBadge tone="crit"><AlertTriangle size={17} /></IconBadge>
        <div className="min-w-0 flex-1">
          <p className="break-words pt-1.5 text-support text-ink-2">{error.message}</p>
          {onRetry && <div className="mt-3"><Button size="sm" onClick={onRetry} icon={<RefreshCw size={13} />}>Retry</Button></div>}
        </div>
      </div>
    </Monitor>
  );
}

// ---------------------------------------------------------------- metrics
/**
 * A metric tile is a small monitor: the label on the bezel, a large phosphor readout, one line of
 * context. With `to`, the whole tile is a link, lifts on hover and shows an arrow.
 */
export function Stat({ label, value, sub, icon, tone = "neutral", to, className, variant = "default", children, delay = 0 }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: IconTone; to?: string; className?: string;
  variant?: "default" | "sage"; children?: ReactNode; delay?: number;
}) {
  const screenTone: ScreenTone = tone === "good" ? "good" : tone === "warn" ? "warn" : tone === "crit" ? "crit" : "brand";
  const ink = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "crit" ? "text-crit" : "text-brand";
  const body = (
    <Monitor
      title={label}
      led={tone === "neutral" && variant !== "sage" ? "brand" : tone === "good" ? "ok" : tone === "warn" ? "warn" : tone === "crit" ? "alarm" : "brand"}
      right={icon ? <span className="text-chrome-3" aria-hidden>{icon}</span> : undefined}
      tone={screenTone}
      delay={delay}
      lift={!!to}
      className={cx("flex h-full flex-col", className)}
      screenClassName="flex-1"
      bodyClassName="flex h-full flex-col"
    >
      <div className={cx("glow font-crt text-[46px] leading-[0.9]", ink)}>{value}</div>
      {children}
      {sub && (
        <div className="mt-auto flex items-center gap-1 pt-2.5 text-caption text-ink-3">
          <span className="min-w-0">{sub}</span>
          {to && <ArrowRight size={14} className="ml-auto shrink-0 text-brand transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />}
        </div>
      )}
    </Monitor>
  );
  if (to) return <Link to={to} className="group block h-full rounded-card">{body}</Link>;
  return body;
}

/** Collapses tooltip-y long ids into a monospace token. */
export function Mono({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cx("font-mono text-[11.5px] text-ink-3", className)}>{children}</span>;
}
