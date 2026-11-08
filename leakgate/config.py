"""Paths, environment and the install key.

The repo is Track_LeakGate/LeakGate; secrets live one level up in Track_LeakGate/.env so they can
never be committed. Runtime state (ledger, install key, caches, bench results) goes to outputs/,
which is gitignored.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import sys
from pathlib import Path

from dotenv import load_dotenv

for _s in (sys.stdout, sys.stderr):           # Windows consoles default to cp1252 and choke on "•", "≥"
    try:
        _s.reconfigure(encoding="utf-8")       # type: ignore[union-attr]
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
TRACK = ROOT.parent
load_dotenv(TRACK / ".env")
load_dotenv(ROOT / ".env")                    # also gitignored; lets a cloned repo work standalone

OUTPUTS = Path(os.getenv("LEAKGATE_OUTPUTS", ROOT / "outputs"))
POLICY_PATH = Path(os.getenv("LEAKGATE_POLICY", ROOT / "policies" / "default.json"))
MODEL = os.getenv("LEAKGATE_MODEL", "qwen3:4b-instruct-2507-q4_K_M")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
LLM_TIMEOUT = float(os.getenv("LEAKGATE_LLM_TIMEOUT", "60"))


def ledger_path() -> Path:
    return OUTPUTS / "ledger.jsonl"


def install_key() -> bytes:
    """32 random bytes, created once per install (outputs/install.key, gitignored).

    Keys the vault fingerprints and the ledger's attempted-payload HMACs, so neither can be
    brute-forced from a short value like an SSN without this file.
    """
    env = os.getenv("LEAKGATE_KEY")
    if env:
        return bytes.fromhex(env)
    path = OUTPUTS / "install.key"
    if path.exists():
        return bytes.fromhex(path.read_text(encoding="utf-8").strip())
    path.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_bytes(32)
    path.write_text(key.hex(), encoding="utf-8")
    return key


def key_id(key: bytes) -> str:
    return hashlib.sha256(key).hexdigest()[:8]
