/**
 * The LeakGate mark: a shield with a portcullis (the gate) inside. Inline SVG drawn from theme
 * tokens, so there is no asset request and it follows light/dark.
 */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="9" style={{ fill: "var(--hero)" }} />
      <path
        d="M16 5.5 25 9v6.6c0 5.6-3.8 9.6-9 11-5.2-1.4-9-5.4-9-11V9l9-3.5Z"
        style={{ stroke: "var(--on-hero)" }}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12.2 11.6v9.2M16 10.4v12.4M19.8 11.6v9.2M11 15.2h10"
        style={{ stroke: "var(--accent)" }}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <div className="leading-none">
        <div className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">LeakGate</div>
        <div className="mt-1 text-micro font-medium text-ink-3">Firewall for AI agents</div>
      </div>
    </div>
  );
}
