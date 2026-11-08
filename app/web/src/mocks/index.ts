/**
 * In-browser stand-in for the LeakGate HTTP API (CONTRACTS.md §2). Loaded lazily by api/client.ts
 * only when the real API is unreachable. Sessions release their scripted events over time, every
 * egress decision is appended to a hash-linked demo ledger, and the Playground runs a small
 * rule-based inspector. All state lives in this tab and resets on reload.
 */
import { ApiError, DEMO_SESSION_PREFIX } from "../api/client";
import type {
  AgentEvent, CreateSessionRequest, Decision, InspectRequest, LedgerRecord, LedgerStatus, RunMode, SessionInfo,
  Status, TaintState,
} from "../api/types";
import { BENCH, MODEL, POLICY, SCENARIOS, VAULT } from "./data";
import { hex64 } from "./hash";
import { inspect } from "./inspector";
import { SCRIPTS, type Step } from "./scenarios";

// ---------------------------------------------------------------- ledger

const ledger: LedgerRecord[] = [];

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

function recordHash(r: LedgerRecord) {
  return hex64(canonical(r));
}

function appendLedger(d: Decision): number {
  const prev = ledger[ledger.length - 1];
  const rec: LedgerRecord = {
    seq: ledger.length + 1,
    ts: d.ts,
    session_id: d.session_id,
    request_id: d.request_id,
    tool: d.tool,
    channel: d.channel,
    destination: d.destination,
    action: d.action,
    kinds: [...new Set(d.findings.map((f) => f.kind))],
    attempted_hmac: hex64(`hmac|${canonical(d.attempted)}|${d.request_id}`),
    sent: d.sent,
    sent_url: d.sent_url ?? null,
    sent_sha256: d.sent ? hex64(canonical({ sent: d.sent, url: d.sent_url ?? null })) : null,
    findings: d.findings.length,
    prev_hash: prev ? recordHash(prev) : "0".repeat(64),
  };
  ledger.push(rec);
  return rec.seq;
}

function verifyLedger(): LedgerStatus {
  for (let i = 1; i < ledger.length; i++) {
    if (ledger[i].prev_hash !== recordHash(ledger[i - 1])) {
      return { ok: false, records: ledger.length, head: null, broken_at: ledger[i].seq };
    }
  }
  const last = ledger[ledger.length - 1];
  return { ok: true, records: ledger.length, head: last ? recordHash(last) : null, broken_at: null };
}

// ---------------------------------------------------------------- sessions

interface MockSession {
  info: SessionInfo;
  steps: Step[];
  startedAt: number;
  released: AgentEvent[];
  taint: TaintState;
}

const sessions = new Map<string, MockSession>();
let counter = 0;
/** raw connections the (simulated) socket guard refused */
const bypass: { dest: string; ts: string }[] = [];

const emptyTaint = (): TaintState => ({ private: false, untrusted: false, private_sources: [], untrusted_sources: [], lockdown: false });

function rid() {
  counter += 1;
  return `r-${Date.now().toString(36)}-${counter}`;
}

function newSession(scenario: string, mode: RunMode, startedAt = Date.now()): MockSession {
  const make = SCRIPTS[scenario];
  if (!make) throw new ApiError("not_found", `Unknown scenario "${scenario}".`, 404);
  const steps = make();
  if (mode === "live") {
    // Fixtures can't drive a live agent: say so in the run itself, then replay the script.
    steps.splice(1, 0, {
      at: 300, type: "info", title: "Demo data: replaying the scripted run",
      detail: "Live mode needs the LeakGate API and an agent. Start the API and this page switches over by itself.",
    });
  }
  counter += 1;
  const id = `${DEMO_SESSION_PREFIX}${scenario}-${Date.now().toString(36)}${counter}`;
  const s: MockSession = {
    info: {
      session_id: id, scenario, mode, status: "running", started: new Date(startedAt).toISOString(), events: 0, counts: {},
      taint: emptyTaint(),
    },
    steps, startedAt, released: [], taint: emptyTaint(),
  };
  sessions.set(id, s);
  return s;
}

/** Materialize every step whose time has come: assign seq/ts, apply taint, record decisions. */
function advance(s: MockSession, now = Date.now()) {
  while (s.released.length < s.steps.length) {
    const step = s.steps[s.released.length];
    const at = s.startedAt + step.at;
    if (at > now) break;
    const ts = new Date(at).toISOString();
    const t = s.taint;
    if (step.addPrivate) { t.private = true; t.private_sources = [...new Set([...t.private_sources, ...step.addPrivate])]; }
    if (step.addUntrusted) { t.untrusted = true; t.untrusted_sources = [...new Set([...t.untrusted_sources, ...step.addUntrusted])]; }
    t.lockdown = t.private && t.untrusted;
    const taint: TaintState = { ...t, private_sources: [...t.private_sources], untrusted_sources: [...t.untrusted_sources] };

    if (step.netguardBlock) bypass.push({ dest: step.netguardBlock, ts });
    let decision: Decision | null = null;
    if (step.decision) {
      decision = { ...step.decision, request_id: rid(), session_id: s.info.session_id, ts, taint, mode: POLICY.mode, ledger_seq: null };
      decision.ledger_seq = appendLedger(decision);
      s.info.counts[decision.action] = (s.info.counts[decision.action] ?? 0) + 1;
    }
    s.released.push({
      seq: s.released.length, session_id: s.info.session_id, ts, type: step.type, title: step.title,
      detail: step.detail ?? null, decision, taint, citations: step.citations ?? [],
    });
  }
  s.info.events = s.released.length;
  s.info.taint = s.released[s.released.length - 1]?.taint ?? emptyTaint();
  if (s.released.length === s.steps.length) s.info.status = "done";
}

// Seed the ledger with three earlier runs (not listed as sessions), so the Ledger page has history.
(function seed() {
  const base = Date.now() - 3 * 3600_000;
  Object.keys(SCRIPTS).forEach((name, i) => {
    const s = newSession(name, "scripted", base + i * 40 * 60_000);
    advance(s, Number.MAX_SAFE_INTEGER);
    sessions.delete(s.info.session_id);
  });
})();

// ---------------------------------------------------------------- status

function status(): Status {
  return {
    ok: true,
    mode: POLICY.mode,
    policy: POLICY.name,
    model: MODEL,
    model_available: true,
    tavily: "replay",
    use_context_model: POLICY.use_context_model,
    netguard: {
      installed: true,
      blocked: bypass.length,
      allowed_hosts: [...POLICY.destinations.map((d) => d.host), "localhost", "::1"],
      last_blocked: bypass.slice(-5).map((b) => b.dest),
    },
    bypass_attempts: bypass.slice(-5),
    ledger: verifyLedger(),
  };
}

// ---------------------------------------------------------------- router

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = () => wait(30 + Math.random() * 70);

function session(id: string): MockSession {
  const s = sessions.get(id);
  if (!s) throw new ApiError("not_found", "Session not found (demo sessions live only in this browser tab).", 404);
  advance(s);
  return s;
}

export async function mockRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  await latency();
  const url = new URL(path, "http://demo.local");
  const p = url.pathname.replace(/\/+$/, "");
  const m = p.match(/^\/api\/sessions\/([^/]+)(\/events)?$/);

  if (method === "GET" && p === "/api/status") return status();
  if (method === "GET" && p === "/api/scenarios") return clone(SCENARIOS);
  if (method === "POST" && p === "/api/sessions") {
    const b = (body ?? {}) as Partial<CreateSessionRequest>;
    const s = newSession(b.scenario ?? "research", b.mode === "live" ? "live" : "scripted");
    advance(s);
    return clone(s.info);
  }
  if (method === "GET" && p === "/api/sessions") {
    const all = [...sessions.values()];
    all.forEach((s) => advance(s));
    return clone(all.map((s) => s.info).reverse());
  }
  if (method === "GET" && m && !m[2]) return clone(session(decodeURIComponent(m[1])).info);
  if (method === "GET" && m && m[2]) {
    const after = Number(url.searchParams.get("after") ?? "-1");
    return clone(session(decodeURIComponent(m[1])).released.filter((e) => e.seq > after));
  }
  if (method === "POST" && p === "/api/inspect") {
    const req = body as InspectRequest;
    if (!req || typeof req !== "object" || !req.destination || !req.channel) {
      throw new ApiError("http", "channel and destination are required.", 422);
    }
    const d = inspect({ ...req, payload: req.payload ?? {} }, "playground", rid());
    d.ledger_seq = appendLedger(d);
    return d;
  }
  if (method === "GET" && p === "/api/ledger") {
    const limit = Number(url.searchParams.get("limit") ?? "200");
    return clone(ledger.slice(-limit).reverse());
  }
  if (method === "GET" && p === "/api/ledger/verify") return verifyLedger();
  if (method === "GET" && p === "/api/policy") return clone(POLICY);
  if (method === "GET" && p === "/api/vault") return clone(VAULT);
  if (method === "GET" && p === "/api/bench") return clone(BENCH);
  throw new ApiError("not_found", `No demo fixture for ${method} ${p}.`, 404);
}
