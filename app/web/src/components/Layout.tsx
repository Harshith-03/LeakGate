import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, FlaskConical, Microscope, ScrollText, ShieldCheck, SquareTerminal } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { NavLink, useLocation, useOutlet } from "react-router-dom";
import { useDataSource, type DataSource } from "../api/client";
import type { Status } from "../api/types";
import { lastBlockedHost, useStatus } from "../state/status";
import { Led, type LedState } from "./crt";
import { LogoMark, Wordmark } from "./Logo";
import { Starfield } from "./Starfield";
import { cx } from "./ui";

const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: "/", label: "Console", icon: <SquareTerminal size={16} />, end: true },
  { to: "/inspector", label: "Inspector", icon: <Microscope size={16} /> },
  { to: "/ledger", label: "Ledger", icon: <ScrollText size={16} /> },
  { to: "/benchmark", label: "Benchmark", icon: <BarChart3 size={16} /> },
  { to: "/policy", label: "Policy", icon: <ShieldCheck size={16} /> },
];

export function Layout() {
  const { pathname } = useLocation();
  const outlet = useOutlet();
  const source = useDataSource();
  const { status } = useStatus();

  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="relative min-h-screen">
      <Starfield />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[70] focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-body focus:font-medium focus:text-ink">
        Skip to content
      </a>

      <TopBar source={source} status={status} />

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1560px] px-3.5 pb-32 pt-5 outline-none sm:px-6 sm:pt-7 md:pb-20 lg:px-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 14, scale: 0.992 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.996 }}
            transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {outlet}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="relative mx-auto hidden max-w-[1560px] px-10 pb-8 text-caption text-chrome-3 md:block">
        LeakGate runs on 127.0.0.1. Northwind Mutual is a fictional insurer and every customer here is synthetic.
      </footer>

      <BottomKeys />
    </div>
  );
}

// ---------------------------------------------------------------- top bar

function TopBar({ source, status }: { source: DataSource; status: Status | null }) {
  return (
    <header className="sticky top-0 z-40 px-2.5 pt-2.5 sm:px-4 sm:pt-3">
      {/* fade the page out under the bar so scrolled content never fights the controls */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#080d1c] via-[#080d1c]/85 to-transparent" />
      <div className="rack relative mx-auto flex h-14 max-w-[1580px] items-center gap-3 px-3 sm:h-[60px] sm:px-4">
        <span className="crt-screw hidden xl:block" aria-hidden />
        <NavLink to="/" className="shrink-0 rounded-control" aria-label="LeakGate console">
          <span className="hidden sm:block"><Wordmark /></span>
          <span className="flex items-center gap-2 sm:hidden"><LogoMark size={28} /><span className="font-display text-[15px] font-semibold text-white max-[430px]:sr-only">LeakGate</span></span>
        </NavLink>

        <nav aria-label="Main" className="mx-auto hidden md:block">
          <div className="rocker">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className="rocker-key h-9 px-3 text-[13px] focus-visible:outline-offset-[-2px] lg:px-3.5"
              >
                {({ isActive }) => (
                  <>
                    <span className={cx("transition-colors", isActive ? "text-brand" : "text-chrome-3")} aria-hidden>{n.icon}</span>
                    <span className="hidden lg:inline">{n.label}</span>
                    <span className="sr-only lg:hidden">{n.label}</span>
                    {isActive && <Led state="brand" size="sm" className="ml-0.5 hidden lg:inline-block" />}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2 md:ml-0">
          {source === "demo" && <DemoBadge />}
          <StatusLeds status={status} />
        </div>
        <span className="crt-screw hidden xl:block" aria-hidden />
      </div>
    </header>
  );
}

function DemoBadge() {
  return (
    <span
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-info-soft px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-info ring-1 ring-inset ring-info/35"
      title="The LeakGate API isn't reachable, so these screens use built-in demo fixtures (synthetic data). Start the API and the UI switches over by itself."
      role="status"
    >
      <FlaskConical size={13} aria-hidden />
      <span className="hidden sm:inline">Demo data</span>
      <span className="sm:hidden">Demo</span>
    </span>
  );
}

/** Tavily, local model and socket guard as three small LEDs, plus the policy mode. */
function StatusLeds({ status }: { status: Status | null }) {
  if (!status) {
    return <span className="readout flex h-8 w-40 items-center px-3"><Led state="off" size="sm" /><span className="ml-2 text-caption text-chrome-3">Connecting…</span></span>;
  }
  const ng = status.netguard;
  const last = lastBlockedHost(status);
  const items: { key: string; state: LedState; label: ReactNode; short: ReactNode; title: string }[] = [
    {
      key: "mode",
      state: status.mode === "enforce" ? "brand" : "warn",
      label: status.mode === "enforce" ? "Enforce" : "Monitor",
      short: status.mode === "enforce" ? "Enforce" : "Monitor",
      title: `Policy ${status.policy}, ${status.mode} mode${status.mode === "monitor" ? ": decisions are logged, not enforced" : ""}`,
    },
    {
      key: "tavily",
      state: status.tavily === "live" ? "ok" : "info",
      label: <>Tavily {status.tavily === "live" ? "live" : "replay"}</>,
      short: "Tavily",
      title: status.tavily === "live" ? "Tavily: live API calls (inspected by LeakGate)" : "Tavily: replaying recorded responses (no API key, or offline)",
    },
    {
      key: "model",
      state: status.model_available ? "ok" : "warn",
      label: <>Local model {status.model_available ? "ready" : "off"}</>,
      short: "Model",
      title: status.model_available
        ? `Local model ready: ${status.model} on 127.0.0.1 (Ollama). Used for rewrites, the context layer and the agent.`
        : `Local model unavailable (${status.model}). Rewrites fall back to rules; the context layer and free-form prompts are off.`,
    },
    {
      key: "guard",
      state: ng?.installed ? "ok" : "warn",
      label: ng?.installed ? <>Socket guard · <span className="tnum">{ng.blocked}</span></> : "Socket guard off",
      short: <>Guard <span className="tnum">{ng?.installed ? ng.blocked : "off"}</span></>,
      title: ng?.installed
        ? `Socket guard: connections to hosts outside the allowlist fail even if code bypasses the SDK. ${ng.blocked} blocked${last ? `, last: ${last}` : ""}.`
        : "Socket guard is not installed in the API process.",
    },
  ];
  return (
    <ul className="readout flex h-8 min-w-0 items-center gap-0.5 px-1.5 sm:h-9 sm:px-2" aria-label="System status">
      {items.map((it) => (
        <li key={it.key} title={it.title}
          className={cx("flex shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11.5px] font-medium text-chrome-2", it.key === "mode" && "hidden sm:flex")}>
          <Led state={it.state} size="sm" pulse={it.key === "guard" && it.state === "ok"} />
          <span className="hidden 2xl:inline">{it.label}</span>
          <span className="2xl:hidden">{it.short}</span>
          <span className="sr-only">{`: ${it.title}`}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- phones: a row of keys at the bottom

function BottomKeys() {
  return (
    <nav aria-label="Main" className="fixed inset-x-2.5 bottom-2.5 z-40 md:hidden">
      <div className="rack flex items-stretch gap-1 p-1.5">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}
            className="rocker-key flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[9px] py-2 text-[10.5px] focus-visible:outline-offset-[-2px]">
            {({ isActive }) => (
              <>
                <span className={isActive ? "text-brand" : "text-chrome-3"} aria-hidden>{n.icon}</span>
                <span className="max-w-full truncate">{n.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
