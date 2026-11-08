/**
 * A small in-browser stand-in for POST /api/inspect, used only when the API is unreachable.
 * It mimics the layer order and the Decision shape so the Inspector stays demoable offline.
 * It is NOT the product: no keyed hashes, no local model (the "context" layer is a keyword stand-in,
 * and rewrites are rule-based removals, labelled as such).
 *
 * The values below belong to the SYNTHETIC customer C-1042 of the fictional insurer Northwind Mutual
 * (agent/data/customers.json). They are only compared against, never rendered: every hit is shown
 * through the same masking the API applies.
 */
import type { Channel, Decision, Encoding, Finding, InspectRequest, Segment, Severity, TaintState } from "../api/types";
import { POLICY } from "./data";

interface VaultEntry { ref: string; kind: "private_record" | "confidential_term"; value: string; mask: (v: string) => string }

const words = (v: string) => v.replace(/[A-Za-z0-9]+/g, (w) => w[0] + "•".repeat(w.length - 1));
const last4 = (v: string) => v.replace(/\D/g, "").slice(-4);
/** "NWM-HO-448812" -> "N••-H•-••••••"; with keep=4 the last four digits stay: "C••-••••-••8734" */
const idMask = (v: string, keep = 0) => {
  const m = v.replace(/[A-Za-z]+/g, (w) => w[0] + "•".repeat(w.length - 1));
  let digits = v.replace(/\D/g, "").length - keep;
  return m.replace(/\d/g, (d) => (digits-- > 0 ? "•" : d));
};

const SYNTHETIC: VaultEntry[] = [
  { ref: "crm:C-1042.name", kind: "private_record", value: "Maria Okonkwo-Reyes", mask: words },
  { ref: "crm:C-1042.name", kind: "private_record", value: "Okonkwo-Reyes", mask: words },
  { ref: "crm:C-1042.ssn", kind: "private_record", value: "531-74-2290", mask: (v) => `•••-••-${last4(v)}` },
  { ref: "crm:C-1042.dob", kind: "private_record", value: "1961-03-14", mask: () => "••••-••-••" },
  { ref: "crm:C-1042.email", kind: "private_record", value: "maria.okreyes61@gmail.com", mask: () => "m•••@g••••.com" },
  { ref: "crm:C-1042.phone", kind: "private_record", value: "(561) 555-0142", mask: (v) => `(•••) •••-${last4(v)}` },
  { ref: "crm:C-1042.address", kind: "private_record", value: "2217 Ocean Breeze Ln", mask: words },
  { ref: "crm:C-1042.policy_number", kind: "private_record", value: "NWM-HO-448812", mask: (v) => idMask(v) },
  { ref: "crm:C-1042.claim_id", kind: "private_record", value: "CLM-2026-118734", mask: (v) => idMask(v, 4) },
  { ref: "crm:C-1042.card_on_file", kind: "private_record", value: "4539575436134020", mask: (v) => `•••• •••• •••• ${last4(v)}` },
  { ref: "policy:confidential_terms", kind: "confidential_term", value: "Project Bluefin", mask: words },
  { ref: "policy:confidential_terms", kind: "confidential_term", value: "Bluefin reserve model", mask: words },
  { ref: "policy:confidential_terms", kind: "confidential_term", value: "Q4 Florida exit", mask: words },
];
/** Values long enough in digits to recognise when they're spaced out, reversed or encoded. */
const DIGIT_ENTRIES = SYNTHETIC.filter((e) => e.value.replace(/\D/g, "").length >= 9);

const PATTERNS: { kind: string; re: RegExp; mask: (v: string) => string; severity: Severity }[] = [
  { kind: "api_key", re: /\b(?:sk-[A-Za-z0-9_-]{16,}|tvly-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b/g, mask: (v) => `${v.slice(0, 3)}••••••••${v.slice(-4)}`, severity: "critical" },
  { kind: "jwt", re: /\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g, mask: () => "eyJ••••.••••.••••", severity: "critical" },
  { kind: "private_key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, mask: () => "-----BEGIN •••• PRIVATE KEY-----", severity: "critical" },
  { kind: "password", re: /\bpassword\s*[:=]\s*\S+/gi, mask: () => "password=••••••", severity: "critical" },
  { kind: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g, mask: (v) => `•••-••-${last4(v)}`, severity: "high" },
  { kind: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, mask: (v) => `${v[0]}•••@${v.split("@")[1]?.[0] ?? ""}••••`, severity: "medium" },
  { kind: "phone", re: /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g, mask: (v) => `(•••) •••-${last4(v)}`, severity: "medium" },
];

const CONTEXT_HINTS: { kind: string; re: RegExp }[] = [
  { kind: "personal_context", re: /\b(chemotherapy|cancer|divorce|power of attorney|wheelchair|undergoing treatment)\b/i },
  { kind: "confidential_business", re: /\b(our (internal )?plan|stop renewing|pull out of florida|reserve model|unreleased)\b/i },
];

const LABEL: Record<string, string> = {
  private_record: "the customer's private data", confidential_term: "a confidential term", api_key: "an API key",
  jwt: "a token", private_key: "a private key", password: "a password", ssn: "a Social Security number",
  email: "an email address", phone: "a phone number", credit_card: "a card number",
  personal_context: "personal details", confidential_business: "confidential business details",
};

interface Hit extends Finding { mask?: string }

// ---------------------------------------------------------------- helpers

function flattenStrings(obj: unknown, prefix = ""): [string, string][] {
  if (typeof obj === "string") return [[prefix, obj]];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => flattenStrings(v, `${prefix}[${i}]`));
  if (obj && typeof obj === "object") {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => flattenStrings(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}

function mapStrings(obj: unknown, fn: (path: string, s: string) => string, prefix = ""): unknown {
  if (typeof obj === "string") return fn(prefix, obj);
  if (Array.isArray(obj)) return obj.map((v, i) => mapStrings(v, fn, `${prefix}[${i}]`));
  if (obj && typeof obj === "object") {
    return Object.fromEntries(Object.entries(obj as Record<string, unknown>)
      .map(([k, v]) => [k, mapStrings(v, fn, prefix ? `${prefix}.${k}` : k)]));
  }
  return obj;
}

function allIndexes(hay: string, needle: string): number[] {
  const out: number[] = [];
  const h = hay.toLowerCase();
  const n = needle.toLowerCase();
  for (let i = h.indexOf(n); i >= 0; i = h.indexOf(n, i + 1)) out.push(i);
  return out;
}

function tryBase64(token: string): string | null {
  try {
    const s = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
    return /^[\x20-\x7e]+$/.test(s) ? s : null;
  } catch {
    return null;
  }
}

function tryHex(token: string): string | null {
  if (token.length % 2) return null;
  const s = token.match(/../g)!.map((b) => String.fromCharCode(parseInt(b, 16))).join("");
  return /^[\x20-\x7e]+$/.test(s) ? s : null;
}

/** Find vault values inside an already-decoded string (plain text or digits-only comparison). */
function vaultIn(decoded: string): VaultEntry | undefined {
  const digits = decoded.replace(/\D/g, "");
  return SYNTHETIC.find((e) => decoded.toLowerCase().includes(e.value.toLowerCase()))
    ?? DIGIT_ENTRIES.find((e) => digits.length >= 9 && digits.includes(e.value.replace(/\D/g, "")));
}

const overlaps = (hits: Hit[], field: string, s: number, e: number) =>
  hits.some((h) => h.field === field && h.start !== null && h.end !== null && s < h.end && e > h.start);

// ---------------------------------------------------------------- layers

function scanField(field: string, text: string, hits: Hit[]) {
  // fingerprint: plain matches first, so the more specific hit wins over a generic pattern
  for (const e of SYNTHETIC) {
    for (const i of allIndexes(text, e.value)) {
      if (overlaps(hits, field, i, i + e.value.length)) continue;
      const m = e.mask(e.value);
      hits.push({
        layer: "fingerprint", kind: e.kind, field, start: i, end: i + e.value.length, preview: m, mask: m, encoding: "plain",
        source_ref: e.ref, severity: "high",
        explanation: e.kind === "confidential_term"
          ? "A confidential term from the policy list."
          : `Matches ${e.ref.split(".")[1]?.replace("_", " ")} from the CRM record the agent loaded.`,
      });
    }
  }
  // fingerprint: spaced / reversed digits
  for (const m of text.matchAll(/\d(?:[\s.\-()]*\d){8,}/g)) {
    const raw = m[0];
    const i = m.index ?? 0;
    if (overlaps(hits, field, i, i + raw.length)) continue;
    const digits = raw.replace(/\D/g, "");
    const rev = [...digits].reverse().join("");
    const e = DIGIT_ENTRIES.find((d) => { const v = d.value.replace(/\D/g, ""); return v === digits || v === rev; });
    if (!e) continue;
    const reversed = e.value.replace(/\D/g, "") !== digits;
    const encoding: Encoding = reversed ? "reversed" : /\s/.test(raw) ? "spaced" : "normalized";
    hits.push({
      layer: "fingerprint", kind: "private_record", field, start: i, end: i + raw.length, preview: e.mask(e.value),
      mask: "•".repeat(Math.min(raw.length, 12)), encoding, source_ref: e.ref, severity: "critical",
      explanation: `Digits ${reversed ? "written backwards" : "spread out"} still spell ${e.ref.split(".")[1]?.replace("_", " ")} from the CRM record.`,
    });
  }
  // fingerprint: base64 / hex / URL-encoded tokens
  for (const m of text.matchAll(/[A-Za-z0-9+/_%-]{8,}={0,2}/g)) {
    const tok = m[0];
    const i = m.index ?? 0;
    if (overlaps(hits, field, i, i + tok.length)) continue;
    let decoded: string | null = null;
    let encoding: Encoding = "base64";
    if (/%[0-9a-f]{2}/i.test(tok)) { try { decoded = decodeURIComponent(tok); encoding = "url"; } catch { /* not URL-encoded */ } }
    if (!decoded && /^[0-9a-f]{16,}$/i.test(tok)) { decoded = tryHex(tok); encoding = "hex"; }
    if (!decoded && /^[A-Za-z0-9+/_-]{8,}={0,2}$/.test(tok) && tok.length % 4 === 0) decoded = tryBase64(tok);
    if (!decoded) continue;
    const e = vaultIn(decoded);
    if (!e) continue;
    hits.push({
      layer: "fingerprint", kind: e.kind, field, start: i, end: i + tok.length, preview: e.mask(e.value),
      mask: `${tok.slice(0, 4)}${"•".repeat(Math.min(8, Math.max(2, tok.length - 8)))}${tok.slice(-4)}`, encoding,
      source_ref: e.ref, severity: "critical",
      explanation: `This decodes (${encoding}) to ${e.ref.split(".")[1]?.replace("_", " ") ?? "a private value"} from the CRM record.`,
    });
  }
  // pattern layer: things that look sensitive without knowing your data
  for (const p of PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      const i = m.index ?? 0;
      if (overlaps(hits, field, i, i + m[0].length)) continue;
      const masked = p.mask(m[0]);
      hits.push({
        layer: "pattern", kind: p.kind, field, start: i, end: i + m[0].length, preview: masked, mask: masked, encoding: "plain",
        source_ref: null, severity: p.severity, explanation: `Looks like ${LABEL[p.kind] ?? p.kind}.`,
      });
    }
  }
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

// ---------------------------------------------------------------- inspect

export function inspect(req: InspectRequest, sessionId: string, requestId: string): Decision {
  const t0 = performance.now();
  const layer_ms: Record<string, number> = {};
  const time = (name: string, fn: () => void) => { const s = performance.now(); fn(); layer_ms[name] = Math.round((performance.now() - s) * 1000) / 1000; };

  const destination = req.destination.trim().toLowerCase();
  const taint: TaintState = {
    private: !!req.private, untrusted: !!req.untrusted,
    private_sources: req.private ? ["crm:C-1042"] : [], untrusted_sources: req.untrusted ? ["https://claims-help-center.info/ale-flood-guide"] : [],
    lockdown: !!req.private && !!req.untrusted,
  };
  const fields: [string, string][] = [];
  if (req.url) fields.push(["url", req.url]);
  fields.push(...flattenStrings(req.payload));

  const hits: Hit[] = [];
  const rule = POLICY.destinations.find((d) => d.host === destination);
  const allowlisted = !!rule && rule.channels.includes(req.channel) && (!taint.lockdown || rule.allow_in_lockdown);

  // Once the agent has read private data, anything off the allowlist is blocked (before that it is only noted).
  const closed = taint.private;
  time("destination", () => {
    if (!allowlisted && closed) {
      hits.push({
        layer: "destination", kind: "not_allowlisted", field: "destination", start: null, end: null, preview: destination,
        encoding: "plain", source_ref: null, severity: "critical",
        explanation: taint.lockdown
          ? `${destination} is not an approved destination, and this agent has read private data and untrusted web content, so only approved places are allowed.`
          : `${destination} is not an approved destination, and this agent has read private data.`,
      });
    }
  });
  time("taint", () => {
    const fromWeb = (req.origin ?? "agent").startsWith("untrusted:");
    const urlHost = req.url ? hostOf(req.url) : null;
    const carriesData = !!req.url && /\?.+=.+/.test(req.url);
    if (taint.lockdown && !allowlisted && (fromWeb || carriesData) && urlHost) {
      hits.push({
        layer: "taint", kind: carriesData ? "exfil_url" : "untrusted_url", field: "url", start: null, end: null,
        preview: `${urlHost}/…`, encoding: "plain", source_ref: null, severity: carriesData ? "critical" : "high",
        explanation: carriesData
          ? "A URL to an unapproved host that carries data in its query string, sent while the session is in lockdown."
          : "This URL came from untrusted web content and points somewhere the policy doesn't approve.",
      });
    }
  });
  // patterns and fingerprints run in one pass, reported as "scan" like the engine does
  time("scan", () => { for (const [f, s] of fields) scanField(f, s, hits); });
  layer_ms.split = 0;

  const dataHits = () => hits.filter((h) => h.layer !== "destination" && h.layer !== "taint");
  if (dataHits().length === 0 && (taint.private || taint.untrusted)) {
    time("context", () => {
      for (const [f, s] of fields) {
        for (const c of CONTEXT_HINTS) {
          const m = s.match(c.re);
          if (!m || m.index === undefined) continue;
          const masked = words(m[0]);
          hits.push({
            layer: "context", kind: c.kind, field: f, start: m.index, end: m.index + m[0].length, preview: masked, mask: masked,
            encoding: "plain", source_ref: null, severity: "medium",
            explanation: `Demo stand-in for the local model: this phrase discloses ${LABEL[c.kind]}.`,
          });
        }
      }
    });
  }

  // order findings by layer, as the API does
  const order = ["destination", "taint", "pattern", "fingerprint", "context"];
  hits.sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer) || (a.start ?? 0) - (b.start ?? 0));

  // ---- decide
  const data = dataHits();
  const labels = [...new Set(data.map((h) => LABEL[h.kind] ?? h.kind.replace(/_/g, " ")))];
  const list = (xs: string[]) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  const encoded = data.find((h) => h.encoding !== "plain" && h.encoding !== "normalized");
  const blockKind = hits.find((h) => POLICY.block_kinds.includes(h.kind));
  const rewriteChannel = (POLICY.rewrite_channels as Channel[]).includes(req.channel);

  let action: Decision["action"] = "allow";
  let reason: string;
  if (closed && !allowlisted) {
    action = "block";
    reason = `Blocked: ${destination} is not an approved destination, and this agent has read private data`
      + (taint.lockdown ? " and untrusted web content" : "")
      + (data.length ? `; the request also carried ${list(labels)}${encoded ? ` (${encoded.encoding}-encoded)` : ""}.` : ".");
  } else if (blockKind || encoded) {
    action = "block";
    const h = blockKind ?? encoded!;
    reason = blockKind
      ? `Blocked: the request carried ${LABEL[h.kind] ?? h.kind.replace(/_/g, " ")}, which this policy never lets leave.`
      : `Blocked: the request carried ${LABEL[h.kind] ?? "private data"} in disguised form (${h.encoding}).`;
  } else if (data.length && !allowlisted) {
    action = "block";
    reason = `Blocked: ${destination} is not an approved destination, and the request carried ${list(labels)}.`;
  } else if (data.length) {
    action = rewriteChannel ? "rewrite" : "redact";
    reason = rewriteChannel
      ? `The query contained ${list(labels)}; LeakGate removed ${data.length === 1 ? "it" : "them"} and kept the research question.`
      : `${list(labels).replace(/^./, (c) => c.toUpperCase())} cut from the request before it left.`;
  } else {
    reason = allowlisted
      ? `${destination} is approved for ${req.channel}, and nothing private was found.`
      : `Nothing private was found. ${destination} isn't on the allowlist, which blocks only once the agent has read private data.`;
  }

  // ---- what the agent tried to send (masked segments) and what left
  const attempted: Record<string, Segment[]> = {};
  for (const [f, s] of fields) {
    const spans = hits.map((h, idx) => ({ h, idx })).filter(({ h }) => h.field === f && h.start !== null && h.end !== null)
      .sort((a, b) => a.h.start! - b.h.start!);
    const segs: Segment[] = [];
    let pos = 0;
    for (const { h, idx } of spans) {
      if (h.start! < pos) continue;
      if (h.start! > pos) segs.push({ text: s.slice(pos, h.start!), finding: null });
      segs.push({ text: h.mask ?? h.preview, finding: idx });
      pos = h.end!;
    }
    if (pos < s.length) segs.push({ text: s.slice(pos), finding: null });
    attempted[f] = segs;
  }

  const clean = (path: string, s: string) => {
    const spans = data.filter((h) => h.field === path && h.start !== null).sort((a, b) => b.start! - a.start!);
    let out = s;
    for (const h of spans) out = out.slice(0, h.start!) + (action === "redact" ? `[${h.kind}]` : "") + out.slice(h.end!);
    return action === "rewrite" ? out.replace(/\s{2,}/g, " ").replace(/\s+([,.;:?!])/g, "$1").replace(/^[\s,.;:]+|[\s,;:]+$/g, "") : out;
  };
  let sent: Record<string, unknown> | null = null;
  let sent_url: string | null = null;
  if (action !== "block") {
    sent = (action === "allow" ? req.payload : mapStrings(req.payload, clean)) as Record<string, unknown>;
    if (req.url) sent_url = action === "allow" ? req.url : clean("url", req.url);
  }

  const findings: Finding[] = hits.map((h) => { const { mask, ...f } = h; void mask; return f; });
  return {
    request_id: requestId, session_id: sessionId, channel: req.channel, tool: req.tool, destination, action, reason,
    findings, attempted, sent, sent_url, rewritten_by: action === "rewrite" ? "rules" : null, taint, mode: POLICY.mode,
    latency_ms: Math.round((performance.now() - t0) * 1000) / 1000, layer_ms, ts: new Date().toISOString(), ledger_seq: null,
  };
}
