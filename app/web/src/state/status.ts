/**
 * /api/status, shared by the top bar and the sidebar. Polled while anything is subscribed, so the
 * pills notice the API (or the local model) coming and going during a demo.
 */
import { useSyncExternalStore } from "react";
import { api, ApiError } from "../api/client";
import type { Status } from "../api/types";

interface StatusState {
  status: Status | null;
  error: ApiError | null;
  loading: boolean;
}

const POLL_MS = 8000;
let state: StatusState = { status: null, error: null, loading: true };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

function set(next: Partial<StatusState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export async function refreshStatus() {
  if (inflight) return;
  inflight = true;
  try {
    set({ status: await api.status(), error: null, loading: false });
  } catch (e) {
    set({ error: e instanceof ApiError ? e : new ApiError("http", String(e)), loading: false });
  } finally {
    inflight = false;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    void refreshStatus();
    timer = setInterval(() => void refreshStatus(), POLL_MS);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
}

export function useStatus(): StatusState {
  return useSyncExternalStore(subscribe, () => state);
}

/** "3 hosts" whether the API sends a list or a count. */
export function allowedHostCount(s: Status | null): number | null {
  const a = s?.netguard?.allowed_hosts;
  if (Array.isArray(a)) return a.length;
  return typeof a === "number" ? a : null;
}

/** The most recent socket-guard refusal ("claims-verify.net:443"), from netguard or bypass_attempts. */
export function lastBlockedHost(s: Status | null): string | null {
  const lb = s?.netguard?.last_blocked;
  if (Array.isArray(lb) && lb.length) return String(lb[lb.length - 1]);
  if (typeof lb === "string" && lb) return lb;
  const b = s?.bypass_attempts;
  return b?.length ? b[b.length - 1].dest : null;
}
