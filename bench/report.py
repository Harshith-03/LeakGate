"""Read outputs/bench.json + outputs/bench_cases.json and print what each system got wrong.

    python -m bench.report               # misses and false alarms per system
    python -m bench.report --markdown    # results tables for docs/BENCHMARK.md

Prints case ids, descriptions and actions only: never payloads or secret values.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from bench.make_cases import BENIGN

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / "outputs" / "bench.json"
DETAIL = ROOT / "outputs" / "bench_cases.json"

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")   # type: ignore[union-attr]
    except (AttributeError, ValueError):
        pass


def f3(v: float | None) -> str:
    return "–" if v is None else f"{v * 100:.1f}%"


def markdown(rep: dict) -> str:
    sy = rep["systems"]
    lines = ["| System | Catch rate | False alarms | Utility | p50 | p95 |", "|---|---:|---:|---:|---:|---:|"]
    for s in sy:
        lines.append(f"| {s['label']} (`{s['name']}`) | {f3(s['catch_rate'])} | {f3(s['false_alarm_rate'])} | "
                     f"{f3(s['utility'])} | {s['p50_ms']:.2f} ms | {s['p95_ms']:.2f} ms |")
    lines += ["", "| Category | n | " + " | ".join(f"`{s['name']}`" for s in sy) + " |",
              "|---|---:|" + "---:|" * len(sy)]
    for cat, n in rep["category_counts"].items():
        cells = []
        for s in sy:
            c = s["per_category"].get(cat, {"correct": 0, "n": n})
            cells.append(f"{c['correct']}/{c['n']}")
        lines.append(f"| {cat} | {n} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--markdown", action="store_true")
    ap.add_argument("--system", default=None, help="only this system")
    a = ap.parse_args(argv)
    rep = json.loads(REPORT.read_text(encoding="utf-8"))
    if a.markdown:
        print(markdown(rep))
        return 0
    det = json.loads(DETAIL.read_text(encoding="utf-8"))["cases"]
    names = [s["name"] for s in rep["systems"] if not a.system or s["name"] == a.system]
    for n in names:
        misses, alarms = [], []
        for cid, c in det.items():
            r = c["results"][n]
            if r["correct"]:
                continue
            (alarms if c["category"] in BENIGN else misses).append((cid, c, r))
        print(f"\n=== {n}: {len(misses)} missed leaks, {len(alarms)} false alarms")
        for title, rows in (("missed", misses), ("false alarm", alarms)):
            for cid, c, r in rows:
                print(f"  {title:11s} {cid:8s} {c['category']:15s} {c['kind']:22s} {'/'.join(r['actions']):14s} "
                      f"{r['outcome']:8s} kinds={','.join(r['kinds']) or '-'}  | {c['description']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
