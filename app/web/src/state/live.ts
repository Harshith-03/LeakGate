/**
 * The Live page's run: create a session, then poll its events every ~400 ms until it is done.
 * Kept outside React so a run keeps streaming while you look at the Ledger and come back.
 */
import { useSyncExternalStore } from "react";
import { api, ApiError } from "../api/client";
import type { AgentEvent, Decision, RunMode, SessionInfo, TaintState } from "../api/types";
import { refreshStatus } from "./status";

export interface LiveState {
  session: SessionInfo | null;
  events: AgentEvent[];
  /** true while polling */
  running: boolean;
  starting: boolean;
  error: string | null;
  /** request_id of decisions that arrived while this tab was watching (they animate in) */
  fresh: Set<string>;
}

const POLL_MS = 400;
let state: LiveState = { session: null, events: [], running: false, starting: false, error: null, fresh: new Set() };
const listeners = new Set<() => void>();
let runToken = 0;
let restored = false;

function set(next: Partial<LiveState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function useLive(): LiveState {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => state,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));

async function poll(token: number, sessionId: string, animate: boolean) {
  set({ running: true });
  let failures = 0;
  while (token === runToken) {
    try {
      const after = state.events.length ? state.events[state.events.length - 1].seq : -1;
      const [evs, info] = await Promise.all([api.events(sessionId, after), api.session(sessionId)]);
      if (token !== runToken) return;
      failures = 0;
      const seen = new Set(state.events.map((e) => e.seq));
      const added = evs.filter((e) => !seen.has(e.seq)).sort((a, b) => a.seq - b.seq);
      const fresh = new Set(state.fresh);
      if (animate) added.forEach((e) => e.decision && fresh.add(e.decision.request_id));
      set({ events: added.length ? [...state.events, ...added] : state.events, session: info, fresh, error: null });
      // Done only once the server says so AND we've drained every event it reported.
      if (info.status !== "running" && added.length === 0) break;
    } catch (e) {
      if (token !== runToken) return;
      failures += 1;
      if (failures >= 8) { set({ error: `Lost the session: ${msg(e)}` }); break; }
    }
    await sleep(POLL_MS);
  }
  if (token === runToken) {
    set({ running: false });
    void refreshStatus();
  }
}

export async function startRun(scenario: string, mode: RunMode) {
  const token = ++runToken;
  set({ starting: true, error: null, session: null, events: [], fresh: new Set() });
  try {
    const session = await api.createSession({ scenario, mode });
    if (token !== runToken) return;
    set({ session, starting: false });
    void poll(token, session.session_id, true);
  } catch (e) {
    if (token === runToken) set({ starting: false, error: msg(e) });
  }
}

/** On first visit, show the newest run (if any) so a refresh mid-demo doesn't blank the screen. */
export async function restoreLatest() {
  if (restored || state.session || state.starting) return;
  restored = true;
  try {
    const list = await api.sessions();
    const latest = list[0];
    if (!latest || state.session || state.starting) return;
    const token = ++runToken;
    set({ session: latest, events: [], fresh: new Set() });
    void poll(token, latest.session_id, false);
  } catch { /* nothing to restore */ }
}

export function clearRun() {
  runToken++;
  set({ session: null, events: [], running: false, starting: false, error: null, fresh: new Set() });
}

// ---------------------------------------------------------------- derived

export function decisionsOf(events: AgentEvent[]): Decision[] {
  return events.flatMap((e) => (e.type === "egress" && e.decision ? [e.decision] : []));
}

export function countsOf(decisions: Decision[]) {
  const c = { allow: 0, rewrite: 0, redact: 0, block: 0, monitored: 0 };
  for (const d of decisions) {
    c[d.action] += 1;
    if (d.mode === "monitor" && d.action !== "allow") c.monitored += 1;
  }
  return c;
}

const EMPTY_TAINT: TaintState = { private: false, untrusted: false, private_sources: [], untrusted_sources: [], lockdown: false };

/** Taint only ever grows during a run; take the latest event's, falling back to the session's. */
export function taintOf(events: AgentEvent[], session: SessionInfo | null): TaintState {
  const t = events.length ? events[events.length - 1].taint : session?.taint;
  if (!t) return EMPTY_TAINT;
  return { ...EMPTY_TAINT, ...t, lockdown: t.lockdown ?? (t.private && t.untrusted) };
}
