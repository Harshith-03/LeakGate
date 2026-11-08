/**
 * The only place the UI talks to the network. Every call is a same-origin `/api/...` request
 * (proxied to the LeakGate API on 127.0.0.1:8100 by Vite), so the browser never contacts another host.
 *
 * Demo-data fallback: when the API is unreachable (connection refused, the dev proxy's 5xx, or an
 * HTML page where JSON was expected) the same call is answered by the in-browser fixtures in
 * `src/mocks/`, and the top bar shows a "Demo data" badge. The next probe after a short back-off
 * goes to the real API again, so starting the API mid-demo switches the UI over by itself.
 *
 *   ?demo=1 in the URL or VITE_DEMO=1   always use the fixtures
 *   VITE_NO_MOCKS=1                     never fall back (pages show "API offline")
 */
import { useSyncExternalStore } from "react";
import type {
  AgentEvent, BenchResponse, CreateSessionRequest, Decision, InspectRequest, LedgerRecord, LedgerStatus,
  Policy, Preset, ScenarioInfo, SessionInfo, Status, VaultSummary, Workspace,
} from "./types";

export type ApiErrorKind = "offline" | "not_found" | "http";

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

// ---------------------------------------------------------------- data source (live API vs demo fixtures)

export type DataSource = "unknown" | "live" | "demo";

const FORCE_DEMO = (() => {
  if (import.meta.env.VITE_DEMO === "1") return true;
  try {
    return new URLSearchParams(window.location.search).get("demo") === "1";
  } catch {
    return false;
  }
})();
const NO_MOCKS = import.meta.env.VITE_NO_MOCKS === "1";
/** After a failed call, skip the network for this long so 400 ms polling doesn't hammer a dead port. */
const OFFLINE_BACKOFF_MS = 5000;

let source: DataSource = FORCE_DEMO ? "demo" : "unknown";
let offlineUntil = 0;
const listeners = new Set<() => void>();

function setSource(next: DataSource) {
  if (next === source) return;
  source = next;
  listeners.forEach((l) => l());
}

/** "live" once the real API answered, "demo" while the fixtures are standing in. */
export function useDataSource(): DataSource {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => source,
  );
}

/** Session ids minted by the fixtures; they only exist in this tab, so they always stay on the mocks. */
export const DEMO_SESSION_PREFIX = "demo-";

async function viaMocks<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { mockRequest } = await import("../mocks");
  setSource("demo");
  return mockRequest(method, path, body) as Promise<T>;
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const demoSession = path.includes(`/sessions/${DEMO_SESSION_PREFIX}`);
  if (FORCE_DEMO || demoSession || (!NO_MOCKS && Date.now() < offlineUntil)) {
    return viaMocks<T>(method, path, init.body);
  }

  const offline = (status?: number): Promise<T> => {
    if (NO_MOCKS) throw new ApiError("offline", "The LeakGate API is not reachable.", status);
    offlineUntil = Date.now() + OFFLINE_BACKOFF_MS;
    return viaMocks<T>(method, path, init.body);
  };

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    return offline();
  }

  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  // Nothing listening behind the proxy (5xx, non-JSON), or no proxy at all (the SPA's index.html).
  if ((!res.ok && !isJson && res.status >= 500) || (res.ok && !isJson)) return offline(res.status);

  offlineUntil = 0;
  setSource("live");
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const b = await res.json();
      detail = typeof b?.detail === "string" ? b.detail : JSON.stringify(b?.detail ?? b);
    } catch { /* keep statusText */ }
    throw new ApiError(res.status === 404 ? "not_found" : "http", detail || `HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

export const api = {
  status: () => request<Status>("/api/status"),
  scenarios: () => request<ScenarioInfo[]>("/api/scenarios"),
  presets: (workspace: Workspace = "insurance") => request<Preset[]>(`/api/presets?workspace=${workspace}`),
  createSession: (body: CreateSessionRequest) => request<SessionInfo>("/api/sessions", { method: "POST", body }),
  sessions: () => request<SessionInfo[]>("/api/sessions"),
  session: (id: string) => request<SessionInfo>(`/api/sessions/${enc(id)}`),
  events: (id: string, after: number) => request<AgentEvent[]>(`/api/sessions/${enc(id)}/events?after=${after}`),
  inspect: (body: InspectRequest) => request<Decision>("/api/inspect", { method: "POST", body }),
  ledger: (limit = 200) => request<LedgerRecord[]>(`/api/ledger?limit=${limit}`),
  verifyLedger: () => request<LedgerStatus>("/api/ledger/verify"),
  policy: () => request<Policy>("/api/policy"),
  vault: () => request<VaultSummary>("/api/vault"),
  bench: () => request<BenchResponse>("/api/bench"),
};
