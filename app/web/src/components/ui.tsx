/**
 * Design-system primitives. Every page composes these instead of hand-rolling card, button or input
 * styles, so radius, padding, type and interaction states stay consistent (tokens live in index.css).
 */
import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronDown, Copy, Inbox, PlugZap, RefreshCw, Search, X } from "lucide-react";
import { Link, type LinkProps } from "react-router-dom";
import type { ApiError } from "../api/client";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- layout
export function PageHeader({ title, subtitle, actions, eyebrow }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-micro font-semibold uppercase tracking-[0.07em] text-ink-3">{eyebrow}</div>}
        <h1 className="font-display text-[24px] leading-[1.15] font-semibold tracking-[-0.02em] text-ink sm:text-title">{title}</h1>
        {subtitle && <div className="mt-2 max-w-[70ch] text-body text-ink-3">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 md:shrink-0">{actions}</div>}
    </header>
  );
}

type Tone = "default" | "muted" | "sage" | "hero";
const CARD_TONE: Record<Tone, string> = {
  default: "border border-line bg-surface shadow-xs",
  muted: "border border-transparent bg-surface-3/70",
  sage: "border border-transparent bg-brand-soft",
  hero: "border border-transparent bg-hero text-on-hero",
};

/** The one card surface: 20px radius, token padding, hairline + whisper shadow. */
export function Panel({ children, className, padded = true, tone = "default", as: Tag = "section", ...rest }: {
  children: ReactNode; className?: string; padded?: boolean; tone?: Tone; as?: ElementType;
} & Omit<ComponentPropsWithoutRef<"section">, "className" | "children">) {
  return (
    <Tag className={cx("min-w-0 rounded-card", CARD_TONE[tone], padded && "p-[var(--pad-card)]", className)} {...rest}>
      {children}
    </Tag>
  );
}
export const Card = Panel;

export function PanelTitle({ children, hint, right, id }: { children: ReactNode; hint?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-[16rem]">
        <h2 id={id} className="font-display text-heading font-semibold text-ink">{children}</h2>
        {hint && <p className="mt-1 text-support text-ink-3">{hint}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/** A heading that sits between cards (not inside one). */
export function SectionTitle({ children, hint, right }: { children: ReactNode; hint?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="font-display text-[18px] leading-tight font-semibold tracking-[-0.01em] text-ink">{children}</h2>
        {hint && <p className="mt-1 text-support text-ink-3">{hint}</p>}
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
        "inline-flex max-w-full items-center gap-1.5 border px-2.5 text-caption font-medium",
        wrap ? "min-h-6 rounded-chip py-1 leading-snug" : "h-6 shrink-0 whitespace-nowrap rounded-full leading-none",
        className ?? "border-transparent bg-surface-3 text-ink-2",
      )}
    >
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      {wrap ? <span className="min-w-0 break-words">{children}</span> : children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <code className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-ink-2">{children}</code>;
}

type IconTone = "neutral" | "brand" | "good" | "warn" | "crit" | "info" | "hero" | "onTint" | "onTintBrand" | "onTintGood";
const ICON_TONE: Record<IconTone, string> = {
  neutral: "bg-surface-3 text-ink-2",
  brand: "bg-brand-tint text-brand",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  crit: "bg-crit-soft text-crit",
  info: "bg-info-soft text-info",
  hero: "bg-on-hero/12 text-on-hero",
  onTint: "bg-surface text-ink-2",
  onTintBrand: "bg-surface/70 text-brand",
  onTintGood: "bg-surface text-good",
};
export function IconBadge({ children, tone = "neutral", size = "md", className }: {
  children: ReactNode; tone?: IconTone; size?: "sm" | "md" | "lg" | "xl"; className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        size === "sm" ? "h-7 w-7" : size === "lg" ? "h-12 w-12" : size === "xl" ? "h-14 w-14 sm:h-16 sm:w-16" : "h-8 w-8 sm:h-9 sm:w-9",
        ICON_TONE[tone], className,
      )}
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
    neutral: "bg-surface-3/60 text-ink-2",
    info: "bg-info-soft text-ink",
    warn: "bg-warn-soft text-ink",
    good: "bg-good-soft text-ink",
    crit: "bg-crit-soft text-ink",
  }[tone];
  const ic = { neutral: "text-ink-3", info: "text-info", warn: "text-warn", good: "text-good", crit: "text-crit" }[tone];
  return (
    <div className={cx("flex items-start gap-2.5 rounded-panel px-4 py-3 text-support", t, className)}>
      {icon && <span className={cx("mt-px shrink-0", ic)}>{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- controls
export type ButtonVariant = "primary" | "secondary" | "subtle" | "ghost" | "danger" | "good";
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-brand text-on-brand shadow-xs hover:bg-brand-hover",
  secondary: "border-line-strong bg-surface text-ink hover:bg-surface-2",
  subtle: "border-transparent bg-brand-tint text-brand hover:bg-brand-soft",
  ghost: "border-transparent bg-transparent text-ink-2 hover:bg-surface-3/70 hover:text-ink",
  danger: "border-line-strong bg-surface text-crit hover:border-crit/40 hover:bg-crit-soft",
  good: "border-line-strong bg-surface text-good hover:border-good/40 hover:bg-good-soft",
};
export function buttonClass(variant: ButtonVariant = "secondary", size: "sm" | "md" = "md", className?: string) {
  return cx(
    "press inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control border font-medium disabled:opacity-45",
    size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-body",
    BTN_VARIANT[variant], className,
  );
}

export function Button({ children, onClick, variant = "secondary", size = "md", disabled, icon, type = "button", title, className, ...aria }: {
  children?: ReactNode; onClick?: () => void; variant?: ButtonVariant;
  size?: "sm" | "md"; disabled?: boolean; icon?: ReactNode; type?: "button" | "submit"; title?: string; className?: string;
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
  to: string; children: ReactNode; variant?: ButtonVariant; size?: "sm" | "md"; icon?: ReactNode; className?: string;
} & Omit<LinkProps, "to" | "className" | "children">) {
  return (
    <Link to={to} className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export interface SegOption<T extends string> { value: T; label: ReactNode; title?: string }
/** Lightweight pill track for filters and toggles. Scrolls sideways on narrow screens instead of wrapping. */
export function Segmented<T extends string>({ value, onChange, options, size = "md", label, className }: {
  value: T; onChange: (v: T) => void; options: SegOption<T>[]; size?: "sm" | "md"; label: string; className?: string;
}) {
  return (
    <div className={cx("no-scrollbar max-w-full overflow-x-auto", className)}>
      <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-surface-3/80 p-[3px]">
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
                "press inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-medium focus-visible:outline-offset-[-2px]",
                size === "sm" ? "h-7 px-2.5 text-caption" : "h-8 px-3 text-[13px]",
                active ? "bg-surface text-ink shadow-xs" : "text-ink-2 hover:text-ink",
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

/** Pill tabs with counts (one idiom for "pick a bucket"). */
export function Tabs<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="no-scrollbar -mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 py-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "press inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium focus-visible:outline-offset-[-2px]",
              active
                ? "border-brand/40 bg-brand-tint text-ink"
                : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={cx("tnum rounded-full px-1.5 text-micro leading-5", active ? "bg-brand text-on-brand" : "bg-surface-3 text-ink-2")}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const FIELD = "rounded-control border border-line-strong bg-surface text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-ink-3/60 focus-visible:border-brand";

export function Select<T extends string>({ value, onChange, options, label, stacked, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; stacked?: boolean; className?: string;
}) {
  return (
    <label className={cx("text-caption text-ink-3", stacked ? "block" : "inline-flex items-center gap-2", className)}>
      <span className="shrink-0 font-medium">{label}</span>
      <span className={cx("relative", stacked ? "mt-1.5 block" : "inline-block min-w-0 flex-1")}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className={cx(FIELD, "h-9 w-full max-w-full appearance-none truncate pl-3 pr-8 text-[13px] font-medium")}
        >
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
      </span>
    </label>
  );
}

export function TextInput({ className, ...props }: ComponentPropsWithoutRef<"input">) {
  return <input {...props} className={cx(FIELD, "h-9 w-full px-3 text-[13px]", className)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-caption font-medium text-ink-3">{label}</span>
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
          className="absolute right-1.5 flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-surface-3 hover:text-ink">
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
        "press inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-surface-3",
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
    <div className={cx("space-y-4", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }).map((_, i) => (
        <Panel key={i}>
          <div className="flex gap-2"><Skeleton className="h-6 w-20 rounded-full" /><Skeleton className="h-6 w-28 rounded-full" /></div>
          <Skeleton className="mt-4 h-5 w-2/3" />
          <Skeleton className="mt-2.5 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-5/6" />
          <Skeleton className="mt-5 h-16 w-full rounded-panel" />
        </Panel>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-surface-2/70 px-6 py-12 text-center">
      <IconBadge tone="brand" size="lg" className="mb-4">{icon ?? <Inbox size={20} />}</IconBadge>
      <div className="font-display text-heading font-semibold text-ink">{title}</div>
      {children && <div className="mt-1.5 max-w-md text-support text-ink-3">{children}</div>}
    </div>
  );
}

const START_CMD = "python -m uvicorn app.api.main:app --host 127.0.0.1 --port 8100";

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  if (error.kind === "offline") {
    return (
      <Panel className="p-6 sm:p-8" role="alert">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <IconBadge tone="warn" size="lg"><PlugZap size={20} /></IconBadge>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[18px] font-semibold text-ink">API offline</div>
            <p className="mt-1 text-body text-ink-3">
              The local LeakGate API isn't answering. Start it from the repo root (it only listens on 127.0.0.1):
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-control border border-line bg-surface-2 py-1.5 pl-3 pr-1.5">
              <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink-2">{START_CMD}</code>
              <CopyButton text={START_CMD} label="Copy command" />
            </div>
            {onRetry && <div className="mt-4"><Button onClick={onRetry} icon={<RefreshCw size={14} />}>Retry</Button></div>}
          </div>
        </div>
      </Panel>
    );
  }
  return (
    <Panel role="alert">
      <div className="flex items-start gap-3">
        <IconBadge tone="crit"><AlertTriangle size={17} /></IconBadge>
        <div className="min-w-0 flex-1">
          <div className="font-display text-heading font-semibold text-ink">
            {error.kind === "not_found" ? "Not found" : "Something went wrong"}
          </div>
          <p className="mt-0.5 break-words text-support text-ink-3">{error.message}</p>
          {onRetry && <div className="mt-3"><Button size="sm" onClick={onRetry} icon={<RefreshCw size={13} />}>Retry</Button></div>}
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- metrics
/**
 * A metric tile: label + icon on top, a calm large number, and one line of context.
 * With `to`, the whole tile is a link and shows an arrow, so it reads as interactive.
 */
export function Stat({ label, value, sub, icon, tone = "neutral", to, className, variant = "default", children }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: IconTone; to?: string; className?: string;
  variant?: "default" | "sage"; children?: ReactNode;
}) {
  const sage = variant === "sage";
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className={cx("pt-1 text-support font-medium", sage ? "text-ink" : "text-ink-2")}>{label}</div>
        {icon && <IconBadge tone={sage ? "onTintBrand" : tone}>{icon}</IconBadge>}
      </div>
      <div className="mt-auto pt-4 font-display text-metric font-semibold tracking-[-0.02em] text-ink">{value}</div>
      {children}
      {sub && (
        <div className={cx("mt-2 flex items-center gap-1 text-caption", sage ? "text-ink-2" : "text-ink-3")}>
          <span className="min-w-0">{sub}</span>
          {to && <ArrowRight size={14} className="ml-auto shrink-0 text-brand transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />}
        </div>
      )}
    </>
  );
  const base = cx(
    "flex h-full min-w-0 flex-col rounded-card border p-[var(--pad-card)]",
    sage ? "border-transparent bg-brand-soft" : "border-line bg-surface shadow-xs",
  );
  if (to) {
    return (
      <Link to={to} className={cx("group lift hover:border-line-strong", base, className)}>
        {body}
      </Link>
    );
  }
  return <div className={cx(base, className)}>{body}</div>;
}

/** Collapses tooltip-y long ids into a monospace token. */
export function Mono({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cx("font-mono text-[11.5px] text-ink-3", className)}>{children}</span>;
}
