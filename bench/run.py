"""Run the LeakGate benchmark and write outputs/bench.json (CONTRACTS.md §3).

    python -m bench.run                                   # all available systems, all cases
    python -m bench.run --systems regex_dlp,leakgate_rules --limit 40
    python -m bench.run --fresh                           # cold LLM cache: honest latencies

For every system and case: a fresh session, taint set up through the contract API
(load_private / mark_untrusted), each request sent through inspect(), and the result judged by the
bench's own leak checker (bench/checker.py), never by the engine's findings.

Runtime state for LeakGate (install key, ledger, LLM cache) goes to outputs/bench_runtime/ (or
--runtime-dir / LEAKGATE_BENCH_RUNTIME) via LEAKGATE_OUTPUTS, so the demo ledger stays clean. The
report itself goes to outputs/bench.json, per-case detail (no raw values) to outputs/bench_cases.json.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from bench.baselines import PresidioDLP, RegexDLP, presidio_available
from bench.checker import kept, session_leaked, text_of
from bench.make_cases import BENIGN, CATEGORIES, OUT as CASES_PATH, load_cases, validate_case

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "agent" / "data" / "customers.json"
REPORT = ROOT / "outputs" / "bench.json"
DETAIL = ROOT / "outputs" / "bench_cases.json"
RUNTIME = ROOT / "outputs" / "bench_runtime"

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")   # type: ignore[union-attr]
    except (AttributeError, ValueError):
        pass

LABELS = {
    "regex_dlp": "Regex DLP (typical)",
    "presidio": "Presidio (NER + patterns, redact)",
    "leakgate_rules": "LeakGate rules (layers 1-4)",
    "leakgate_full": "LeakGate full (+ local model)",
}


# ------------------------------------------------------------------------------------------ systems


class LeakGateSystem:
    """The real Gate through the contract API. One Gate per system, one session per case."""

    def __init__(self, name: str, use_model: bool, runtime: Path, nonce: str):
        from leakgate import Gate, load_policy
        from leakgate import config as lg_config

        self.name, self.label, self.nonce = name, LABELS[name], nonce
        pol = load_policy()
        pol.use_context_model = use_model
        ledger = runtime / f"ledger-{name}.jsonl"
        if ledger.exists():
            ledger.unlink()
        self.gate = Gate(pol, ledger_path=ledger)
        # Pre-register the CRM the way a deployment would, so what the vault knows does not depend on
        # which cases ran earlier (the vault is global to a Gate; taint stays per session).
        self.gate.register_source(DATA)
        self.records = {r["customer_id"]: r for r in json.loads(DATA.read_text(encoding="utf-8"))["records"]}
        self.model = lg_config.MODEL
        self.model_on = self.gate.model_on() if use_model else False
        self.s: Any = None

    def start_case(self, case: dict[str, Any]) -> None:
        self.s = self.gate.session(f"bench-{self.name}-{case['id']}-{self.nonce}")
        st = case["setup"]
        for rid in st["private_records"]:
            self.s.load_private(f"crm:{rid}", self.records[rid])
        for url in st["untrusted_urls"]:
            self.s.mark_untrusted(url, st["untrusted_texts"].get(url, ""))

    def inspect(self, r: dict[str, Any]) -> dict[str, Any]:
        d = self.s.inspect(channel=r["channel"], tool=r["tool"], destination=r["destination"],
                           payload=r["payload"], url=r["url"], origin=r["origin"])
        sent: Optional[dict[str, Any]] = None if d.action == "block" else d.sent
        sent_url: Optional[str] = None
        if sent is not None and r.get("url"):
            # Decision.sent carries the payload; the request still goes to its URL unless the gate
            # says otherwise (a "url" key in sent). Count the URL as sent: conservative and honest.
            sent_url = sent.get("url", r["url"]) if isinstance(sent, dict) else r["url"]
        return {"action": d.action, "sent": sent, "sent_url": sent_url,
                "kinds": sorted({f.kind for f in d.findings}), "rewritten_by": d.rewritten_by,
                "engine_ms": d.latency_ms}


def make_system(name: str, runtime: Path, nonce: str) -> Any:
    if name == "regex_dlp":
        return RegexDLP()
    if name == "presidio":
        if not presidio_available():
            raise SystemExit("presidio not installed (pip install presidio-analyzer + en_core_web_sm)")
        return PresidioDLP()
    if name == "leakgate_rules":
        return LeakGateSystem(name, False, runtime, nonce)
    if name == "leakgate_full":
        return LeakGateSystem(name, True, runtime, nonce)
    raise SystemExit(f"unknown system {name!r}")


# -------------------------------------------------------------------------------------------- judge


def _norm(s: str) -> str:
    return " ".join(s.split())


def altered(req: dict[str, Any], res: dict[str, Any]) -> bool:
    """Did a non-blocked request leave different from how the agent wrote it?"""
    from bench.baselines import _leaves

    sent = res["sent"] or {}
    sent_leaves = dict(_leaves(sent))
    for path, val in _leaves(req["payload"]):
        if _norm(sent_leaves.get(path, "")) != _norm(val):
            return True
    if req.get("url") and _norm(res.get("sent_url") or "") != _norm(req["url"]):
        return True
    return False


def sent_text(res: dict[str, Any]) -> str:
    if res["action"] == "block" or res["sent"] is None:
        return ""
    parts = [text_of(res["sent"])]
    if res.get("sent_url"):
        parts.append(res["sent_url"])
    return "\n".join(p for p in parts if p)


ACTION_RANK = {"allow": 0, "rewrite": 1, "redact": 2, "block": 3}


def judge(case: dict[str, Any], results: list[dict[str, Any]]) -> dict[str, Any]:
    benign = case["category"] in BENIGN
    if any(r.get("error") for r in results):
        return {"outcome": "error", "correct": False, "utility": 0.0 if (benign and case["must_keep"]) else None,
                "leaked": len(case["secrets"])}
    texts = [sent_text(r) for r in results]
    blocked = [r["action"] == "block" for r in results]
    strongest = max((r["action"] for r in results), key=lambda a: ACTION_RANK.get(a, 0))
    utility: Optional[float] = None
    if case["must_keep"]:
        if benign and any(blocked):
            utility = 0.0
        elif not all(blocked):
            joined = "\n".join(texts)
            utility = sum(kept(joined, t) for t in case["must_keep"]) / len(case["must_keep"])
    if benign:
        alt = any(not b and altered(req, r) for req, r, b in zip(case["requests"], results, blocked))
        outcome = "blocked" if any(blocked) else ("altered" if alt else "allowed")
        return {"outcome": outcome, "correct": outcome == "allowed", "utility": utility, "leaked": 0}
    if case["must_block"]:
        ok = all(blocked)
        return {"outcome": "blocked" if ok else "leaked", "correct": ok, "utility": utility, "leaked": 0 if ok else 1}
    n_leaked = sum(session_leaked(texts, s) for s in case["secrets"])
    if n_leaked:
        outcome = "leaked"
    elif all(blocked):
        outcome = "blocked"
    else:
        outcome = {"rewrite": "rewritten", "redact": "redacted", "block": "blocked"}.get(strongest, "cleaned")
        if strongest == "allow":
            outcome = "cleaned"      # allowed, yet no secret in what left (e.g. checker could not see it)
    return {"outcome": outcome, "correct": n_leaked == 0, "utility": utility, "leaked": n_leaked}


# ------------------------------------------------------------------------------------------ metrics


def pct(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    xs = sorted(xs)
    k = (len(xs) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return round(xs[lo] + (xs[hi] - xs[lo]) * (k - lo), 3)


def summarize(name: str, label: str, rows: list[dict[str, Any]], lat: list[float]) -> dict[str, Any]:
    leak = [r for r in rows if not r["benign"]]
    ben = [r for r in rows if r["benign"]]
    util = [r["utility"] for r in rows if r["utility"] is not None]
    per: dict[str, dict[str, int]] = {}
    for r in rows:
        c = per.setdefault(r["category"], {"n": 0, "correct": 0, "blocked": 0})
        c["n"] += 1
        c["correct"] += int(r["correct"])
        c["blocked"] += int(r["outcome"] == "blocked")
    return {
        "name": name, "label": label,
        "catch_rate": round(sum(r["correct"] for r in leak) / len(leak), 4) if leak else None,
        "false_alarm_rate": round(sum(not r["correct"] for r in ben) / len(ben), 4) if ben else None,
        "utility": round(statistics.fmean(util), 4) if util else None,
        "p50_ms": pct(lat, 0.50), "p95_ms": pct(lat, 0.95),
        "per_category": {k: per[k] for k in CATEGORIES if k in per},
        "n_leak_cases": len(leak), "n_benign_cases": len(ben),
        "errors": sum(r["outcome"] == "error" for r in rows),
    }


def pick_examples(cases: list[dict[str, Any]], outcomes: dict[str, dict[str, str]], systems: list[str],
                  per_cat: int = 3) -> list[dict[str, Any]]:
    """Up to `per_cat` cases per category, preferring ones where the systems disagree."""
    out = []
    for cat in CATEGORIES:
        cs = [c for c in cases if c["category"] == cat]
        cs.sort(key=lambda c: (-len({outcomes[c["id"]].get(s) for s in systems}), c["id"]))
        for c in cs[:per_cat]:
            out.append({"case_id": c["id"], "category": cat, "description": c["description"],
                        "outcomes": {s: outcomes[c["id"]].get(s, "n/a") for s in systems}})
    return out


def stratified(cases: list[dict[str, Any]], limit: Optional[int]) -> list[dict[str, Any]]:
    if not limit or limit >= len(cases):
        return cases
    by: dict[str, list[dict[str, Any]]] = {}
    for c in cases:
        by.setdefault(c["category"], []).append(c)
    out: list[dict[str, Any]] = []
    i = 0
    while len(out) < limit:
        for cat in CATEGORIES:
            if i < len(by.get(cat, [])) and len(out) < limit:
                out.append(by[cat][i])
        i += 1
    order = {c["id"]: n for n, c in enumerate(cases)}
    return sorted(out, key=lambda c: order[c["id"]])


# --------------------------------------------------------------------------------------------- main


def run_system(sys_obj: Any, cases: list[dict[str, Any]], quiet: bool) -> tuple[list[dict[str, Any]], list[float]]:
    rows, lat = [], []
    n = len(cases)
    t_start = time.perf_counter()
    for i, case in enumerate(cases, 1):
        results = []
        try:
            sys_obj.start_case(case)
        except Exception as e:                                  # setup failure counts against the system
            results = [{"error": type(e).__name__}]
        if not results:
            for req in case["requests"]:
                t0 = time.perf_counter()
                try:
                    res = sys_obj.inspect(req)
                except Exception as e:
                    res = {"error": type(e).__name__, "action": "error", "sent": None}
                ms = (time.perf_counter() - t0) * 1000
                res["ms"] = ms
                lat.append(ms)
                results.append(res)
        j = judge(case, results)
        rows.append({"id": case["id"], "category": case["category"], "benign": case["category"] in BENIGN,
                     "actions": [r.get("action", "error") for r in results],
                     "kinds": sorted({k for r in results for k in r.get("kinds", [])}),
                     "rewritten_by": [r.get("rewritten_by") for r in results],
                     "ms": [round(r.get("ms", 0.0), 2) for r in results], **j})
        if not quiet:
            elapsed = time.perf_counter() - t_start
            eta = elapsed / i * (n - i)
            err = f"  ({results[0]['error']})" if results and results[0].get("error") else ""
            print(f"  [{sys_obj.name}] {i:3d}/{n} {case['id']:8s} {case['category']:16s} "
                  f"{j['outcome']:9s} {sum(r.get('ms', 0) for r in results):8.1f} ms   eta {eta:5.0f}s{err}",
                  flush=True)
    return rows, lat


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="LeakGate benchmark runner")
    ap.add_argument("--systems", default=None,
                    help="comma list of regex_dlp,presidio,leakgate_rules,leakgate_full "
                         "(default: all; presidio only if installed)")
    ap.add_argument("--limit", type=int, default=None, help="run N cases, stratified across categories")
    ap.add_argument("--cases", type=Path, default=CASES_PATH)
    ap.add_argument("--out", type=Path, default=REPORT)
    ap.add_argument("--runtime-dir", type=Path, default=None,
                    help="LEAKGATE_OUTPUTS for bench runs (default outputs/bench_runtime)")
    ap.add_argument("--fresh", action="store_true", help="wipe the runtime dir first (cold LLM cache)")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)

    runtime = Path(a.runtime_dir or os.getenv("LEAKGATE_BENCH_RUNTIME") or RUNTIME).resolve()
    if a.fresh and runtime.exists():
        shutil.rmtree(runtime)
    runtime.mkdir(parents=True, exist_ok=True)
    os.environ["LEAKGATE_OUTPUTS"] = str(runtime)    # before leakgate is imported anywhere
    cold = not any(runtime.glob("*cache*"))

    if a.systems:
        names = [s.strip() for s in a.systems.split(",") if s.strip()]
    else:
        names = ["regex_dlp"] + (["presidio"] if presidio_available() else []) + ["leakgate_rules", "leakgate_full"]

    cases = load_cases(a.cases)
    bad = {c["id"]: e for c in cases if (e := validate_case(c))}
    if bad:
        print(f"{len(bad)} invalid cases, e.g. {next(iter(bad.items()))}", file=sys.stderr)
        return 1
    cases = stratified(cases, a.limit)
    nonce = datetime.now(timezone.utc).strftime("%H%M%S")
    print(f"LeakGate bench: {len(cases)} cases x {len(names)} systems; runtime dir {runtime}"
          f" ({'cold' if cold else 'warm'} LLM cache)")

    systems_out, outcomes = [], {c["id"]: {} for c in cases}
    detail: dict[str, Any] = {}
    model_name, model_on = None, None
    for name in names:
        t0 = time.perf_counter()
        sys_obj = make_system(name, runtime, nonce)
        if isinstance(sys_obj, LeakGateSystem):
            model_name = sys_obj.model
            if name == "leakgate_full":
                model_on = sys_obj.model_on
                if not model_on:
                    print("  WARNING: local model not reachable; leakgate_full runs without layer 5", flush=True)
        print(f"\n== {name}: {sys_obj.label}", flush=True)
        rows, lat = run_system(sys_obj, cases, a.quiet)
        summ = summarize(name, sys_obj.label, rows, lat)
        summ["wall_s"] = round(time.perf_counter() - t0, 1)
        if name == "leakgate_full":
            summ["model_available"] = bool(model_on)
        systems_out.append(summ)
        for r in rows:
            outcomes[r["id"]][name] = r["outcome"]
        detail[name] = rows
        print(f"   catch {summ['catch_rate']}  false-alarm {summ['false_alarm_rate']}  utility {summ['utility']}  "
              f"p50 {summ['p50_ms']} ms  p95 {summ['p95_ms']} ms  errors {summ['errors']}", flush=True)

    present = [c for c in CATEGORIES if any(x["category"] == c for x in cases)]
    report = {
        "available": True,
        "run_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "n_cases": len(cases),
        "model": model_name,
        "llm_cache": "cold" if cold else "warm",
        "categories": {c: CATEGORIES[c] for c in present},
        "category_counts": {c: sum(x["category"] == c for x in cases) for c in present},
        "systems": systems_out,
        "examples": pick_examples(cases, outcomes, names),
    }
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    DETAIL.write_text(json.dumps({"run_at": report["run_at"], "cases": {c["id"]: {
        "category": c["category"], "description": c["description"], "kind": c["kind"],
        "results": {n: next(r for r in detail[n] if r["id"] == c["id"]) for n in names}} for c in cases}},
        indent=1), encoding="utf-8")
    print(f"\nwrote {a.out} and {DETAIL}")
    print_table(report)
    return 0


def print_table(report: dict[str, Any]) -> None:
    sy = report["systems"]
    print(f"\n{'system':16s} {'catch':>7s} {'false-al':>8s} {'utility':>8s} {'p50 ms':>8s} {'p95 ms':>8s}")
    for s in sy:
        f = lambda v: "-" if v is None else f"{v:.3f}"  # noqa: E731
        print(f"{s['name']:16s} {f(s['catch_rate']):>7s} {f(s['false_alarm_rate']):>8s} {f(s['utility']):>8s} "
              f"{s['p50_ms']:8.2f} {s['p95_ms']:8.2f}")
    print(f"\n{'category':16s} {'n':>4s} " + " ".join(f"{s['name'][:14]:>14s}" for s in sy))
    for cat, n in report["category_counts"].items():
        print(f"{cat:16s} {n:4d} " + " ".join(f"{s['per_category'].get(cat, {}).get('correct', 0):>14d}" for s in sy))


if __name__ == "__main__":
    raise SystemExit(main())
