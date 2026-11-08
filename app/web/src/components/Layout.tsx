import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3, Cpu, FlaskConical, FlaskRound, Globe, Menu, Moon, Network, Radio, ScrollText, ShieldCheck, Sun,
  TestTubeDiagonal, X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useDataSource, type DataSource } from "../api/client";
import type { Status } from "../api/types";
import { useApp } from "../state/app";
import { lastBlockedHost, useStatus } from "../state/status";
import { ModeChip } from "./chips";
import { LogoMark, Wordmark } from "./Logo";
import { cx } from "./ui";

export function Layout() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const source = useDataSource();
  const { status } = useStatus();

  useEffect(() => { window.scrollTo(0, 0); setMenuOpen(false); }, [pathname]);

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[70] focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-body focus:font-medium focus:text-ink focus:shadow-lg">
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col px-4 pb-4 pt-5 lg:flex" aria-label="Sidebar">
        <div className="px-2 pb-6"><Wordmark /></div>
        <NavContent />
        <ApiPanel source={source} status={status} />
      </aside>

      <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} source={source} status={status} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMenuOpen(true)} source={source} status={status} />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-20 pt-6 outline-none sm:px-6 lg:px-8 lg:pt-8">
          <motion.div
            key={pathname}
            className="@container"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- navigation
function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto" aria-label="Main">
      <NavSection>Demo</NavSection>
      <NavItem to="/" icon={<Radio size={17} />} end onNavigate={onNavigate}>Live</NavItem>
      <NavItem to="/playground" icon={<TestTubeDiagonal size={17} />} onNavigate={onNavigate}>Playground</NavItem>
      <NavSection>Proof</NavSection>
      <NavItem to="/ledger" icon={<ScrollText size={17} />} onNavigate={onNavigate}>Ledger</NavItem>
      <NavItem to="/benchmark" icon={<BarChart3 size={17} />} onNavigate={onNavigate}>Benchmark</NavItem>
      <NavSection>Configuration</NavSection>
      <NavItem to="/policy" icon={<ShieldCheck size={17} />} onNavigate={onNavigate}>Policy &amp; vault</NavItem>
    </nav>
  );
}

function NavSection({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1.5 pt-5 text-micro font-semibold uppercase tracking-[0.08em] text-ink-3 first:pt-0">{children}</div>;
}

function NavItem({ to, icon, children, end, onNavigate }: {
  to: string; icon: ReactNode; children: ReactNode; end?: boolean; onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) => cx(
        "press group flex h-10 items-center gap-3 rounded-control px-3 text-body transition-colors focus-visible:outline-offset-[-2px]",
        isActive ? "bg-surface font-semibold text-ink shadow-xs" : "font-medium text-ink-2 hover:bg-surface-3/70 hover:text-ink",
      )}
    >
      {({ isActive }) => (
        <>
          <span className={cx("transition-colors", isActive ? "text-brand" : "text-ink-3 group-hover:text-ink-2")}>{icon}</span>
          <span className="flex-1 truncate">{children}</span>
        </>
      )}
    </NavLink>
  );
}

function ApiPanel({ source, status }: { source: DataSource; status: Status | null }) {
  const demo = source === "demo";
  return (
    <div className="mt-4 rounded-panel bg-surface-3/60 p-3.5 text-caption">
      <div className="flex items-center gap-2 font-medium text-ink">
        <span className={cx("h-2 w-2 rounded-full", source === "live" ? "live-dot bg-good" : demo ? "bg-info" : "bg-line-strong")} />
        {source === "live" ? "Local API connected" : demo ? "Demo data" : "Connecting…"}
      </div>
      <div className="mt-1 font-mono text-micro text-ink-3">127.0.0.1:8100 · loopback only</div>
      {demo && (
        <p className="mt-2 text-micro leading-snug text-ink-3">
          The API isn't answering, so built-in fixtures stand in. Start it and this switches over by itself.
        </p>
      )}
      {source === "live" && status && (
        <p className="mt-2 text-micro leading-snug text-ink-3">
          Ledger: {status.ledger.records} record{status.ledger.records === 1 ? "" : "s"} · {status.ledger.ok ? "chain intact" : "chain broken"}
        </p>
      )}
    </div>
  );
}

function MobileNav({ open, onClose, source, status }: { open: boolean; onClose: () => void; source: DataSource; status: Status | null }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("a,button")?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="lg:hidden">
          <motion.div
            className="fixed inset-0 z-50 bg-[var(--scrim)]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="fixed inset-y-0 left-0 z-50 flex w-[288px] max-w-[86vw] flex-col bg-bg px-4 pb-4 pt-4 shadow-lg"
            initial={{ x: -24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -24, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="mb-5 flex items-center justify-between pl-2">
              <Wordmark />
              <button onClick={onClose} aria-label="Close navigation" className="press flex h-10 w-10 items-center justify-center rounded-control text-ink-2 hover:bg-surface-3">
                <X size={18} />
              </button>
            </div>
            <NavContent onNavigate={onClose} />
            <ApiPanel source={source} status={status} />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------- top bar

function TopBar({ onMenu, source, status }: { onMenu: () => void; source: DataSource; status: Status | null }) {
  const { theme, toggleTheme } = useApp();
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-2 px-4 sm:h-16 sm:gap-3 sm:px-6 lg:px-8">
        <button
          onClick={onMenu}
          aria-label="Open navigation"
          className="press -ml-1 flex h-10 w-10 items-center justify-center rounded-control text-ink-2 hover:bg-surface-3 lg:hidden"
        >
          <Menu size={19} />
        </button>
        <span className="flex items-center gap-2 lg:hidden">
          <LogoMark size={26} />
          <span className="font-display text-[15px] font-semibold text-ink">LeakGate</span>
        </span>
        <PolicyBadge status={status} className="hidden md:inline-flex" />

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {source === "demo" && <DemoBadge />}
          <StatusPills status={status} className="hidden md:flex" />
          <button
            onClick={toggleTheme}
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            title={theme === "light" ? "Dark theme" : "Light theme"}
            className="press flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-surface-3 hover:text-ink"
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </div>
      {/* phones and small tablets: the same status, on a row that scrolls sideways if it must */}
      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto px-4 pb-2.5 sm:px-6 md:hidden">
        <PolicyBadge status={status} className="inline-flex" />
        <StatusPills status={status} className="flex" />
      </div>
    </header>
  );
}

function PolicyBadge({ status, className }: { status: Status | null; className?: string }) {
  if (!status) return <span className={cx("h-8 w-48 rounded-full skeleton", className)} aria-hidden />;
  return (
    <span className={cx("min-w-0 shrink-0 items-center gap-2 rounded-full border border-line bg-surface py-1 pl-3 pr-1 text-[13px]", className)}
      title={`Policy ${status.policy}, ${status.mode} mode`}>
      <ShieldCheck size={14} className="shrink-0 text-ink-3" />
      <span className="truncate font-mono text-[12px] text-ink-2">{status.policy}</span>
      <ModeChip mode={status.mode} />
    </span>
  );
}

function DemoBadge() {
  return (
    <span
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-info/30 bg-info-soft px-2.5 text-[12.5px] font-semibold text-info"
      title="The LeakGate API isn't reachable, so these screens use built-in demo fixtures (synthetic data). Start the API and the UI switches over by itself."
      role="status"
    >
      <FlaskConical size={14} />
      Demo data
    </span>
  );
}

function Pill({ icon, children, tone = "neutral", title }: {
  icon: ReactNode; children: ReactNode; tone?: "neutral" | "good" | "warn"; title: string;
}) {
  const dot = tone === "good" ? "bg-good" : tone === "warn" ? "bg-warn" : "bg-line-strong";
  return (
    <span title={title} className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-2.5 text-[12.5px] font-medium text-ink-2">
      <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", dot)} />
      <span className="text-ink-3" aria-hidden>{icon}</span>
      {children}
    </span>
  );
}

function StatusPills({ status, className }: { status: Status | null; className?: string }) {
  if (!status) return null;
  const ng = status.netguard;
  const last = lastBlockedHost(status);
  return (
    <div className={cx("shrink-0 items-center gap-1.5 sm:gap-2", className)}>
      <Pill
        icon={<Globe size={13} />}
        tone={status.tavily === "live" ? "good" : "neutral"}
        title={status.tavily === "live" ? "Tavily: live API calls (inspected by LeakGate)" : "Tavily: replaying recorded responses (no API key, or offline)"}
      >
        Tavily {status.tavily === "live" ? "live" : "replay"}
      </Pill>
      <Pill
        icon={status.model_available ? <Cpu size={13} /> : <FlaskRound size={13} />}
        tone={status.model_available ? "good" : "warn"}
        title={status.model_available
          ? `Local model ready: ${status.model} on 127.0.0.1 (Ollama). Used for rewrites and the context layer.`
          : `Local model unavailable (${status.model}). Rewrites fall back to rules; the context layer is skipped.`}
      >
        <span className="hidden xl:inline">Local model</span>
        <span className="xl:hidden">Model</span>
        {status.model_available ? " ready" : " off"}
      </Pill>
      <Pill
        icon={<Network size={13} />}
        tone={ng?.installed ? "good" : "warn"}
        title={ng?.installed
          ? `Socket guard: connections to hosts outside the allowlist fail even if code bypasses the SDK. ${ng.blocked} blocked${last ? `, last: ${last}` : ""}.`
          : "Socket guard is not installed in the API process."}
      >
        {ng?.installed ? <>Socket guard on · <span className="tnum">{ng.blocked}</span> blocked</> : "Socket guard off"}
      </Pill>
    </div>
  );
}
