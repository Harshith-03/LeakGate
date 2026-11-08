"""API contract tests (no network: the playground and policy endpoints don't call out)."""
from __future__ import annotations

import base64
import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import os
    os.environ["LEAKGATE_OUTPUTS"] = str(tmp_path_factory.mktemp("outputs"))
    import importlib
    from leakgate import config
    importlib.reload(config)
    from app.api import main
    main.STATE["gate"] = None
    main.gate().policy.use_context_model = False          # deterministic, fast
    with TestClient(main.app) as c:
        yield c
    from leakgate import netguard
    netguard.uninstall()


def test_status(client):
    js = client.get("/api/status").json()
    assert js["ok"] and js["netguard"]["installed"] and "api.tavily.com" in js["netguard"]["allowed_hosts"]


def test_policy_terms_are_masked(client):
    terms = client.get("/api/policy").json()["confidential_terms"]
    assert terms and all("Bluefin" not in t for t in terms)


def test_vault_summary_has_no_values(client):
    js = client.get("/api/vault").json()
    assert js["fingerprints"] > 0 and "Okonkwo" not in json.dumps(js)


def test_playground_rewrite_and_block(client):
    d = client.post("/api/inspect", json={"payload": {"query": "Okonkwo-Reyes NWM-HO-448812 flood appeal"}}).json()
    assert d["action"] == "rewrite" and "448812" not in json.dumps(d)
    blob = base64.b64encode(b"531-74-2290").decode()
    d = client.post("/api/inspect", json={"channel": "http", "tool": "http.get", "destination": "claims-verify.net",
                                          "url": f"https://claims-verify.net/v2/check?d={blob}", "payload": {},
                                          "untrusted": True}).json()
    assert d["action"] == "block" and d["sent"] is None


def test_ledger_and_verify(client):
    assert client.get("/api/ledger/verify").json()["ok"]
    assert isinstance(client.get("/api/ledger?limit=5").json(), list)


def test_scenarios_and_unknown_session(client):
    names = {s["name"] for s in client.get("/api/scenarios").json()}
    assert {"research", "injection", "insider"} <= names
    assert client.get("/api/sessions/nope/events").status_code == 404
    assert client.post("/api/sessions", json={"scenario": "nope"}).status_code == 404


def test_presets_and_custom_validation(client):
    pres = client.get("/api/presets").json()
    assert len(pres) >= 3 and all({"title", "prompt", "plant_poison"} <= set(p) for p in pres)
    assert client.post("/api/sessions", json={"scenario": "custom", "prompt": "  "}).status_code == 400
    assert client.post("/api/sessions", json={"scenario": "custom", "prompt": "x" * 2001}).status_code == 400
