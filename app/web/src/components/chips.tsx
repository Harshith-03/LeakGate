import { Ban, CheckCircle2, Eye, PenLine, Scissors, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { Action, Channel, Layer, PolicyMode, Severity } from "../api/types";
import { ACTION_LABEL, CHANNEL_LABEL, LAYER_LABEL, kindLabel } from "../lib/format";
import type { LedState, ScreenTone } from "./crt";
import { Chip, cx } from "./ui";

/**
 * Action colours carry a fixed meaning everywhere: allowed = green phosphor, rewritten/redacted =
 * amber, blocked = red. Always paired with an icon and a word, never colour alone.
 */
export const ACTION_TONE: Record<Action, {
  chip: string; text: string; soft: string; icon: ReactNode; iconLg: ReactNode; led: LedState; screen: ScreenTone;
}> = {
  allow: { chip: "bg-good-soft text-good ring-good/40", text: "text-good", soft: "bg-good-soft", icon: <CheckCircle2 size={13} />, iconLg: <CheckCircle2 size={15} />, led: "ok", screen: "good" },
  rewrite: { chip: "bg-warn-soft text-warn ring-warn/40", text: "text-warn", soft: "bg-warn-soft", icon: <PenLine size={13} />, iconLg: <PenLine size={15} />, led: "warn", screen: "warn" },
  redact: { chip: "bg-warn-soft text-warn ring-warn/40", text: "text-warn", soft: "bg-warn-soft", icon: <Scissors size={13} />, iconLg: <Scissors size={15} />, led: "warn", screen: "warn" },
  block: { chip: "bg-crit-soft text-crit ring-crit/45", text: "text-crit", soft: "bg-crit-soft", icon: <Ban size={13} />, iconLg: <Ban size={15} />, led: "alarm", screen: "crit" },
};

export function ActionChip({ action, size = "md", className }: { action: Action; size?: "md" | "lg"; className?: string }) {
  const t = ACTION_TONE[action];
  return (
    <span
      className={cx(
        "glow-soft inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip font-semibold uppercase leading-none tracking-[0.06em] ring-1 ring-inset",
        size === "lg" ? "h-7 px-2.5 text-[12px]" : "h-[22px] px-2 text-[10.5px]",
        t.chip, className,
      )}
    >
      {size === "lg" ? t.iconLg : t.icon}
      {ACTION_LABEL[action]}
    </span>
  );
}

export function ChannelChip({ channel }: { channel: Channel }) {
  return <Chip className="border-line-strong bg-transparent font-mono text-ink-2" title={`Channel: ${channel}`}>{CHANNEL_LABEL[channel] ?? channel}</Chip>;
}

export function KindChip({ kind, tone = "neutral" }: { kind: string; tone?: "neutral" | "crit" | "warn" }) {
  const cls = tone === "crit" ? "border-crit/35 bg-crit-soft text-crit" : tone === "warn" ? "border-warn/35 bg-warn-soft text-warn" : "border-line-strong bg-surface-3 text-ink-2";
  return <Chip className={cls} title={kind}>{kindLabel(kind)}</Chip>;
}

export function LayerChip({ layer }: { layer: Layer }) {
  return <Chip className="border-line-strong bg-surface-2 text-ink-2">{LAYER_LABEL[layer] ?? layer}</Chip>;
}

export const severityTone = (s: Severity): "crit" | "warn" => (s === "critical" || s === "high" ? "crit" : "warn");

export function ModeChip({ mode }: { mode: PolicyMode }) {
  return mode === "enforce"
    ? <Chip className="border-brand/35 bg-brand-tint text-brand" icon={<ShieldCheck size={12} />}>Enforce</Chip>
    : <Chip className="border-warn/35 bg-warn-soft text-warn" icon={<Eye size={12} />}>Monitor</Chip>;
}
