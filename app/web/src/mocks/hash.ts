/**
 * Demo-only stand-ins for the ledger's SHA-256 / HMAC hex strings. Deterministic and synchronous
 * so the fixture chain links up; NOT cryptographic. The real API computes the real hashes.
 */
function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** 64 hex chars, like a SHA-256 digest. */
export function hex64(s: string): string {
  let out = "";
  // 53-bit values: keep the low 13 hex digits (uniform), 5 rounds -> 65, trimmed to 64.
  for (let i = 0; i < 5; i++) out += cyrb53(s, 0x9e3779b1 * (i + 1)).toString(16).padStart(14, "0").slice(-13);
  return out.slice(0, 64);
}
