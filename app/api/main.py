"""LeakGate API (CONTRACTS.md §2). Run:  python -m uvicorn app.api.main:app --port 8100

One Gate for the process: the demo CRM is pre-registered in its vault, the socket guard allows only
the policy's destinations plus loopback, and scenario runs stream AgentEvents that the UI polls.
Nothing here returns a raw sensitive value: decisions are pre-masked by the gate, and the policy's
confidential terms are masked before they are served.
"""
from __future__ import annotations

import json
import threading
import traceback
import uuid
from contextlib import asynccontextmanager
from typing import Any, Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agent import demo
from leakgate import config, llm, mask, netguard
from leakgate.integrations import pharma_vault
from leakgate.gate import Gate, Session
from leakgate.integrations.tavily import api_key as tavily_key
from leakgate.schema import AgentEvent, Decision, LedgerRecord, LedgerStatus, Policy, ScenarioInfo, SessionInfo, VaultSummary, now_iso

STATE: dict[str, Any] = {"gate": None, "bypass": []}
RUNS: dict[str, dict[str, Any]] = {}          # session_id -> {"info": SessionInfo, "events": [AgentEvent], "lock": Lock}
MAX_RUNS = 50


def gate() -> Gate:
    g = STATE["gate"]
    if g is None:
        g = Gate.default()
        g.register_source(demo.CRM_PATH)
        pharma_vault.load_into_gate(g)
        STATE["gate"] = g
    return g


def _on_bypass(dest: str) -> None:
    STATE["bypass"] = (STATE["bypass"] + [{"dest": dest, "ts": now_iso()}])[-20:]


@asynccontextmanager
async def lifespan(_: FastAPI):
    g = gate()
    netguard.install_for(g, on_block=_on_bypass)
    yield


app = FastAPI(title="LeakGate API", version="0.1.0", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5180", "http://localhost:5180",
                                                  "http://127.0.0.1:4180", "http://localhost:4180"],
                   allow_methods=["*"], allow_headers=["*"])


# ---------------------------------------------------------------- status / policy / vault / ledger
@app.get("/api/status")
def status() -> dict:
    g = gate()
    led = g.ledger.verify() if g.ledger else LedgerStatus(ok=True, records=0)
    return {"ok": True, "mode": g.policy.mode, "policy": g.policy.name, "model": g.model,
            "model_available": llm.available(g.model), "use_context_model": g.policy.use_context_model,
            "tavily": "live" if tavily_key() else "replay",
            "netguard": netguard.status(), "bypass_attempts": STATE["bypass"][-5:],
            "ledger": led.model_dump()}


@app.get("/api/policy", response_model=Policy)
def policy() -> Policy:
    p = gate().policy.model_copy(deep=True)
    p.confidential_terms = [mask(t) for t in p.confidential_terms]
    return p


@app.get("/api/vault", response_model=VaultSummary)
def vault() -> VaultSummary:
    return VaultSummary(**gate().vault.summary())


@app.get("/api/ledger", response_model=list[LedgerRecord])
def ledger(limit: int = Query(200, ge=1, le=2000)) -> list[LedgerRecord]:
    g = gate()
    return g.ledger.records(limit) if g.ledger else []


@app.get("/api/ledger/verify", response_model=LedgerStatus)
def ledger_verify() -> LedgerStatus:
    g = gate()
    return g.ledger.verify() if g.ledger else LedgerStatus(ok=True, records=0)


@app.get("/api/bench")
def bench() -> dict:
    p = config.OUTPUTS / "bench.json"
    if not p.exists():
        return {"available": False}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"available": False}
    data.setdefault("available", True)
    return data


# ---------------------------------------------------------------- playground
class InspectBody(BaseModel):
    channel: Literal["search", "extract", "http", "llm", "tool"] = "search"
    tool: str = "tavily.search"
    destination: str = "api.tavily.com"
    url: Optional[str] = None
    payload: dict[str, Any] = {}
    origin: str = "agent"
    private: bool = True
    untrusted: bool = False


@app.post("/api/inspect", response_model=Decision)
def inspect(body: InspectBody) -> Decision:
    g = gate()
    s = g.session(f"play-{uuid.uuid4().hex[:6]}")
    if body.private:
        s.mark_private("crm:demo-records")
    if body.untrusted:
        s.mark_untrusted("playground://web-page", body.url or "")
        if body.url:
            s.mentioned_urls.add(body.url)
    d = s.inspect(channel=body.channel, tool=body.tool, destination=body.destination.strip().lower(),
                  payload=body.payload, url=body.url or None, origin=body.origin)
    g.sessions.pop(s.id, None)
    return d


# ---------------------------------------------------------------- scenarios / sessions
@app.get("/api/scenarios", response_model=list[ScenarioInfo])
def scenarios() -> list[ScenarioInfo]:
    return list(demo.SCENARIOS.values())


class SessionBody(BaseModel):
    scenario: str                                   # a scenario name, or "custom" with a prompt
    mode: Literal["scripted", "live"] = "scripted"
    prompt: Optional[str] = None                    # custom only: what the user typed (max 2000 chars)
    plant_poison: bool = False                      # custom only: append the red-team page to search results


@app.get("/api/presets")
def presets() -> list[dict]:
    """Suggested prompts for the prompt box (custom sessions)."""
    return demo.PRESETS


def _emitter(sid: str, s: Session):
    run = RUNS[sid]

    def emit(type: str, title: str, detail: Optional[str] = None, decision: Optional[Decision] = None,
             citations: Optional[list[dict]] = None) -> None:
        with run["lock"]:
            g = gate()
            ev = AgentEvent(seq=len(run["events"]), session_id=sid, type=type, title=g.mask_text(title) or title,  # type: ignore[arg-type]
                            detail=g.mask_text(detail),
                            decision=decision, taint=s.taint.model_copy(deep=True), citations=citations or [])
            run["events"].append(ev)
            info: SessionInfo = run["info"]
            info.events = len(run["events"])
            info.taint = s.taint.model_copy(deep=True)
            if decision is not None:
                info.counts[decision.action] = info.counts.get(decision.action, 0) + 1
    return emit


def _run(sid: str, scenario: str, mode: str, prompt: Optional[str] = None, plant_poison: bool = False) -> None:
    g = gate()
    s = g.session(sid)
    emit = _emitter(sid, s)
    try:
        demo.run(scenario, mode, g, s, emit, prompt=prompt, plant_poison=plant_poison)
        RUNS[sid]["info"].status = "done"
    except Exception as e:                                     # never a stack trace in the UI
        traceback.print_exc()
        emit("error", "The run stopped", detail=f"{type(e).__name__}: {str(e)[:200]}")
        RUNS[sid]["info"].status = "error"
    finally:
        g.sessions.pop(sid, None)


@app.post("/api/sessions", response_model=SessionInfo)
def start_session(body: SessionBody) -> SessionInfo:
    if body.scenario == "custom":
        if not (body.prompt or "").strip():
            raise HTTPException(400, detail="Type a prompt for the agent.")
        if len(body.prompt or "") > 2000:
            raise HTTPException(400, detail="Keep the prompt under 2000 characters.")
        mode = "live"
    else:
        sc = demo.SCENARIOS.get(body.scenario)
        if sc is None:
            raise HTTPException(404, detail=f"Unknown scenario {body.scenario!r}.")
        if body.mode not in sc.modes:
            raise HTTPException(400, detail=f"Scenario {body.scenario!r} supports {sc.modes}.")
        mode = body.mode
    sid = f"{body.scenario[:3]}-{uuid.uuid4().hex[:6]}"
    info = SessionInfo(session_id=sid, scenario=body.scenario, mode=mode, status="running", started=now_iso())
    RUNS[sid] = {"info": info, "events": [], "lock": threading.Lock()}
    for old in list(RUNS)[:-MAX_RUNS]:
        RUNS.pop(old, None)
    threading.Thread(target=_run, args=(sid, body.scenario, mode, body.prompt, body.plant_poison), daemon=True).start()
    return info


@app.get("/api/sessions", response_model=list[SessionInfo])
def list_sessions() -> list[SessionInfo]:
    return [r["info"] for r in reversed(list(RUNS.values()))]


@app.get("/api/sessions/{sid}", response_model=SessionInfo)
def get_session(sid: str) -> SessionInfo:
    if sid not in RUNS:
        raise HTTPException(404, detail="Unknown session.")
    return RUNS[sid]["info"]


@app.get("/api/sessions/{sid}/events", response_model=list[AgentEvent])
def events(sid: str, after: int = -1) -> list[AgentEvent]:
    if sid not in RUNS:
        raise HTTPException(404, detail="Unknown session.")
    run = RUNS[sid]
    with run["lock"]:
        return [e for e in run["events"] if e.seq > after]
