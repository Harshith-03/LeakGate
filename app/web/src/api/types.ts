/**
 * Hand-written mirror of `leakgate/schema.py` (THE contract) and CONTRACTS.md §2-3.
 * If the two disagree, schema.py wins: fix this file. Optional[...] fields arrive as `null`.
 *
 * Privacy rule baked into the shapes: nothing here carries a raw sensitive value. Findings carry a
 * masked `preview`, `attempted` is pre-masked display segments, and `sent` is what actually left.
 */

export type Channel = "search" | "extract" | "http" | "llm" | "tool";
export type Action = "allow" | "rewrite" | "redact" | "block";
export type Severity = "low" | "medium" | "high" | "critical";
export type Layer = "destination" | "taint" | "pattern" | "fingerprint" | "context";
export type Encoding =
  | "plain" | "normalized" | "url" | "base64" | "hex" | "spaced" | "words" | "split" | "unicode" | "reversed";
export type PolicyMode = "enforce" | "monitor";
export type RunMode = "scripted" | "live";

export const CHANNELS: Channel[] = ["search", "extract", "http", "llm", "tool"];
export const LAYERS: Layer[] = ["destination", "taint", "pattern", "fingerprint", "context"];

// Finding kinds. Patterns find the first group without knowing your data; the vault (fingerprint
// layer) finds the second because it knows what the agent has read.
export const PATTERN_KINDS = ["ssn", "credit_card", "email", "phone", "iban", "api_key", "private_key", "jwt",
  "password", "ip_address", "dob"] as const;
export const FINGERPRINT_KINDS = ["private_record", "confidential_term", "private_passage"] as const;
export const CONTEXT_KINDS = ["personal_context", "confidential_business"] as const;
export const POLICY_KINDS = ["not_allowlisted", "untrusted_url", "exfil_url", "split_leak"] as const;

export interface Finding {
  layer: Layer;
  kind: string;
  /** payload path: "query", "params.d", "url", "body.messages[0].content" */
  field: string;
  /** offset in the ORIGINAL field string; null if only found decoded/split */
  start: number | null;
  end: number | null;
  /** masked, e.g. "•••-••-6789"; never the raw value */
  preview: string;
  encoding: Encoding;
  /** vault reference "crm:C-1042.ssn" (field name, never the value) */
  source_ref: string | null;
  severity: Severity;
  explanation: string;
}

/** Display text for "what the agent tried to send". Sensitive parts are already masked. */
export interface Segment {
  text: string;
  /** index into Decision.findings when this segment is a hit */
  finding: number | null;
}

export interface TaintState {
  private: boolean;
  untrusted: boolean;
  private_sources: string[];
  untrusted_sources: string[];
  /** computed: private && untrusted (the "lethal trifecta" guard) */
  lockdown: boolean;
}

export interface Decision {
  request_id: string;
  session_id: string;
  channel: Channel;
  tool: string;
  destination: string;
  action: Action;
  /** one plain-English sentence for the UI */
  reason: string;
  findings: Finding[];
  /** field path -> masked segments */
  attempted: Record<string, Segment[]>;
  /** exactly what left; null when blocked */
  sent: Record<string, unknown> | null;
  /** the URL that left (http/extract), path and query included */
  sent_url?: string | null;
  rewritten_by: "model" | "rules" | null;
  taint: TaintState;
  mode: PolicyMode;
  latency_ms: number;
  layer_ms: Record<string, number>;
  ts: string;
  ledger_seq: number | null;
}

export interface DestinationRule {
  host: string;
  channels: Channel[];
  purpose: string;
  allow_in_lockdown: boolean;
}

export interface Policy {
  name: string;
  mode: PolicyMode;
  destinations: DestinationRule[];
  block_kinds: string[];
  rewrite_channels: Channel[];
  use_context_model: boolean;
  /** masked by the API, e.g. "Project B••••••" */
  confidential_terms: string[];
}

export interface LedgerRecord {
  seq: number;
  ts: string;
  session_id: string;
  request_id: string;
  tool: string;
  channel: Channel;
  destination: string;
  action: Action;
  kinds: string[];
  /** HMAC-SHA256 (install key) of the canonical attempted payload */
  attempted_hmac: string;
  /** the payload that actually left (clean by construction) */
  sent: Record<string, unknown> | null;
  /** the URL that actually left, if any */
  sent_url?: string | null;
  sent_sha256: string | null;
  findings: number;
  prev_hash: string;
}

export interface LedgerStatus {
  ok: boolean;
  records: number;
  head: string | null;
  /** seq of the first record that fails verification */
  broken_at: number | null;
}

export type EventType = "task" | "thought" | "tool_call" | "tool_result" | "egress" | "answer" | "error" | "info";

export interface Citation { title: string; url: string }

export interface AgentEvent {
  seq: number;
  session_id: string;
  ts: string;
  type: EventType;
  title: string;
  /** masked text */
  detail: string | null;
  decision: Decision | null;
  taint: TaintState;
  /** [{title, url}] on answer events */
  citations: Citation[];
}

export interface SessionInfo {
  session_id: string;
  scenario: string;
  mode: RunMode;
  status: "running" | "done" | "error";
  started: string;
  events: number;
  /** action -> number of egress decisions */
  counts: Partial<Record<Action, number>>;
  taint: TaintState;
}

export interface ScenarioInfo {
  name: string;
  title: string;
  description: string;
  modes: RunMode[];
}

export interface VaultSource {
  source: string;
  fields: string[];
  fingerprints: number;
}

/** What the gate knows, WITHOUT values: sources, field names and fingerprint counts. */
export interface VaultSummary {
  sources: VaultSource[];
  confidential_terms: number;
  fingerprints: number;
  /** first 8 hex chars of sha256(install key): identifies the key, reveals nothing */
  key_id: string;
}

// ---------------------------------------------------------------- HTTP-only shapes (CONTRACTS.md §2)

export interface NetguardStatus {
  installed: boolean;
  blocked: number;
  /** hosts the socket guard lets through (policy hosts + loopback; may repeat) */
  allowed_hosts: string[] | number;
  /** recent refusals as "host:port", oldest first (a single string or null is also accepted) */
  last_blocked: string[] | string | null;
}

export interface BypassAttempt { dest: string; ts: string }

export interface Status {
  ok: boolean;
  mode: PolicyMode;
  /** policy name, e.g. "northwind-claims-agent" */
  policy: string;
  model: string;
  model_available: boolean;
  tavily: "live" | "replay";
  netguard: NetguardStatus;
  ledger: LedgerStatus;
  use_context_model?: boolean;
  /** raw connections that skipped the SDK and were refused by the socket guard (latest few) */
  bypass_attempts?: BypassAttempt[];
}

/**
 * `POST /api/sessions`. A guided demo is `{scenario: "research" | "injection" | "insider", mode}`.
 * A free-form prompt is `{scenario: "custom", mode: "live", prompt, plant_poison}`: the local model drives a
 * LangGraph agent (lookup_customer, web_search, fetch_url, send_message) behind the gate. The API answers
 * 400 `{detail}` for an empty prompt or one over PROMPT_MAX characters.
 */
export interface CreateSessionRequest {
  scenario: string;
  mode: RunMode;
  /** custom only: what the user typed (max PROMPT_MAX characters) */
  prompt?: string;
  /** custom only: plant a red-team page with hidden instructions in the search results */
  plant_poison?: boolean;
}

export const CUSTOM_SCENARIO = "custom";
export const PROMPT_MAX = 2000;

/** `GET /api/presets`: suggested prompts for the prompt console. */
export interface Preset {
  title: string;
  prompt: string;
  plant_poison: boolean;
}

export interface InspectRequest {
  channel: Channel;
  tool: string;
  destination: string;
  url?: string | null;
  payload: Record<string, unknown>;
  origin?: string;
  private?: boolean;
  untrusted?: boolean;
}

// ---------------------------------------------------------------- benchmark (CONTRACTS.md §3)

export interface BenchCategoryScore { n: number; correct: number; blocked?: number }

export interface BenchSystem {
  name: string;
  label: string;
  /** null when the run had no cases of that type */
  catch_rate: number | null;
  false_alarm_rate: number | null;
  utility: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  per_category: Record<string, BenchCategoryScore>;
  n_leak_cases?: number;
  n_benign_cases?: number;
  errors?: number;
  wall_s?: number;
  model_available?: boolean;
}

export interface BenchExample {
  case_id: string;
  category: string;
  description: string;
  /** system name -> leaked | blocked | rewritten | redacted | cleaned | allowed | altered | error (| "n/a") */
  outcomes: Record<string, string>;
}

export interface BenchReport {
  available: true;
  run_at: string;
  n_cases: number;
  model: string;
  /** category key -> human label */
  categories: Record<string, string>;
  /** category key -> number of cases */
  category_counts?: Record<string, number>;
  /** "cold" | "warm": whether the local model's cache was primed (affects latency) */
  llm_cache?: string;
  systems: BenchSystem[];
  examples: BenchExample[];
}

export type BenchResponse = BenchReport | { available: false; detail?: string };
