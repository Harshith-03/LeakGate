import type { Action, Channel, Encoding, Layer, Severity } from "../api/types";

export const ACTION_LABEL: Record<Action, string> = {
  allow: "Allowed",
  rewrite: "Rewritten",
  redact: "Redacted",
  block: "Blocked",
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  search: "Search",
  extract: "Extract",
  http: "HTTP",
  llm: "LLM",
  tool: "Tool",
};

export const LAYER_LABEL: Record<Layer, string> = {
  destination: "Destination",
  taint: "Taint",
  pattern: "Pattern",
  fingerprint: "Fingerprint",
  context: "Context (local model)",
};

export const LAYER_HINT: Record<Layer, string> = {
  destination: "Is this host approved for this kind of call?",
  taint: "Did the URL or its arguments come from untrusted web content?",
  pattern: "Things that look sensitive without knowing your data (SSNs, cards, keys…)",
  fingerprint: "Keyed-hash match against the private data the agent has read, including encoded forms",
  context: "The local model's read on paraphrases and unreleased plans",
};

export const ENCODING_LABEL: Record<Encoding, string> = {
  plain: "Plain text",
  normalized: "Normalized",
  url: "URL-encoded",
  base64: "Base64",
  hex: "Hex",
  spaced: "Spaced-out digits",
  words: "Number words",
  split: "Split across calls",
  unicode: "Unicode look-alikes",
  reversed: "Reversed",
};

export const KIND_LABEL: Record<string, string> = {
  ssn: "SSN",
  credit_card: "Card number",
  email: "Email",
  phone: "Phone",
  iban: "IBAN",
  api_key: "API key",
  private_key: "Private key",
  jwt: "JWT",
  password: "Password",
  ip_address: "IP address",
  dob: "Date of birth",
  private_record: "Private record",
  confidential_term: "Confidential term",
  private_passage: "Private passage",
  personal_context: "Personal context",
  confidential_business: "Confidential business",
  not_allowlisted: "Not allowlisted",
  untrusted_url: "Untrusted URL",
  exfil_url: "Exfiltration URL",
  split_leak: "Split leak",
};

export const kindLabel = (k: string) => KIND_LABEL[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export const SEVERITY_LABEL: Record<Severity, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };

export const SCENARIO_FALLBACK_TITLE: Record<string, string> = {
  research: "Research a customer's claim",
  injection: "Poisoned search result",
  insider: "Codename, upload and split leak",
};

/** "0.42 ms", "38 ms", "1.24 s" */
export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "–";
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 2)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  if (ms >= 0.01) return `${ms.toFixed(2)} ms`;
  return "<0.01 ms";
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtTime(iso: string | null | undefined, withSeconds = true): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Leading characters of a hash, enough to eyeball a chain link. */
export const shortHash = (h: string | null | undefined, n = 10) => (h ? `${h.slice(0, n)}…` : "–");

/** Flatten a payload to [path, value] rows ("params.d", "messages[0].content"), matching Finding.field paths. */
export function flatten(obj: unknown, prefix = ""): [string, unknown][] {
  if (Array.isArray(obj)) {
    if (obj.length === 0) return [[prefix, "[]"]];
    return obj.flatMap((v, i) => flatten(v, `${prefix}[${i}]`));
  }
  if (obj && typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return prefix ? [[prefix, "{}"]] : [];
    return entries.flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
  }
  return [[prefix, obj]];
}

export const valueText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
