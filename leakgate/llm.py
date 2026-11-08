"""The local model, and only the local model: Ollama on 127.0.0.1.

    chat_json(system, messages, schema, model=None, timeout=None) -> dict | None   # None on any failure
    available(model=None) -> bool

JSON-schema-constrained output (Ollama `format`), temperature 0, fixed seed, thinking off, so the
same input gives the same answer. Raw responses are cached by request hash in outputs/cache/llm/,
which makes the benchmark and demo re-runs fast and reproducible. Never raises: the gate must keep
working (rules only) when the model is down, and it says so in the decision.
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any, Optional

import requests

from . import config

_AVAIL: dict[str, tuple[float, bool]] = {}


def _cache_path(body: dict):
    h = hashlib.sha256(json.dumps(body, sort_keys=True).encode("utf-8")).hexdigest()
    return config.OUTPUTS / "cache" / "llm" / f"{h}.json"


def chat_json(system: str, messages: list[dict], schema: dict, model: Optional[str] = None,
              timeout: Optional[float] = None, num_predict: int = 256) -> Optional[dict]:
    body = {
        "model": model or config.MODEL,
        "messages": [{"role": "system", "content": system}, *messages],
        "format": schema,
        "stream": False,
        "think": False,
        "options": {"temperature": 0, "seed": 7, "num_ctx": 4096, "num_predict": num_predict},
        "keep_alive": "30m",
    }
    path = _cache_path(body)
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    try:
        r = requests.post(config.OLLAMA_URL.rstrip("/") + "/api/chat", json=body,
                          timeout=timeout or config.LLM_TIMEOUT)
        r.raise_for_status()
        content = r.json()["message"]["content"]
        out = json.loads(content)
    except Exception:
        return None
    if not isinstance(out, dict):
        return None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    return out


def available(model: Optional[str] = None, ttl: float = 20.0) -> bool:
    m = model or config.MODEL
    hit = _AVAIL.get(m)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    ok = False
    try:
        r = requests.get(config.OLLAMA_URL.rstrip("/") + "/api/tags", timeout=1.5)
        names = {x.get("name") for x in r.json().get("models", [])} | {x.get("model") for x in r.json().get("models", [])}
        ok = m in names or f"{m}:latest" in names
    except Exception:
        ok = False
    _AVAIL[m] = (time.time(), ok)
    return ok


def schema_of(props: dict[str, Any], required: list[str]) -> dict:
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}
