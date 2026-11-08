/**
 * The LeakGate mark: a shield with a portcullis (the gate) inside, set in a small glowing screen.
 * Inline SVG, so there is no asset request.
 */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="lg-bezel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a5260" />
          <stop offset="1" stopColor="#1b1f26" />
        </linearGradient>
        <radialGradient id="lg-glass" cx="0.5" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#0f2a33" />
          <stop offset="1" stopColor="#03090c" />
        </radialGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#lg-bezel)" />
      <rect x="2.5" y="2.5" width="27" height="27" rx="7" fill="url(#lg-glass)" />
      <path
        d="M16 6.5 24 9.6v5.9c0 5-3.4 8.6-8 9.8-4.6-1.2-8-4.8-8-9.8V9.6l8-3.1Z"
        stroke="#7fecff"
        strokeWidth="1.7"
        strokeLinejoin="round"
        style={{ filter: "drop-shadow(0 0 2px rgb(116 217 255 / 0.8))" }}
      />
      <path d="M12.6 12v8.2M16 10.9v11.1M19.4 12v8.2M11.6 15.3h8.8" stroke="#3dfc93" strokeWidth="1.6" strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 2px rgb(61 252 147 / 0.75))" }} />
    </svg>
  );
}

export function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={compact ? 28 : 32} />
      <div className="leading-none">
        <div className="font-display text-[16px] font-semibold tracking-[-0.01em] text-white">LeakGate</div>
        {!compact && <div className="eyebrow mt-1 text-[9px] tracking-[0.2em] text-chrome-3">Firewall for AI agents</div>}
      </div>
    </div>
  );
}
