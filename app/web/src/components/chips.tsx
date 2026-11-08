import { Ban, CheckCircle2, Eye, PenLine, Scissors, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { Action, Channel, Layer, PolicyMode, Severity } from "../api/types";
import { ACTION_LABEL, CHANNEL_LABEL, LAYER_LABEL, kindLabel } from "../lib/format";
import { Chip, cx } from "./ui";

/**
 * Action colours carry a fixed meaning everywhere: allowed = calm green, rewritten/redacted = amber,
 * blocked = brick. Always paired with an icon and a word, never colour alone.
 */
export const ACTION_TONE: Record<Action, { chip: string; text: string; soft: string; icon: ReactNode; iconLg: ReactNode }> = {
  allow: { chip: "bg-good-soft text-good", text: "text-good", soft: "bg-good-soft", icon: <CheckCircle2 size={13} />, iconLg: <CheckCircle2 size={15} /> },
  rewrite: { chip: "bg-warn-soft text-warn", text: "text-warn", soft: "bg-warn-soft", icon: <PenLine size={13} />, iconLg: <PenLine size={15} /> },
  redact: { chip: "bg-warn-soft text-warn", text: "text-warn", soft: "bg-warn-soft", icon: <Scissors size={13} />, iconLg: <Scissors size={15} /> },
  block: { chip: "bg-crit-soft text-crit", text: "text-crit", soft: "bg-crit-soft", icon: <Ban size={13} />, iconLg: <Ban size={15} /> },
};

export function ActionChip({ action, size = "md", className }: { action: Action; size?: "md" | "lg"; className?: string }) {
  const t = ACTION_TONE[action];
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-semibold leading-none",
        size === "lg" ? "h-7 px-3 text-[13px]" : "h-6 px-2.5 text-caption",
        t.chip, className,
      )}
    >
      {size === "lg" ? t.iconLg : t.icon}
      {ACTION_LABEL[action]}
    </span>
  );
}

export function ChannelChip({ channel }: { channel: Channel }) {
  return <Chip className="border-line bg-surface text-ink-2" title={`Channel: ${channel}`}>{CHANNEL_LABEL[channel] ?? channel}</Chip>;
}

export function KindChip({ kind, tone = "neutral" }: { kind: string; tone?: "neutral" | "crit" | "warn" }) {
  const cls = tone === "crit" ? "bg-crit-soft text-crit" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-surface-3 text-ink-2";
  return <Chip className={cx("border-transparent", cls)} title={kind}>{kindLabel(kind)}</Chip>;
}

export function LayerChip({ layer }: { layer: Layer }) {
  return <Chip className="border-line bg-surface-2 text-ink-2">{LAYER_LABEL[layer] ?? layer}</Chip>;
}

export const severityTone = (s: Severity): "crit" | "warn" => (s === "critical" || s === "high" ? "crit" : "warn");

export function ModeChip({ mode }: { mode: PolicyMode }) {
  return mode === "enforce"
    ? <Chip className="border-transparent bg-brand-tint text-brand" icon={<ShieldCheck size={12} />}>Enforce</Chip>
    : <Chip className="border-transparent bg-warn-soft text-warn" icon={<Eye size={12} />}>Monitor</Chip>;
}
