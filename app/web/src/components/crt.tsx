/**
 * The control-room hardware: CRT monitors, status LEDs, 7-segment readouts, toggle switches and a
 * number ticker. The look lives in index.css (.crt, .crt-screen, .crt-fx, .led, .switch, .readout);
 * these components only wire the structure and the state attributes.
 */
import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";
import { cx } from "../lib/cx";

// ---------------------------------------------------------------- LED

/** green = allowed / ok, amber = rewritten, red = blocked / alarm, off = idle. */
export type LedState = "off" | "ok" | "warn" | "alarm" | "info" | "brand";

export function Led({ state = "off", size = "md", pulse, blink, label, className }: {
  state?: LedState; size?: "sm" | "md" | "lg"; pulse?: boolean; blink?: boolean; label?: string; className?: string;
}) {
  return (
    <span
      className={cx(
        "led",
        size === "lg" && "led-lg",
        size === "sm" && "led-sm",
        pulse && state !== "off" && "led-pulse",
        blink && state !== "off" && "led-blink",
        className,
      )}
      data-state={state}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

// ---------------------------------------------------------------- monitor

/** Phosphor family of a screen. One per state, used for glow, roll band and power-on line. */
export type ScreenTone = "idle" | "good" | "warn" | "crit" | "info" | "brand";

interface MonitorProps {
  title?: ReactNode;
  /** small embossed model plate on the bezel, e.g. "LG-02 · AGENT" */
  plate?: string;
  led?: LedState;
  ledPulse?: boolean;
  ledBlink?: boolean;
  ledLabel?: string;
  /** controls on the right of the bezel's title strip */
  right?: ReactNode;
  /** a control strip under the screen, on the bezel */
  footer?: ReactNode;
  children?: ReactNode;
  tone?: ScreenTone;
  /** glow around the monitor (active or alarmed) */
  glow?: boolean;
  /** play the power-on line when the monitor mounts (default on) */
  powerOn?: boolean;
  /** power-on delay in ms, for staggered entrances */
  delay?: number;
  lift?: boolean;
  screws?: boolean;
  padded?: boolean;
  className?: string;
  screenClassName?: string;
  bodyClassName?: string;
  id?: string;
  titleId?: string;
  titleAs?: ElementType;
  as?: ElementType;
  role?: string;
  "aria-label"?: string;
  "aria-live"?: "polite" | "assertive" | "off";
  "aria-busy"?: boolean;
  style?: CSSProperties;
}

/** Every section of the UI is one of these: a moulded bezel around a recessed CRT screen. */
export function Monitor({
  title, plate, led, ledPulse, ledBlink, ledLabel, right, footer, children, tone = "idle", glow, powerOn = true, delay = 0,
  lift, screws, padded = true, className, screenClassName, bodyClassName, id, titleId, titleAs: TitleTag = "h2",
  as: Tag = "section", role, style, ...aria
}: MonitorProps) {
  const head = title !== undefined || right !== undefined || led !== undefined || plate !== undefined;
  return (
    <Tag
      id={id}
      role={role}
      style={style}
      className={cx("crt", lift && "crt-lift", className)}
      data-tone={tone}
      data-glow={glow ? "" : undefined}
      aria-labelledby={title && titleId ? titleId : undefined}
      {...aria}
    >
      {head && (
        <div className="crt-head">
          {screws && <span className="crt-screw" aria-hidden />}
          {led !== undefined && <Led state={led} pulse={ledPulse} blink={ledBlink} label={ledLabel} />}
          {title !== undefined && <TitleTag id={titleId} className="crt-title truncate">{title}</TitleTag>}
          {plate && <span className="crt-plate hidden sm:inline-flex" aria-hidden>{plate}</span>}
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">{right}</div>
          {screws && <span className="crt-screw" aria-hidden />}
        </div>
      )}
      <Screen powerOn={powerOn} delay={delay} padded={padded} className={screenClassName} bodyClassName={bodyClassName}>
        {children}
      </Screen>
      {footer && <div className="px-1.5 pb-0.5 pt-2.5">{footer}</div>}
    </Tag>
  );
}

/** The recessed glass on its own (used inside monitors that build their own bezel). */
export function Screen({ children, powerOn = true, delay = 0, padded = true, glitch, className, bodyClassName }: {
  children?: ReactNode; powerOn?: boolean; delay?: number; padded?: boolean; glitch?: boolean;
  className?: string; bodyClassName?: string;
}) {
  return (
    <div className={cx("crt-screen", powerOn && "crt-on", className)} style={{ "--d": `${delay}ms` } as CSSProperties}>
      <div className={cx("crt-body", padded && "p-[var(--pad-card)]", glitch && "crt-glitch", bodyClassName)}>{children}</div>
      <div className="crt-fx" aria-hidden />
    </div>
  );
}

// ---------------------------------------------------------------- 7-segment readout

const SEGMENTS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg",
  "9": "abcdfg", "-": "g", " ": "",
};
const W = 12;
const H = 22;
const T = 2.4;
const G = 0.5;

function hSeg(cy: number) {
  const x1 = T / 2 + G;
  const x2 = W - T / 2 - G;
  const h = T / 2;
  return `${x1},${cy} ${x1 + h},${cy - h} ${x2 - h},${cy - h} ${x2},${cy} ${x2 - h},${cy + h} ${x1 + h},${cy + h}`;
}
function vSeg(cx: number, y1: number, y2: number) {
  const h = T / 2;
  return `${cx},${y1} ${cx + h},${y1 + h} ${cx + h},${y2 - h} ${cx},${y2} ${cx - h},${y2 - h} ${cx - h},${y1 + h}`;
}
const GEOM: Record<string, string> = {
  a: hSeg(T / 2),
  g: hSeg(H / 2),
  d: hSeg(H - T / 2),
  b: vSeg(W - T / 2, T / 2 + G, H / 2 - G),
  c: vSeg(W - T / 2, H / 2 + G, H - T / 2 - G),
  e: vSeg(T / 2, H / 2 + G, H - T / 2 - G),
  f: vSeg(T / 2, T / 2 + G, H / 2 - G),
};

/** A real 7-segment display: unlit segments stay faintly visible, lit ones glow in the state colour. */
export function SevenSeg({ value, digits = 2, color, height = 30, className }: {
  value: number; digits?: number; color: string; height?: number; className?: string;
}) {
  const text = String(Math.max(0, Math.floor(value)));
  const n = Math.max(digits, text.length);
  const chars = text.padStart(n, " ").split("");
  const step = W + 4;
  const vbW = n * step - 4 + 4;
  return (
    <svg
      viewBox={`-1 -1 ${vbW + 2} ${H + 2}`}
      height={height}
      width={(height * (vbW + 2)) / (H + 2)}
      className={className}
      style={{ color }}
      aria-hidden
    >
      {chars.map((ch, i) => {
        const on = SEGMENTS[ch] ?? "";
        return (
          <g key={i} transform={`translate(${i * step + 2.6} 0) skewX(-6)`}>
            {Object.entries(GEOM).map(([k, pts]) => (
              <polygon key={k} points={pts} fill="currentColor" opacity={on.includes(k) ? 1 : 0.075}
                className={on.includes(k) ? "seg-lit" : undefined} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** Counts up (or down) one integer at a time to the new value. Instant under reduced motion. */
export function useTicker(target: number, duration = 520): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const from = current.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || from === target) {
      current.current = target;
      setShown(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / duration);
      const v = Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      current.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return shown;
}

// ---------------------------------------------------------------- toggle switch

/** A tactile slide switch with an LED. `role="switch"`; the label and LED say the state in words too. */
export function ToggleSwitch({ checked, onChange, label, sub, led = "alarm", tone, disabled, className, onScreen }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; sub?: ReactNode; led?: LedState;
  tone?: "brand" | "warn"; disabled?: boolean; className?: string; onScreen?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("group flex min-w-0 items-center gap-3 rounded-control py-1 pr-2 text-left disabled:opacity-50", className)}
    >
      <span className="switch" data-on={checked ? "" : undefined} data-tone={tone} aria-hidden>
        <span className="switch-knob" />
      </span>
      <span className="min-w-0">
        <span className={cx("flex items-center gap-2 text-[13px] font-semibold leading-tight", onScreen ? "text-ink" : "text-chrome")}>
          <span className="min-w-0">{label}</span>
          <Led state={checked ? led : "off"} size="sm" />
        </span>
        {sub && <span className={cx("mt-0.5 block text-caption leading-snug", onScreen ? "text-ink-3" : "text-chrome-3")}>{sub}</span>}
      </span>
    </button>
  );
}
