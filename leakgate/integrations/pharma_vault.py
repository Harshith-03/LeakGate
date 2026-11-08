"""Bridge: load Track 4 drug intelligence spans into the LeakGate vault."""
from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

from ..gate import Gate

_DATA = Path(__file__).resolve().parents[2] / "agent" / "data" / "drug_intel_predictions.jsonl"
_PHARMA_POLICY = Path(__file__).resolve().parents[2] / "policies" / "pharma.json"
_ASPECTS = ("efficacy", "safety", "convenience", "access_cost", "evidence_quality")
_lock = threading.Lock()
_loaded = False


def load_into_gate(gate: Gate) -> int:
    global _loaded
    with _lock:
        if _loaded:
            return 0

        if not _DATA.exists():
            print(f"[pharma_vault] warning: {_DATA} not found — no spans loaded", file=sys.stderr)
            return 0

        items_loaded = 0
        spans_total = 0
        with _DATA.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                item = json.loads(line)
                if item.get("actionable") != "yes":
                    continue
                if all(item.get(a) is None for a in _ASPECTS):
                    continue

                record: dict[str, str] = {"signal_type": item["signal_type"]}
                for aspect in _ASPECTS:
                    asp = item.get(aspect)
                    if asp and asp.get("span"):
                        record[f"{aspect}_signal"] = asp["span"]

                span_fields = {k for k in record if k != "signal_type"}
                if not span_fields:
                    continue

                gate.vault.add_record("track4", item["item_id"], record, public_fields={"signal_type"})
                items_loaded += 1
                spans_total += len(span_fields)

        if _PHARMA_POLICY.exists():
            try:
                pol = json.loads(_PHARMA_POLICY.read_text(encoding="utf-8"))
                terms = pol.get("confidential_terms", [])
                if terms:
                    gate.vault.add_terms(terms, source="pharma-policy")
                    print(f"[pharma_vault] {len(terms)} pharma confidential terms added", file=sys.stderr)
            except Exception as e:
                print(f"[pharma_vault] warning: could not load pharma policy terms: {e}", file=sys.stderr)

        _loaded = True
        print(f"[pharma_vault] {items_loaded} items loaded, {spans_total} spans fingerprinted", file=sys.stderr)
        return spans_total
