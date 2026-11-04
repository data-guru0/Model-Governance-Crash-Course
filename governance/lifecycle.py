"""The governed lifecycle: every stage as a function with prerequisites, a gate and an audit entry.

The console calls these for instant actions (approve, register, change traffic, promote); the
governance worker runs the long ones as jobs (evaluation, traffic replay) and the automatic gate
checks that trigger rollback.
"""
from __future__ import annotations

import hashlib
import json
import statistics
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import mlflow
import yaml
from mlflow import MlflowClient

from governance import core, simulate

PROPOSAL_FILE = core.ROOT / "proposals" / "nova-assist-v2.yaml"
MODEL_CARD_FILE = core.ROOT / "proposals" / "model-card-nova-assist-v2.md"
LIVE_STAGES = ("canary", "rollout_25", "rollout_50", "rollout_100")


class GovernanceError(RuntimeError):
    """A governed action was refused (wrong stage, wrong role, failed gate)."""


def _cfg() -> dict:
    return core.policy()["registry"]


def require_stage(*allowed: str) -> dict:
    lc = core.lifecycle()
    if lc["stage"] not in allowed:
        raise GovernanceError(f"Not allowed in stage '{lc['stage']}'. Required: {', '.join(allowed)}.")
    return lc


def require_role(action: str, role: str) -> None:
    allowed = core.policy()["approvals"][action]
    if role not in allowed:
        raise GovernanceError(f"Role '{role}' may not approve '{action}'. Allowed: {', '.join(allowed)}.")


def _sha(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def _new_window(stage: str) -> str:
    return f"{stage}-{int(core.now().timestamp())}"


# --------------------------------------------------------------------------- MLflow registry
def client() -> MlflowClient:
    return MlflowClient()


def ensure_prompt(actor: str) -> dict:
    """Register governance/policy.md in the MLflow Prompt Registry (new version only if changed)."""
    name, text = _cfg()["prompt_name"], core.system_prompt_text()
    current = core.get_state("prompt")
    if current and current.get("sha") == hashlib.sha256(text.encode()).hexdigest():
        return current
    pv = mlflow.genai.register_prompt(name=name, template=text, commit_message="Nova Assist bank policy",
                                      tags={"source": "governance/policy.md"})
    mlflow.genai.set_prompt_alias(name, "production", pv.version)
    state = {"uri": f"prompts:/{name}/{pv.version}", "version": pv.version,
             "sha": hashlib.sha256(text.encode()).hexdigest()}
    core.set_state("prompt", state)
    core.audit(actor, "baseline", "prompt_registered", None, {"prompt_uri": state["uri"]})
    return state


def register_version(version: str, tags: dict, actor: str) -> str:
    """Log the Nova Assist pyfunc for `version` and register it as a new version of nova-assist."""
    reg, prompt = _cfg(), core.get_state("prompt")
    route = core.route_for(version)
    gen = core.policy()["evaluation"]["generation"]
    mlflow.set_experiment(reg["experiment"])
    with mlflow.start_run(run_name=f"register-{version}") as run:
        info = mlflow.pyfunc.log_model(
            name="nova_assist",
            python_model=str(core.ROOT / "app" / "nova_model.py"),
            code_paths=[str(core.ROOT / "governance")],
            model_config={"gateway_route": route, "prompt_uri": prompt["uri"],
                          "temperature": gen["temperature"], "max_tokens": gen["max_tokens"]},
            pip_requirements=["mlflow==3.18.0", "httpx", "pyyaml", "psycopg[binary]"],
            prompts=[prompt["uri"]],
            registered_model_name=reg["model_name"],
        )
        mlflow.set_tags({"stage": "registration", "nova_version": version, "actor": actor})
    mv = info.registered_model_version
    all_tags = {"nova_version": version, "gateway_route": route,
                "provider_model": core.route_params(route)["model"], "prompt_uri": prompt["uri"],
                "registered_by": actor, "registration_run_id": run.info.run_id,
                "git_commit": core.git_commit(), **tags}
    for k, v in all_tags.items():
        client().set_model_version_tag(reg["model_name"], str(mv), k, str(v))
    return str(mv)


def alias_version(alias: str) -> str | None:
    try:
        return client().get_model_version_by_alias(_cfg()["model_name"], alias).version
    except Exception:  # noqa: BLE001 - alias not set
        return None


def registry_versions() -> list[dict]:
    name = _cfg()["model_name"]
    try:
        versions = client().search_model_versions(f"name='{name}'")
    except Exception:  # noqa: BLE001 - model not registered yet
        return []
    return sorted([{"version": v.version, "aliases": list(v.aliases), "tags": dict(v.tags),
                    "run_id": v.run_id, "created": v.creation_timestamp} for v in versions],
                  key=lambda x: int(x["version"]))


# --------------------------------------------------------------------------- Stage 0
def bootstrap(actor: str = "system") -> dict:
    """Idempotent Stage 0: keys, prompt, v1 registered as @champion, 100% traffic to v1."""
    core.app_key()
    core.worker_key()
    ensure_prompt(actor)
    name = _cfg()["model_name"]
    if not alias_version("champion"):
        mv = register_version("v1", {"status": "production", "approved_by": "NovaBank Governance Board (initial launch)"},
                              actor)
        client().set_registered_model_alias(name, "champion", mv)
        client().set_registered_model_tag(name, "owner", "NovaBank Customer Experience")
        client().update_registered_model(name, "Nova Assist: NovaBank customer-support assistant. "
                                               "Aliases: @champion serves production, @challenger is under evaluation.")
        core.audit(actor, "baseline", "model_registered", "champion", {"version": mv, "nova_version": "v1"})
    deployments = core.production_deployments()
    clean_baseline = (core.current_weights() == {"v1": 100, "v2": 0}
                      and not any(d["litellm_params"].get("silent_model") for d in deployments))
    if core.lifecycle()["stage"] in ("not_initialised", "baseline") and not clean_baseline:
        core.set_traffic(0)
    core.refresh_deployment_versions()
    if core.lifecycle()["stage"] == "not_initialised":
        core.set_lifecycle(stage="baseline", v2_weight=0, shadow=False, champion="v1",
                           window=_new_window("baseline"))
        core.audit(actor, "baseline", "baseline_established", None,
                   {"champion": "v1", "weights": core.current_weights()})
    return core.lifecycle()


# --------------------------------------------------------------------------- Stage 1
def load_proposal() -> dict:
    return yaml.safe_load(PROPOSAL_FILE.read_text(encoding="utf-8"))


def submit_proposal(actor: str) -> None:
    require_stage("baseline", "proposal_rejected", "rolled_back", "offline_failed", "shadow_failed")
    p = load_proposal()
    core.set_lifecycle(stage="proposal_submitted")
    core.audit(actor, "proposal", "proposal_submitted", None,
               {"proposal_id": p["id"], "risk_tier": p["risk"]["tier"]},
               {"proposal_file": "proposals/nova-assist-v2.yaml", "proposal_sha": _sha(PROPOSAL_FILE),
                "model_card": "proposals/model-card-nova-assist-v2.md", "model_card_sha": _sha(MODEL_CARD_FILE)})


def decide_proposal(approver: str, role: str, approve: bool, comment: str) -> None:
    require_stage("proposal_submitted")
    require_role("proposal", role)
    if not comment.strip():
        raise GovernanceError("A decision needs a written rationale.")
    decision = "APPROVED" if approve else "REJECTED"
    core.set_lifecycle(stage="proposal_approved" if approve else "proposal_rejected",
                       proposal_approver=f"{approver} ({role})")
    name = _cfg()["model_name"]
    for k, v in {"proposal.v2.status": decision.lower(), "proposal.v2.approver": f"{approver} ({role})",
                 "proposal.v2.sha": _sha(PROPOSAL_FILE)}.items():
        client().set_registered_model_tag(name, k, v)
    core.audit(f"{approver} ({role})", "proposal", "proposal_decision", decision,
               {"comment": comment, "proposal_id": load_proposal()["id"]},
               {"proposal_sha": _sha(PROPOSAL_FILE)})


# --------------------------------------------------------------------------- Stage 0/2 (jobs)
def job_baseline_eval(job_id: int, actor: str) -> dict:
    """Evaluate the current champion on the golden set when the baseline is established.
    In real life this evidence exists from the champion's own approval; here it also means the
    Stage 2 click only has to score the challenger."""
    from evaluation.run_eval import run_evaluation

    champion = core.lifecycle().get("champion", "v1")
    result = run_evaluation(champion, "baseline-eval", actor, job_id)
    if not core.get_state(f"reference_eval.{champion}"):
        core.set_state(f"reference_eval.{champion}", result)
    core.audit(actor, "baseline", "baseline_evaluated", None, {"champion": champion, "run_id": result["run_id"]},
               {"mlflow_run": result["run_id"]})
    return {"run_id": result["run_id"], "overall": result["overall"]}


def job_offline_eval(job_id: int, actor: str) -> dict:
    from evaluation.run_eval import offline_gate, run_evaluation

    require_stage("proposal_approved", "offline_failed", "offline_evaluating")
    core.set_lifecycle(stage="offline_evaluating")
    try:
        champion = run_evaluation("v1", "offline-eval", actor, job_id)
        # The live sample: a few real answers + real judge calls for the challenger (see policy.yaml).
        challenger = run_evaluation("v2", "offline-eval", actor, job_id,
                                    live_ids=core.policy()["evaluation"]["live_examples"])
    except Exception:
        core.set_lifecycle(stage="proposal_approved")  # evidence incomplete: no decision, can resume
        raise
    checks = offline_gate(challenger, champion)
    evidence = {"champion_run": champion["run_id"], "challenger_run": challenger["run_id"],
                "dataset_version": challenger["dataset_version"], "profile": challenger["profile"]}
    passed = core.record_gate("offline_evaluation", checks, evidence, actor)
    core.set_state("offline_eval", {"champion": champion, "challenger": challenger, "checks": checks,
                                    "passed": passed, "ts": core.now().isoformat()})
    if not core.get_state("reference_eval.v1"):
        core.set_state("reference_eval.v1", champion)  # first champion evaluation = drift reference
    core.set_lifecycle(stage="offline_passed" if passed else "offline_failed")
    client().set_tag(challenger["run_id"], "gate", "PASS" if passed else "FAIL")
    return {"passed": passed, "checks": checks, **evidence}


# --------------------------------------------------------------------------- Stage 3
def register_challenger(actor: str) -> str:
    require_stage("offline_passed")
    ev = core.get_state("offline_eval")
    lc = core.lifecycle()
    mv = register_version("v2", {
        "status": "challenger", "eval_run_id": ev["challenger"]["run_id"],
        "eval_gate": "PASS", "proposal": "proposals/nova-assist-v2.yaml", "proposal_sha": _sha(PROPOSAL_FILE),
        "model_card": "proposals/model-card-nova-assist-v2.md", "model_card_sha": _sha(MODEL_CARD_FILE),
        "approved_by": lc.get("proposal_approver", "unknown")}, actor)
    client().set_registered_model_alias(_cfg()["model_name"], "challenger", mv)
    client().log_artifact(client().get_model_version(_cfg()["model_name"], mv).run_id, str(MODEL_CARD_FILE))
    core.set_lifecycle(stage="challenger_registered", challenger_registry_version=mv)
    core.audit(actor, "registration", "challenger_registered", "@challenger",
               {"registry_version": mv, "nova_version": "v2"},
               {"eval_run_id": ev["challenger"]["run_id"], "proposal_sha": _sha(PROPOSAL_FILE)})
    return mv


# --------------------------------------------------------------------------- traffic changes
def change_traffic(stage: str, v2_percent: int, shadow: bool, approver: str, role: str, reason: str) -> dict:
    """Governed action: edit the gateway's production route (weights / mirroring) + audit it."""
    require_role("traffic_change", role)
    before = core.current_weights()
    after = core.set_traffic(v2_percent, shadow=shadow)
    window = _new_window(stage)
    core.set_lifecycle(stage=stage, v2_weight=v2_percent, shadow=shadow, window=window,
                       window_started=core.now().isoformat())
    core.audit(f"{approver} ({role})", stage, "traffic_change", "APPROVED",
               {"before": before, "after": after, "shadow_mirroring": shadow, "reason": reason, "window": window})
    return after


def start_shadow(approver: str, role: str) -> dict:
    require_stage("challenger_registered", "shadow_failed", "shadow")
    return change_traffic("shadow", 0, True, approver, role,
                          "Start shadow (new window): mirror 100% of traffic to v2 silently")


def review_violation(pair_id: int, reviewer: str, role: str, confirm: bool, note: str) -> None:
    """Human oversight of the LLM judge: a critical violation blocks the shadow gate until a
    reviewer confirms it (it keeps blocking) or overturns it with a written reason."""
    require_role("violation_review", role)
    if not note.strip():
        raise GovernanceError("A review needs a written reason.")
    decision = "confirmed" if confirm else "overturned"
    rows = core.query("""UPDATE governance.shadow_pairs SET review_decision=%s, reviewed_by=%s, review_note=%s
                         WHERE id=%s AND challenger_violation='critical' RETURNING request_id""",
                      (decision, f"{reviewer} ({role})", note, pair_id))
    if not rows:
        raise GovernanceError(f"Pair {pair_id} has no critical violation to review.")
    core.audit(f"{reviewer} ({role})", "shadow", "violation_review", decision.upper(),
               {"pair_id": pair_id, "request_id": rows[0]["request_id"], "note": note})


def start_canary(approver: str, role: str) -> dict:
    require_stage("shadow_passed", "rolled_back")
    if core.lifecycle()["stage"] == "rolled_back" and not core.get_state("shadow_passed_once"):
        raise GovernanceError("Shadow gate has not passed yet.")
    pct = core.policy()["canary"]["weight_percent"]
    return change_traffic("canary", pct, False, approver, role, f"Canary: {pct}% of live traffic to v2")


def next_rollout_step(approver: str, role: str) -> dict:
    lc = require_stage("canary_passed", "rollout_25_passed", "rollout_50_passed")
    steps = core.policy()["rollout"]["steps"]
    current = lc["v2_weight"]
    nxt = next(s for s in steps if s > current)
    return change_traffic(f"rollout_{nxt}", nxt, False, approver, role, f"Rollout step: {nxt}% to v2")


def rollback(actor: str, reason: str, checks: list[dict] | None = None) -> None:
    """Revert the production route to 100% of the current champion and log an incident."""
    lc = core.lifecycle()
    before = core.current_weights()
    after = core.set_traffic(0, champion=lc.get("champion", "v1"))
    core.set_lifecycle(stage="rolled_back", v2_weight=0, shadow=False, rolled_back_from=lc["stage"],
                       rollback_reason=reason, window=_new_window("rolled_back"))
    core.audit(actor, lc["stage"], "INCIDENT_auto_rollback" if actor == "governance-worker" else "rollback",
               "ROLLED_BACK", {"reason": reason, "failed_checks": [c for c in (checks or []) if not c["passed"]],
                               "before": before, "after": after})


# --------------------------------------------------------------------------- replay (job)
def job_replay(job_id: int, count: int, actor: str, simulated: int = 0) -> dict:
    """Send `count` REAL replay-set requests through the production app (exactly like customers
    would), then add `simulated` synthetic requests to the same traffic window (classroom volume)."""
    rows = [json.loads(x) for x in (core.ROOT / "data" / "replay.jsonl").read_text(encoding="utf-8").splitlines() if x]
    offset = core.get_state("replay_offset", 0)
    batch = [rows[(offset + i) % len(rows)] for i in range(count)]
    core.set_state("replay_offset", (offset + count) % len(rows))
    stats = {"ok": 0, "error": 0, "by_version": {}}

    def send(row: dict) -> None:
        def call():
            r = httpx.post(f"{core.APP_URL}/chat", timeout=180, json={
                "message": row["input"], "intent": row["intent"], "category": row["category"]})
            if r.status_code in (429, 502, 503):
                raise RuntimeError(f"{r.status_code} {r.text[:100]}")
            r.raise_for_status()
            return r.json()
        try:
            out = core.with_backoff(call, "replay")
            stats["ok"] += 1
            stats["by_version"][out["model_version"]] = stats["by_version"].get(out["model_version"], 0) + 1
        except Exception:  # noqa: BLE001 - errors are part of what the gate measures
            stats["error"] += 1
        core.job_progress(job_id, f"{stats['ok'] + stats['error']}/{count} sent, by version {stats['by_version']}")

    # Paced like real traffic: a burst faster than the provider allows would make LiteLLM drop
    # mirrored (silent) calls on 429 without logging them, which is a replay artefact, not model quality.
    interval = 60 / core.policy()["replay"]["requests_per_minute"]
    with ThreadPoolExecutor(max_workers=core.policy()["rate_limits"]["concurrency"]) as pool:
        futures = []
        for row in batch:
            futures.append(pool.submit(send, row))
            time.sleep(interval)
        for f in futures:
            f.result()
    stats["simulated"] = simulate.traffic(simulated) if simulated else {"simulated": 0}
    core.job_progress(job_id, f"{stats['ok']} real + {simulated} simulated requests; real by version {stats['by_version']}")
    return stats


# --------------------------------------------------------------------------- Stage 4 gate
def shadow_stats(window: str) -> dict:
    rows = core.query("""SELECT p.* FROM governance.shadow_pairs p JOIN governance.requests r USING (request_id)
                         WHERE r.stage = %s""", (window,))
    judged = [r for r in rows if r["verdict"]]
    errors = [r for r in rows if r["challenger_error"]]
    ok = [r for r in rows if not r["challenger_error"]]
    wins = sum(r["verdict"] == "challenger" for r in judged)
    ties = sum(r["verdict"] == "tie" for r in judged)

    def mean(key: str, rs: list[dict]) -> float | None:
        vals = [r[key] for r in rs if r[key] is not None]
        return statistics.fmean(vals) if vals else None

    return {"pairs": len(rows), "judged": len(judged), "challenger_wins": wins, "ties": ties,
            "real_pairs": sum(not r["simulated"] for r in rows), "real_judged": sum(not r["simulated"] for r in judged),
            "simulated_pairs": sum(r["simulated"] for r in rows),
            "champion_wins": sum(r["verdict"] == "champion" for r in judged),
            "win_tie_rate": (wins + ties) / len(judged) if judged else None,
            "critical_violations": sum(r["challenger_violation"] == "critical" and r["review_decision"] != "overturned"
                                       for r in judged),
            "critical_unreviewed": sum(r["challenger_violation"] == "critical" and r["review_decision"] is None
                                       for r in judged),
            "critical_overturned": sum(r["review_decision"] == "overturned" for r in judged),
            "minor_violations": sum(r["challenger_violation"] == "minor" for r in judged),
            "error_rate": len(errors) / len(rows) if rows else None,
            "champion_latency_ms": mean("champion_latency_ms", ok),
            "challenger_latency_ms": mean("challenger_latency_ms", ok),
            "champion_cost_usd": mean("champion_cost_usd", ok), "challenger_cost_usd": mean("challenger_cost_usd", ok)}


def shadow_gate(actor: str) -> tuple[bool, list[dict], dict]:
    lc = require_stage("shadow")
    p = core.policy()["shadow"]
    s = shadow_stats(lc["window"])
    checks = [core.check("judged_pairs", s["judged"], {"min": p["min_pairs"]}),
              core.check("win_tie_rate", s["win_tie_rate"], {"min": p["min_win_tie_rate"]}),
              core.check("critical_policy_violations", s["critical_violations"], {"max": p["max_critical_violations"]}),
              core.check("challenger_error_rate", s["error_rate"], {"max": p["max_error_rate"]})]
    passed = core.record_gate("shadow", checks, {"window": lc["window"], "stats": s}, actor)
    if passed:
        core.set_traffic(0, shadow=False)  # stop mirroring; canary is a separate approved action
        core.set_state("shadow_passed_once", True)
        core.set_lifecycle(stage="shadow_passed", shadow=False, shadow_stats=s)
    return passed, checks, s


# --------------------------------------------------------------------------- Stages 5-6 live gate
def live_stats(window: str) -> dict:
    """Per-version live metrics for one traffic window.
    Requests, latency, cost and quality come from the app's request log (real + simulated rows);
    on top, LiteLLM's spend logs add real failures the customer never saw because the gateway
    fell back to the champion. Those count against the version that failed."""
    reqs = core.query("""SELECT model_version, latency_ms, cost_usd, error, quality_score, simulated
                         FROM governance.requests WHERE stage = %s AND model_version IS NOT NULL""", (window,))
    hidden = core.query("""SELECT model, COUNT(*) AS n FROM "LiteLLM_SpendLogs"
                           WHERE model_group = %s AND status <> 'success' AND request_tags::jsonb ? %s
                           GROUP BY model""", (_cfg()["production_route"], f"stage:{window}"),
                        conn_factory=core.litellm_db)
    out = {}
    for v in ("v1", "v2"):
        provider = core.route_params(core.route_for(v))["model"]
        rows = [r for r in reqs if r["model_version"] == v]
        ok = [r for r in rows if not r["error"]]
        hidden_failures = sum(h["n"] for h in hidden if h["model"] == provider)
        total = len(rows) + hidden_failures
        failures = len(rows) - len(ok) + hidden_failures
        q = [r["quality_score"] for r in ok if r["quality_score"] is not None]
        lat = sorted(float(r["latency_ms"]) for r in ok)
        out[v] = {"requests": total, "real": sum(not r["simulated"] for r in rows),
                  "simulated": sum(r["simulated"] for r in rows), "failures": failures,
                  "error_rate": failures / total if total else None,
                  "p95_latency_ms": lat[min(len(lat) - 1, int(round(0.95 * (len(lat) - 1))))] if lat else None,
                  "cost_per_request_usd": statistics.fmean(float(r["cost_usd"]) for r in ok) if ok else None,
                  "judged": len(q), "quality": statistics.fmean(q) if q else None}
    return out


def live_checks(window: str) -> tuple[list[dict], dict, bool]:
    """Returns (checks, stats, enough_data). Without enough data there is no decision yet."""
    g = core.policy()["live_gate"]
    s = live_stats(window)
    v1, v2 = s["v1"], s["v2"]
    ratio = lambda a, b: (a / b) if (a is not None and b) else None  # noqa: E731
    checks = [core.check("challenger_requests", v2["requests"], {"min": g["min_challenger_requests"]}),
              core.check("challenger_judged_samples", v2["judged"], {"min": g["min_judged_samples"]}),
              core.check("challenger_error_rate", v2["error_rate"], {"max": g["max_error_rate"]}),
              core.check("p95_latency_ratio_v2_over_v1", ratio(v2["p95_latency_ms"], v1["p95_latency_ms"]),
                         {"max": g["max_p95_latency_ratio"]}),
              core.check("cost_ratio_v2_over_v1", ratio(v2["cost_per_request_usd"], v1["cost_per_request_usd"]),
                         {"max": g["max_cost_ratio"]}),
              core.check("challenger_sampled_quality", v2["quality"], {"min": g["min_quality"]})]
    if v1["requests"] == 0 and v2["requests"] >= g["min_challenger_requests"]:
        # At 100% there is no champion traffic in the window; compare against the canary window's champion.
        ref = core.lifecycle().get("champion_reference") or {}
        checks[3] = core.check("p95_latency_ratio_v2_over_v1 (vs canary champion)",
                               ratio(v2["p95_latency_ms"], ref.get("p95_latency_ms")), {"max": g["max_p95_latency_ratio"]})
        checks[4] = core.check("cost_ratio_v2_over_v1 (vs canary champion)",
                               ratio(v2["cost_per_request_usd"], ref.get("cost_per_request_usd")), {"max": g["max_cost_ratio"]})
    enough = checks[0]["passed"] and checks[1]["passed"]
    return checks, s, enough


def live_gate(actor: str, automatic: bool = False) -> tuple[bool | None, list[dict], dict]:
    """Evaluate the canary / rollout gate. Breach => automatic rollback. Pass => step complete."""
    lc = require_stage(*LIVE_STAGES, *(f"{s}_passed" for s in LIVE_STAGES))
    base = lc["stage"].removesuffix("_passed")
    already_passed = base != lc["stage"]
    checks, stats, enough = live_checks(lc["window"])
    if not enough:
        return None, checks, stats
    if automatic and already_passed and all(c["passed"] for c in checks):
        return True, checks, stats  # monitoring continues at this step; still healthy, nothing new to log
    passed = core.record_gate(base, checks, {"window": lc["window"], "stats": stats,
                                             "automatic": automatic}, actor)
    if not passed:
        rollback(actor, f"{base} gate breached", checks)
        return False, checks, stats
    if not already_passed:
        changes = {"stage": f"{base}_passed"}
        if base == "canary" and stats["v1"]["requests"]:
            changes["champion_reference"] = stats["v1"]
        core.set_lifecycle(**changes)
    return True, checks, stats


# --------------------------------------------------------------------------- Stage 7
def promote(approver: str, role: str) -> str:
    require_stage("rollout_100_passed")
    require_role("promotion", role)
    name = _cfg()["model_name"]
    old, new = alias_version("champion"), alias_version("challenger")
    client().set_registered_model_alias(name, "champion", new)
    client().delete_registered_model_alias(name, "challenger")
    client().set_model_version_tag(name, new, "status", "production")
    client().set_model_version_tag(name, old, "status", "retired")
    client().set_model_version_tag(name, old, "retired_at", core.now().isoformat())
    client().set_registered_model_alias(name, "retired", old)  # kept for rollback, never deleted
    core.set_traffic(0, champion="v2")                          # production route: 100% v2, no challenger
    core.set_lifecycle(stage="promoted", champion="v2", v2_weight=100, window=_new_window("promoted"))
    core.set_state("reference_eval.v2", core.get_state("offline_eval", {}).get("challenger"))
    core.audit(f"{approver} ({role})", "promotion", "champion_promoted", "APPROVED",
               {"new_champion_registry_version": new, "retired_registry_version": old,
                "weights": core.current_weights()})
    return new


# --------------------------------------------------------------------------- continuous governance (job)
def job_drift(job_id: int, actor: str) -> dict:
    from evaluation.run_eval import drift_check, reference_subset, run_evaluation

    champion = core.lifecycle().get("champion", "v1")
    ref = core.get_state(f"reference_eval.{champion}")
    if simulate.enabled():  # full golden set, simulated; `simulation.drift_shift` lets you inject drift
        current = run_evaluation(champion, "drift-check", actor, job_id, sim_shift=simulate.cfg()["drift_shift"])
    else:  # small real probe, compared like-for-like on the same examples
        current = run_evaluation(champion, "drift-check", actor, job_id, fresh=True,
                                 golden_limit=core.policy()["drift"]["probe_examples"])
    if not ref:
        core.set_state(f"reference_eval.{champion}", current)
        core.audit(actor, "continuous_governance", "drift_reference_set", None,
                   {"champion": champion, "run_id": current["run_id"]})
        return {"reference_set": True, "run_id": current["run_id"]}
    reference = ref["overall"] if simulate.enabled() else reference_subset(ref["run_key"], current["example_ids"])
    checks = drift_check(current["overall"], reference)
    passed = core.record_gate("continuous_governance", checks,
                              {"champion": champion, "run_id": current["run_id"], "reference_run": ref["run_id"]}, actor)
    client().set_tag(current["run_id"], "drift_gate", "PASS" if passed else "DRIFT")
    return {"passed": passed, "checks": checks, "run_id": current["run_id"]}


# --------------------------------------------------------------------------- reset
def reset_demo(actor: str) -> None:
    """Restore Stage 0. The audit log is append-only and is NOT wiped: the reset is recorded in it.
    Cached per-example evaluation results are kept (same model + data + judge = same evidence)."""
    core.set_traffic(0)
    name = _cfg()["model_name"]
    v1 = next((v["version"] for v in registry_versions() if v["tags"].get("nova_version") == "v1"), None)
    for alias in ("challenger", "retired"):
        if alias_version(alias):
            client().delete_registered_model_alias(name, alias)
    if v1:
        client().set_registered_model_alias(name, "champion", v1)
        client().set_model_version_tag(name, v1, "status", "production")
    for table in ("requests", "shadow_pairs", "gate_decisions"):
        core.query(f"DELETE FROM governance.{table}")
    core.query("UPDATE governance.jobs SET status = 'cancelled' WHERE status IN ('queued', 'running')")
    for key in ("offline_eval", "shadow_passed_once", "reference_eval.v2", "replay_offset"):
        core.query("DELETE FROM governance.state WHERE key = %s", (key,))
    core.set_lifecycle(stage="baseline", v2_weight=0, shadow=False, champion="v1", window=_new_window("baseline"),
                       champion_reference=None, rollback_reason=None)
    core.audit(actor, "baseline", "demo_reset", None, {"weights": core.current_weights()})
