"""Integration tests against the REAL running stack (no mocks). Each test makes at most a few
real Groq calls through the gateway.

Run (from the repo folder, with the stack up):
    docker compose exec governance-console pytest -q tests
"""
from __future__ import annotations

import time

import httpx
import psycopg
import pytest

from governance import core, lifecycle

PAGES = ["Overview", "0 · Baseline", "1 · Proposal", "2 · Offline evaluation", "3 · Register challenger",
         "4 · Shadow", "5 · Canary", "6 · Gradual rollout", "7 · Promotion & monitoring", "Audit log", "Policy"]


def test_gateway_has_fixed_routes_and_governed_production_route():
    names = {d["model_name"] for d in core.admin("GET", "/model/info")["data"]}
    assert {"nova-v1", "nova-v2", "nova-judge", core.policy()["registry"]["production_route"]} <= names
    weights = core.current_weights()
    assert sum(weights.values()) == 100


def test_app_answers_through_gateway_and_logs_version():
    r = httpx.post(f"{core.APP_URL}/chat", json={"message": "How do I check my card balance?"}, timeout=120)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answer"] and body["model_version"] in ("v1", "v2")
    for _ in range(20):  # the app logs after responding (off the customer path), so allow a moment
        rows = core.query("SELECT model_version, cost_usd FROM governance.requests WHERE request_id = %s",
                          (body["request_id"],))
        if rows:
            break
        time.sleep(0.25)
    assert rows and rows[0]["model_version"] == body["model_version"] and rows[0]["cost_usd"] > 0


def test_app_key_cannot_use_the_judge_route():
    """Least privilege: the production app's virtual key is limited to the production routes."""
    with pytest.raises(RuntimeError, match="401|403"):
        core.chat("nova-judge", [{"role": "user", "content": "hi"}], core.app_key())


def test_registry_has_champion_alias_with_lineage_tags():
    v = lifecycle.alias_version("champion")
    assert v
    tags = next(x["tags"] for x in lifecycle.registry_versions() if x["version"] == v)
    assert tags["nova_version"] in ("v1", "v2") and tags["prompt_uri"].startswith("prompts:/")
    assert tags["gateway_route"] == core.route_for(tags["nova_version"])


def test_gate_check_semantics():
    assert core.check("x", 0.9, {"min": 0.8})["passed"]
    assert not core.check("x", 0.7, {"min": 0.8})["passed"]
    assert core.check("x", 0.01, {"max": 0.02})["passed"]
    assert not core.check("x", None, {"min": 0})["passed"]  # missing evidence never passes


def test_offline_gate_blocks_safety_regression():
    from evaluation.run_eval import offline_gate

    good = {m: (1.0 if "min" in r else 0.0) for m, r in core.policy()["evaluation"]["thresholds"].items()}
    champion = {"overall": good, "slices": {}}
    challenger = {"overall": {**good, "policy_compliance": 0.95}, "slices": {}}  # above bar, but regressed
    checks = offline_gate(challenger, champion)
    regress = [c for c in checks if c["check"].startswith("no_regression.policy_compliance")]
    assert regress and not regress[0]["passed"]
    assert all(c["passed"] for c in checks if not c["check"].startswith("no_regression.policy_compliance"))


def test_audit_log_is_append_only_and_chain_intact():
    with pytest.raises(psycopg.errors.RaiseException):
        core.query("UPDATE governance.audit_log SET actor = 'mallory' WHERE id = 1")
    with pytest.raises(psycopg.errors.RaiseException):
        core.query("DELETE FROM governance.audit_log")
    intact, n, _ = core.verify_audit_chain()
    assert intact and n > 0


def test_rollback_restores_champion_only():
    lc = core.lifecycle()
    if lc["stage"] not in ("baseline", "promoted", "rolled_back"):
        pytest.skip(f"lesson in progress (stage {lc['stage']}); not touching live traffic")
    champion = lc.get("champion", "v1")
    try:
        core.set_traffic(50, champion=champion)
        assert core.current_weights() == {"v1": 50, "v2": 50}
        lifecycle.rollback("integration-test", "test: rollback restores champion")
        assert core.current_weights()[champion] == 100
    finally:
        core.set_traffic(0, champion=champion)
        core.set_lifecycle(**{k: lc.get(k) for k in ("stage", "v2_weight", "shadow", "window", "champion")})


def test_console_pages_render():
    from streamlit.testing.v1 import AppTest

    for page in PAGES:
        at = AppTest.from_file(str(core.ROOT / "console" / "app.py"), default_timeout=60).run()
        at.sidebar.radio[0].set_value(page).run()
        assert not at.exception, f"{page}: {at.exception[0].value}"
