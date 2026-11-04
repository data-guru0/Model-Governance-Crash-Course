"""NovaBank Governance Console: JSON API + single-page web UI (console/static).

Every endpoint calls the same governed functions in governance/lifecycle.py that the tests and
the end-to-end run use. Reads come live from Postgres, MLflow and the LiteLLM API; every write
is a governed action (role checks, gates, audit log).
"""
from __future__ import annotations

import difflib
import hashlib
from pathlib import Path

import httpx
import mlflow
import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from governance import core, lifecycle, report, simulate
from governance.lifecycle import GovernanceError

STATIC = Path(__file__).parent / "static"
app = FastAPI(title="NovaBank Governance Console")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.exception_handler(GovernanceError)
def refused(_: Request, exc: GovernanceError) -> JSONResponse:
    return JSONResponse({"refused": str(exc)}, status_code=409)


class Actor(BaseModel):
    name: str = "anonymous"
    role: str = "Student"

    @property
    def label(self) -> str:
        return f"{self.name or 'anonymous'} ({self.role})"


class Decision(Actor):
    approve: bool = True
    comment: str = ""


class Review(Actor):
    pair_id: int
    confirm: bool
    note: str = ""


class Job(Actor):
    kind: str
    params: dict = {}


class PolicyEdit(Actor):
    text: str
    reason: str = ""


class Chat(BaseModel):
    message: str


# --------------------------------------------------------------------------- pages
@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/api/health")
def health() -> dict:
    out = {}
    for name, url in {"gateway": f"{core.LITELLM_URL}/health/liveliness", "mlflow": "http://mlflow:5000/health",
                      "app": f"{core.APP_URL}/health"}.items():
        try:
            out[name] = httpx.get(url, timeout=4).status_code == 200
        except httpx.HTTPError:
            out[name] = False
    out["postgres"] = bool(core.query("SELECT 1"))
    return out


# --------------------------------------------------------------------------- shared state
@app.get("/api/state")
def state() -> dict:
    pol = core.policy()
    prompt = core.get_state("prompt") or {}
    deployments = core.admin("GET", "/model/info")["data"]
    proposal = lifecycle.load_proposal()
    ev = core.get_state("offline_eval") or {}
    return {
        "lifecycle": core.lifecycle(),
        "weights": core.current_weights(),
        "simulation": simulate.enabled(),
        "policy": pol,
        "policy_fingerprint": core.policy_fingerprint(),
        "roles": ["Product Owner", "ML Platform Lead", "Model Risk Officer", "Governance Board", "Student"],
        "registry": lifecycle.registry_versions(),
        "prompt": {**prompt, "in_sync": prompt.get("sha") == hashlib.sha256(core.system_prompt_text().encode()).hexdigest()},
        "routes": [{"route": d["model_name"], "provider_model": d["litellm_params"]["model"],
                    "weight": d["litellm_params"].get("weight"), "silent_model": d["litellm_params"].get("silent_model"),
                    "version": d["model_info"].get("nova_version"), "db_model": bool(d["model_info"].get("db_model"))}
                   for d in deployments],
        "models": {r: core.route_params(r)["model"] for r in ("nova-v1", "nova-v2", "nova-v3", "nova-judge")},
        "codenames": {proposal["current_champion"]["nova_version"]: proposal["current_champion"]["codename"],
                      **{c["version"]: c["codename"] for c in proposal["candidates"]}},
        "candidates": {v: c["passed"] for v, c in (ev.get("candidates") or {}).items()},
        "selected": ev.get("selected"),
    }


@app.get("/api/story")
def story() -> dict:
    """The classroom calendar: which week each stage happens in, with dates from the story start."""
    from datetime import date, timedelta

    lc = core.lifecycle()
    start = date.fromisoformat(lc.get("story_start") or core.now().date().isoformat())
    start -= timedelta(days=start.weekday())  # weeks start on Monday
    weeks = core.policy()["story"]["weeks"]
    chapters = [("proposal", "Proposal & evaluation", ["s1", "s2", "s3"]), ("shadow", "Shadow week", ["s4"]),
                ("canary", "Canary week", ["s5"]), ("rollout_25", "Rollout 25%", ["s6"]),
                ("rollout_50", "Rollout 50%", ["s6"]), ("rollout_100", "Rollout 100%", ["s6"]),
                ("promotion", "Promotion", ["s7"])]
    out = []
    for key, label, pages in chapters:
        w = weeks[key]
        d0 = start + timedelta(weeks=w - 1) if w else start
        out.append({"key": key, "label": label, "week": w, "pages": pages,
                    "from": d0.isoformat(), "to": (d0 + timedelta(days=6)).isoformat()})
    return {"start": start.isoformat(), "current_week": simulate.story_week(lc["stage"]), "chapters": out,
            "weekly_requests": core.policy()["story"]["weekly_requests"]}


@app.get("/api/daily")
def daily() -> list[dict]:
    """Day-by-day metrics per version for the current traffic window (simulated week + real calls)."""
    lc = core.lifecycle()
    win = lc["window"] if lc["stage"] != "shadow_passed" else lc.get("shadow_window", lc["window"])
    return core.query("""SELECT story_day AS day, model_version AS version, COUNT(*) AS requests,
                                AVG((error IS NOT NULL)::int) AS error_rate,
                                percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
                                    FILTER (WHERE error IS NULL) AS p95_latency_ms,
                                AVG(quality_score) AS quality
                         FROM governance.requests WHERE stage = %s AND story_day IS NOT NULL
                         GROUP BY story_day, model_version ORDER BY story_day""", (win,))


@app.get("/api/usage")
def usage() -> list[dict]:
    return core.query("""SELECT model_group, COUNT(*) AS calls, SUM(total_tokens) AS tokens, SUM(spend) AS usd
                         FROM "LiteLLM_SpendLogs" GROUP BY model_group ORDER BY calls DESC""",
                      conn_factory=core.litellm_db)


@app.post("/api/live-check")
def live_check() -> list[dict]:
    """One tiny real call per route (4 Groq calls)."""
    out = []
    for route in ("nova-v1", "nova-v2", "nova-v3", "nova-judge"):
        try:
            r = core.chat(route, [{"role": "user", "content": "Reply with the word OK."}], core.MASTER_KEY,
                          {"tags": ["health-check"]}, 0, 200)
            out.append({"route": route, "ok": True, "latency_ms": round(r["latency_ms"]), "reply": r["content"][:40]})
        except Exception as exc:  # noqa: BLE001
            out.append({"route": route, "ok": False, "error": str(exc)[:200]})
    return out


class PromptEdit(Actor):
    text: str
    reason: str = ""


@app.get("/api/prompt")
def get_prompt() -> dict:
    return {"text": core.system_prompt_text(), "state": core.get_state("prompt") or {},
            "editors": core.policy()["approvals"]["policy_change"]}


@app.post("/api/prompt")
def save_prompt(e: PromptEdit) -> dict:
    """Governed prompt change: role check, reason required, new Prompt Registry version, audited."""
    lifecycle.require_role("policy_change", e.role)
    if not e.reason.strip():
        raise GovernanceError("A reason is required.")
    text = e.text.replace("\r\n", "\n").strip()
    if len(text) < 50:
        raise GovernanceError("The prompt looks empty.")
    if text == core.system_prompt_text():
        raise GovernanceError("Nothing changed.")
    core.SYSTEM_PROMPT_FILE.write_text(text + "\n", encoding="utf-8")
    state = lifecycle.ensure_prompt(e.label)
    core.audit(e.label, "baseline", "prompt_changed", "APPROVED", {"reason": e.reason, "prompt_uri": state["uri"]})
    return state


@app.post("/api/prompt/sync")
def prompt_sync(a: Actor) -> dict:
    """Register governance/policy.md as a new prompt version if it changed (no restart needed)."""
    return lifecycle.ensure_prompt(a.label)


@app.post("/api/chat")
def chat(body: Chat) -> dict:
    r = httpx.post(f"{core.APP_URL}/chat", json={"message": body.message}, timeout=120)
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)
    return r.json()


# --------------------------------------------------------------------------- jobs
@app.post("/api/jobs")
def enqueue(job: Job) -> dict:
    if job.kind not in ("offline_eval", "replay", "drift", "rehearsal"):
        raise HTTPException(400, "unknown job kind")
    return {"id": core.enqueue(job.kind, job.params, job.label)}


@app.get("/api/jobs")
def jobs(kinds: str = "") -> list[dict]:
    return core.query("""SELECT id, kind, status, progress, error, actor, created_at, finished_at
                         FROM governance.jobs WHERE kind = ANY(%s) AND (kind = 'rehearsal' OR created_at > COALESCE(
                           (SELECT MAX(ts) FROM governance.audit_log WHERE action = 'demo_reset'), '-infinity'))
                         ORDER BY id DESC LIMIT 5""", (kinds.split(","),))


@app.get("/api/jobs/{job_id}")
def job_detail(job_id: int) -> dict:
    rows = core.query("SELECT id, kind, status, progress, error, result FROM governance.jobs WHERE id = %s", (job_id,))
    if not rows:
        raise HTTPException(404, "no such job")
    return rows[0]


# --------------------------------------------------------------------------- stages 0-3
@app.post("/api/reset")
def reset(a: Actor) -> dict:
    lifecycle.reset_demo(a.label)
    return {"ok": True}


@app.get("/api/proposal")
def proposal() -> dict:
    p = lifecycle.load_proposal()
    return {"proposal": p, "raw": lifecycle.PROPOSAL_FILE.read_text(encoding="utf-8"),
            "model_cards": {c["version"]: lifecycle.model_card_file(c["version"]).read_text(encoding="utf-8")
                            for c in p["candidates"]}}


@app.post("/api/proposal/submit")
def submit(a: Actor) -> dict:
    lifecycle.submit_proposal(a.label)
    return {"ok": True}


@app.post("/api/proposal/decide")
def decide(d: Decision) -> dict:
    lifecycle.decide_proposal(d.name or "anonymous", d.role, d.approve, d.comment)
    return {"ok": True}


@app.get("/api/offline")
def offline() -> dict:
    exp = mlflow.get_experiment_by_name(core.policy()["registry"]["experiment"])
    return {"eval": core.get_state("offline_eval"), "experiment_id": exp.experiment_id if exp else None}


@app.post("/api/register")
def register(a: Actor) -> dict:
    return {"version": lifecycle.register_challenger(a.label)}


# --------------------------------------------------------------------------- stage 4
@app.post("/api/shadow/start")
def shadow_start(a: Actor) -> dict:
    return {"weights": lifecycle.start_shadow(a.name or "anonymous", a.role)}


@app.get("/api/shadow")
def shadow() -> dict:
    lc = core.lifecycle()
    win = lc["window"] if lc["stage"] == "shadow" else lc.get("shadow_window", lc["window"])
    pairs = core.query("""SELECT p.id, p.intent, p.prompt, p.champion_response, p.challenger_response, p.verdict,
                                 p.verdict_reason, p.challenger_violation, p.challenger_error, p.simulated,
                                 p.review_decision, p.reviewed_by, p.champion_latency_ms, p.challenger_latency_ms
                          FROM governance.shadow_pairs p JOIN governance.requests r USING (request_id)
                          WHERE r.stage = %s ORDER BY p.simulated, p.id DESC LIMIT 60""", (win,))
    flagged = core.query("""SELECT p.id, p.prompt, p.challenger_response, p.verdict_reason, p.review_decision,
                                   p.reviewed_by, p.simulated
                            FROM governance.shadow_pairs p JOIN governance.requests r USING (request_id)
                            WHERE r.stage = %s AND p.challenger_violation = 'critical' ORDER BY p.id""", (win,))
    return {"window": win, "stats": lifecycle.shadow_stats(win) if lc["stage"] == "shadow" else lc.get("shadow_stats"),
            "pairs": pairs, "flagged": flagged}


@app.post("/api/shadow/review")
def shadow_review(r: Review) -> dict:
    lifecycle.review_violation(r.pair_id, r.name or "anonymous", r.role, r.confirm, r.note)
    return {"ok": True}


@app.post("/api/shadow/gate")
def shadow_gate(a: Actor) -> dict:
    passed, checks, stats = lifecycle.shadow_gate(a.label)
    return {"passed": passed, "checks": checks, "stats": stats}


# --------------------------------------------------------------------------- stages 5-6
@app.post("/api/canary/start")
def canary_start(a: Actor) -> dict:
    return {"weights": lifecycle.start_canary(a.name or "anonymous", a.role)}


@app.post("/api/rollout/next")
def rollout_next(a: Actor) -> dict:
    return {"weights": lifecycle.next_rollout_step(a.name or "anonymous", a.role)}


@app.get("/api/live")
def live() -> dict:
    lc = core.lifecycle()
    checks, stats, enough = lifecycle.live_checks(lc["window"])
    history = core.query("""SELECT id, ts, stage, passed, checks, policy_version FROM governance.gate_decisions
                            WHERE stage IN ('canary','rollout_25','rollout_50','rollout_100') ORDER BY id DESC LIMIT 20""")
    return {"window": lc["window"], "stats": stats, "checks": checks, "enough": enough, "history": history}


@app.post("/api/live/gate")
def live_gate(a: Actor) -> dict:
    passed, checks, stats = lifecycle.live_gate(a.label)
    return {"passed": passed, "checks": checks, "stats": stats}


@app.post("/api/rollback")
def rollback(a: Actor) -> dict:
    lifecycle.rollback(a.label, "manual rollback by operator")
    return {"weights": core.current_weights()}


# --------------------------------------------------------------------------- stage 7
@app.post("/api/promote")
def promote(a: Actor) -> dict:
    return {"version": lifecycle.promote(a.name or "anonymous", a.role)}


@app.post("/api/report")
def make_report(a: Actor) -> dict:
    path = Path(report.generate(a.label))
    return {"file": f"reports/{path.name}", "markdown": path.read_text(encoding="utf-8")}


@app.get("/api/drift")
def drift() -> dict:
    last = core.query("""SELECT ts, passed, checks, evidence FROM governance.gate_decisions
                         WHERE stage = 'continuous_governance' ORDER BY id DESC LIMIT 1""")
    return {"last": last[0] if last else None, "max_drop": core.policy()["drift"]["max_drop"],
            "drift_shift": core.policy().get("simulation", {}).get("drift_shift", 0)}


# --------------------------------------------------------------------------- audit + policy
@app.get("/api/audit")
def audit(since_reset: bool = True) -> dict:
    last_reset = core.query("SELECT COALESCE(MAX(id), 0) AS id FROM governance.audit_log WHERE action='demo_reset'")[0]["id"]
    rows = core.query("SELECT * FROM governance.audit_log WHERE id >= %s ORDER BY id DESC LIMIT 300",
                      (last_reset if since_reset else 0,))
    intact, n, bad = core.verify_audit_chain()
    return {"rows": rows, "intact": intact, "count": n, "first_bad": bad}


@app.post("/api/audit/tamper")
def tamper() -> dict:
    try:
        core.query("UPDATE governance.audit_log SET decision = 'APPROVED' WHERE id = 1")
        return {"blocked": False, "message": "Update succeeded: the log is NOT protected!"}
    except Exception as exc:  # noqa: BLE001
        return {"blocked": True, "message": str(exc).splitlines()[0]}


@app.get("/api/policy")
def get_policy() -> dict:
    return {"text": core.POLICY_FILE.read_text(encoding="utf-8"), "fingerprint": core.policy_fingerprint(),
            "editors": core.policy()["approvals"]["policy_change"]}


@app.post("/api/policy")
def save_policy(e: PolicyEdit) -> dict:
    lifecycle.require_role("policy_change", e.role)
    current = core.POLICY_FILE.read_text(encoding="utf-8")
    try:
        parsed = yaml.safe_load(e.text)
    except yaml.YAMLError as exc:
        raise GovernanceError(f"Invalid YAML: {exc}") from exc
    if parsed.get("version") == yaml.safe_load(current).get("version"):
        raise GovernanceError("Bump the `version:` field for a new policy version.")
    if not e.reason.strip():
        raise GovernanceError("A reason is required.")
    for section in ("evaluation", "shadow", "live_gate", "approvals", "rate_limits"):
        if section not in parsed:
            raise GovernanceError(f"Missing section `{section}`.")
    diff = "\n".join(difflib.unified_diff(current.splitlines(), e.text.splitlines(), "before", "after", lineterm=""))
    core.POLICY_FILE.write_text(e.text.replace("\r\n", "\n"), encoding="utf-8")
    core.audit(e.label, "policy", "policy_changed", "APPROVED",
               {"reason": e.reason, "new_version": parsed["version"], "diff": diff[:4000]},
               {"fingerprint": core.policy_fingerprint()})
    return {"fingerprint": core.policy_fingerprint(), "diff": diff}
