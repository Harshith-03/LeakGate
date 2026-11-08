import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cx } from "./ui";

/**
 * Descriptive popover for hover, keyboard focus and tap. It is rendered in a portal with fixed
 * positioning so scroll containers never clip it, and it is purely visual: the trigger carries the
 * same information for screen readers (sr-only text), so the card itself is aria-hidden.
 */
export function useHoverCard<T extends HTMLElement>(width = 300) {
  const ref = useRef<T>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(width, vw - 16);
    const left = Math.min(Math.max(8, r.left), vw - w - 8);
    const above = r.bottom + 220 > vh && r.top > 240;
    setPos({ top: above ? r.top - 8 : r.bottom + 8, left, above });
  }, [width]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const triggerProps = {
    ref,
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
    // Focus already opened it on click; a tap on touch screens opens it too. Tap elsewhere or Esc closes.
    onClick: () => setOpen(true),
  };
  return { open, pos, width, triggerProps };
}

export function FloatingCard({ open, pos, width, children }: {
  open: boolean; pos: { top: number; left: number; above: boolean } | null; width: number; children: ReactNode;
}) {
  if (!open || !pos) return null;
  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-[80] rounded-panel border border-line bg-surface p-3.5 text-left text-support text-ink-2 shadow-lg"
      style={{
        top: pos.top, left: pos.left, width: `min(${width}px, calc(100vw - 16px))`,
        transform: pos.above ? "translateY(-100%)" : undefined,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** A small (i) button that explains a term. */
export function InfoTip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const { open, pos, width, triggerProps } = useHoverCard<HTMLButtonElement>(320);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        {...triggerProps}
        className={cx("press inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-current opacity-75 hover:opacity-100", className)}
      >
        <Info size={14} />
      </button>
      <span id={id} className="sr-only">{children}</span>
      <FloatingCard open={open} pos={pos} width={width}>{children}</FloatingCard>
    </>
  );
}
