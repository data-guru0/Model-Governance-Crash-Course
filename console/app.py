"""NovaBank Governance Console: drive the whole model-governance lesson from the browser.

Every number on these pages is read live from MLflow, Postgres or the LiteLLM API.
Every button that changes something is a governed action written to the audit log.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
import mlflow  # noqa: E402
import pandas as pd  # noqa: E402
import streamlit as st  # noqa: E402
import yaml  # noqa: E402

from governance import core, lifecycle, report  # noqa: E402
from governance.lifecycle import GovernanceError  # noqa: E402

st.set_page_config(page_title="NovaBank Governance Console", page_icon="🏦", layout="wide")

MLFLOW_UI = "http://localhost:5000"
ROLES = ["Product Owner", "ML Platform Lead", "Model Risk Officer", "Governance Board", "Student"]
PAGES = ["Overview", "0 · Baseline", "1 · Proposal", "2 · Offline evaluation", "3 · Register challenger",
         "4 · Shadow", "5 · Canary", "6 · Gradual rollout", "7 · Promotion & monitoring", "Audit log", "Policy"]


# --------------------------------------------------------------------------- helpers
def actor() -> str:
    return f"{st.session_state.get('name', 'anonymous')} ({st.session_state.get('role', 'Student')})"


def governed(fn, *args, success: str = "Done.") -> object | None:
    """Run a governed action and show the refusal reason instead of a stack trace."""
    try:
        out = fn(*args)
        st.success(success)
        return out
    except GovernanceError as exc:
        st.error(f"Refused: {exc}")
    except Exception as exc:  # noqa: BLE001
        st.exception(exc)
    return None


def run_url(run_id: str) -> str:
    exp = mlflow.get_experiment_by_name(core.policy()["registry"]["experiment"])
    return f"{MLFLOW_UI}/#/experiments/{exp.experiment_id}/runs/{run_id}" if exp else MLFLOW_UI


def show_checks(checks: list[dict]) -> None:
    df = pd.DataFrame([{"result": "✅ PASS" if c["passed"] else "❌ FAIL", "check": c["check"],
                        "value": c["value"], "threshold": json.dumps(c["rule"]), "note": c.get("note", "")}
                       for c in checks])
    st.dataframe(df, hide_index=True, width="stretch")


def gate_banner(passed: bool | None, label: str) -> None:
    if passed is None:
        st.info(f"{label}: not enough data for a decision yet.")
    elif passed:
        st.success(f"### {label}: PASS")
    else:
        st.error(f"### {label}: FAIL")


def approval_form(key: str, action: str, button: str):
    """Shared approver form. Returns (name, role, comment) when submitted."""
    allowed = core.policy()["approvals"][action]
    with st.form(key):
        st.caption(f"Roles allowed to approve this action (governance/policy.yaml): {', '.join(allowed)}")
        name = st.text_input("Approver name", value=st.session_state.get("name", ""))
        role = st.selectbox("Approver role", ROLES, index=ROLES.index(st.session_state.get("role", "Student")))
        comment = st.text_area("Rationale (recorded in the audit log)")
        if st.form_submit_button(button, type="primary"):
            return name or "anonymous", role, comment
    return None


@st.fragment(run_every=5)
def jobs_panel(kinds: tuple[str, ...]) -> None:
    rows = core.query("SELECT * FROM governance.jobs WHERE kind = ANY(%s) ORDER BY id DESC LIMIT 5", (list(kinds),))
    if not rows:
        return
    j = rows[0]
    icon = {"queued": "⏳", "running": "🔄", "done": "✅", "failed": "❌", "cancelled": "⛔"}[j["status"]]
    st.markdown(f"**Latest job #{j['id']} `{j['kind']}`: {icon} {j['status']}** · {j['progress'] or ''}")
    if j["status"] == "failed":
        st.error(j["error"])
    with st.expander("Recent jobs"):
        st.dataframe(pd.DataFrame([{k: r[k] for k in ("id", "kind", "status", "progress", "actor", "created_at",
                                                        "finished_at")} for r in rows]), hide_index=True)


def traffic_metrics(window: str) -> dict:
    stats = lifecycle.live_stats(window)
    cols = st.columns(2)
    for col, v in zip(cols, ("v1", "v2")):
        s = stats[v]
        with col:
            st.markdown(f"**{v} {'(champion)' if v == core.lifecycle().get('champion', 'v1') else '(challenger)'}**")
            a, b, c, d = st.columns(4)
            a.metric("Requests", s["requests"])
            b.metric("Error rate", "–" if s["error_rate"] is None else f"{s['error_rate']:.1%}")
            c.metric("p95 latency", "–" if s["p95_latency_ms"] is None else f"{s['p95_latency_ms']:.0f} ms")
            d.metric("Quality (judged)", "–" if s["quality"] is None else f"{s['quality']:.2f} (n={s['judged']})")
            st.caption("Cost / request: " + ("–" if s["cost_per_request_usd"] is None
                                             else f"${s['cost_per_request_usd']:.6f}"))
    return stats


def replay_button(default: int, label: str = "Send replay traffic") -> None:
    n = st.number_input("Requests to replay (real customer questions from data/replay.jsonl)",
                        min_value=1, max_value=208, value=default, key=f"n-{label}")
    if st.button(label):
        core.enqueue("replay", {"count": int(n)}, actor())
        st.success(f"Queued {n} real requests through the Nova Assist app.")


# --------------------------------------------------------------------------- sidebar
with st.sidebar:
    st.title("🏦 NovaBank")
    st.caption("Model Governance Console · Nova Assist")
    st.text_input("Your name", key="name", value="Instructor")
    st.selectbox("Your role", ROLES, key="role", index=2)
    page = st.radio("Stage", PAGES, label_visibility="collapsed")
    try:
        lc = core.lifecycle()
        st.divider()
        st.markdown(f"**Stage:** `{lc['stage']}`")
        st.markdown(f"**Champion:** `{lc.get('champion', 'v1')}` · **Weights:** `{core.current_weights()}`")
        if lc.get("shadow"):
            st.markdown("**Shadow mirroring:** on")
    except Exception as exc:  # noqa: BLE001
        st.error(f"Stack not ready: {exc}")
        st.stop()
    st.caption("Identity is self-declared in this local demo; production would use SSO.")


# --------------------------------------------------------------------------- pages
if page == "Overview":
    st.title("Nova Assist model governance")
    st.markdown("""**Story.** NovaBank's assistant runs **v1** in production. The product team proposes **v2**.
The governance board says: *prove it, roll it out safely, keep an audit trail.* Work through the stages in the sidebar.""")
    st.subheader("Service health")
    checks = {"LiteLLM gateway": f"{core.LITELLM_URL}/health/liveliness", "MLflow": "http://mlflow:5000/health",
              "Nova Assist app": f"{core.APP_URL}/health"}
    cols = st.columns(len(checks) + 1)
    for col, (name, url) in zip(cols, checks.items()):
        try:
            ok = httpx.get(url, timeout=5).status_code == 200
        except Exception:  # noqa: BLE001
            ok = False
        col.metric(name, "healthy" if ok else "DOWN")
    cols[-1].metric("Postgres", "healthy" if core.query("SELECT 1") else "DOWN")
    st.subheader("Open the tools")
    st.markdown(f"- MLflow (runs, registry, prompts): [{MLFLOW_UI}]({MLFLOW_UI})\n"
                "- LiteLLM admin UI (routes, keys, spend logs): [http://localhost:4000/ui](http://localhost:4000/ui) "
                "· user `admin`, password = `LITELLM_MASTER_KEY` from `.env`\n"
                "- Nova Assist API docs: [http://localhost:8000/docs](http://localhost:8000/docs)")
    st.subheader("Models behind the gateway")
    st.dataframe(pd.DataFrame([{"route": d["model_name"], "provider model": d["litellm_params"]["model"],
                                "weight": d["litellm_params"].get("weight"),
                                "silent_model (mirroring)": d["litellm_params"].get("silent_model"),
                                "version": d["model_info"].get("nova_version"),
                                "stored in": "LiteLLM DB (governed)" if d["model_info"].get("db_model") else "config file"}
                               for d in core.admin("GET", "/model/info")["data"]]), hide_index=True)
    if st.button("Live check: call every model once through the gateway"):
        with st.spinner("Calling Groq through LiteLLM..."):
            for route in ("nova-v1", "nova-v2", "nova-judge"):
                try:
                    out = core.chat(route, [{"role": "user", "content": "Reply with the word OK."}],
                                    core.MASTER_KEY, {"tags": ["health-check"]}, 0, 50)
                    st.write(f"✅ `{route}` → {out['content'][:30]!r} in {out['latency_ms']:.0f} ms")
                except Exception as exc:  # noqa: BLE001
                    st.write(f"❌ `{route}`: {exc}")
    st.subheader("Groq usage so far (from LiteLLM spend logs)")
    usage = core.query("""SELECT model_group, COUNT(*) AS calls, SUM(total_tokens) AS tokens, SUM(spend) AS usd_at_list_price
                          FROM "LiteLLM_SpendLogs" GROUP BY model_group ORDER BY calls DESC""",
                       conn_factory=core.litellm_db)
    st.dataframe(pd.DataFrame(usage), hide_index=True)
    st.caption("Free tier measured for this key: 1,000 requests/day and 8,000 tokens/minute per model.")

elif page == "0 · Baseline":
    st.title("Stage 0 · Baseline")
    st.markdown("v1 is registered in the MLflow Model Registry as **`nova-assist@champion`**, its system prompt "
                "is in the **Prompt Registry**, and the gateway sends **100%** of production traffic to it.")
    prompt = core.get_state("prompt") or {}
    st.markdown(f"**Prompt:** `{prompt.get('uri')}`")
    if prompt.get("sha") and prompt["sha"] != hashlib.sha256(core.system_prompt_text().encode()).hexdigest():
        st.warning("governance/policy.md differs from the registered prompt. Restart the worker to register a new version.")
    st.subheader("Registry versions")
    st.dataframe(pd.DataFrame([{"registry version": v["version"], "aliases": ", ".join(v["aliases"]),
                                **{k: v["tags"].get(k) for k in ("nova_version", "status", "provider_model",
                                                                 "gateway_route", "prompt_uri", "eval_run_id")}}
                               for v in lifecycle.registry_versions()]), hide_index=True)
    st.markdown(f"[Open the registry in MLflow]({MLFLOW_UI}/#/models/nova-assist)")
    st.subheader("Try production")
    q = st.text_input("Ask Nova Assist as a customer", "How do I activate my new debit card?")
    if st.button("Send to the production app"):
        r = httpx.post(f"{core.APP_URL}/chat", json={"message": q}, timeout=120)
        if r.status_code == 200:
            d = r.json()
            st.info(d["answer"])
            st.caption(f"request_id {d['request_id']} · answered by **{d['model_version']}**")
        else:
            st.error(r.text)
    st.subheader("Reset demo")
    st.caption("Restores Stage 0: 100% v1, @champion → v1, clears traffic, shadow pairs and gate decisions. "
               "The audit log is append-only, so the reset itself is recorded there.")
    if st.checkbox("I understand this restarts the lesson") and st.button("Reset demo", type="primary"):
        governed(lifecycle.reset_demo, actor(), success="Reset to Stage 0.")

elif page == "1 · Proposal":
    st.title("Stage 1 · Model proposal")
    p = lifecycle.load_proposal()
    st.markdown(f"### {p['id']}: {p['title']}")
    c1, c2, c3 = st.columns(3)
    c1.metric("Risk tier", p["risk"]["tier"])
    est = p["expected_cost_impact"]["estimated_cost_per_1k_requests_usd"]
    c2.metric("Est. cost / 1K requests", f"${est['v2']:.3f}", f"{est['v2'] / est['v1'] - 1:+.0%} vs v1",
              delta_color="inverse")
    c3.metric("Owner", p["owner"]["name"])
    st.markdown(f"**Business justification.** {p['business_justification']}")
    st.markdown("**Intended use**\n" + "\n".join(f"- {x}" for x in p["intended_use"]))
    st.markdown("**Out of scope**\n" + "\n".join(f"- {x}" for x in p["out_of_scope_use"]))
    st.markdown("**Risk assessment**")
    st.dataframe(pd.DataFrame(p["risk"]["assessment"]), hide_index=True)
    st.markdown("**Success criteria**\n" + "\n".join(f"- {x}" for x in p["success_criteria"]))
    st.markdown(f"**Rollback plan.** {p['rollback_plan']}")
    with st.expander("Model card (proposals/model-card-nova-assist-v2.md)"):
        st.markdown(lifecycle.MODEL_CARD_FILE.read_text(encoding="utf-8"))
    with st.expander("Raw proposal YAML"):
        st.code(lifecycle.PROPOSAL_FILE.read_text(encoding="utf-8"), language="yaml")
    stage = core.lifecycle()["stage"]
    if stage in ("baseline", "proposal_rejected", "rolled_back", "offline_failed", "shadow_failed"):
        if st.button("Submit proposal to the governance board", type="primary"):
            governed(lifecycle.submit_proposal, actor(), success="Submitted.")
            st.rerun()
    elif stage == "proposal_submitted":
        st.subheader("Board decision")
        decision = st.radio("Decision", ["Approve", "Reject"], horizontal=True)
        res = approval_form("proposal-form", "proposal", "Record decision")
        if res:
            governed(lifecycle.decide_proposal, res[0], res[1], decision == "Approve", res[2],
                     success=f"Decision recorded: {decision}.")
    else:
        st.info(f"Proposal decided. Approver: {core.lifecycle().get('proposal_approver', 'n/a')}.")

elif page == "2 · Offline evaluation":
    st.title("Stage 2 · Offline evaluation")
    ev_cfg = core.policy()["evaluation"]
    prof = ev_cfg["profiles"][ev_cfg["profile"]]
    st.markdown(f"Both versions answer the **same** golden set (profile `{ev_cfg['profile']}`: {prof['per_slice']} "
                f"per {prof['slice_by']}) plus 1 red-team prompt per attack type; judge `{ev_cfg['judge_route']}` "
                f"(`{core.route_params(ev_cfg['judge_route'])['model']}`) scores them with DeepEval.")
    stage = core.lifecycle()["stage"]
    if stage in ("proposal_approved", "offline_failed"):
        if st.button("Run offline evaluation (v1 and v2)", type="primary"):
            core.enqueue("offline_eval", {}, actor())
            st.success("Queued. Demo profile: about 5-10 minutes on the Groq free tier (the v1 baseline is reused).")
    elif stage in ("baseline", "proposal_submitted", "proposal_rejected"):
        st.warning("The proposal must be approved first (Stage 1).")
    jobs_panel(("offline_eval",))
    ev = core.get_state("offline_eval")
    if ev:
        gate_banner(ev["passed"], "Offline gate")
        ch, cp = ev["challenger"], ev["champion"]
        st.markdown(f"MLflow runs: [v1 champion]({run_url(cp['run_id'])}) · [v2 challenger]({run_url(ch['run_id'])})")
        rows = []
        for m, v2 in ch["overall"].items():
            v1 = cp["overall"].get(m)
            rows.append({"metric": m, "v1 champion": v1, "v2 challenger": v2,
                         "Δ": (v2 - v1) if isinstance(v1, (int, float)) and isinstance(v2, (int, float)) else None,
                         "threshold": json.dumps(ev_cfg["thresholds"].get(m, "")) if m in ev_cfg["thresholds"] else ""})
        st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
        st.subheader(f"Per-{prof['slice_by']} slices (a regression in one slice can't hide behind the average)")
        slice_rows = [{"slice": s, "metric": m, "v1": cp["slices"].get(s, {}).get(m), "v2": d.get(m)}
                      for s, d in ch["slices"].items() for m in ("correctness", "policy_compliance", "helpfulness")]
        sdf = pd.DataFrame(slice_rows)
        st.bar_chart(sdf[sdf.metric == "correctness"].set_index("slice")[["v1", "v2"]], stack=False)
        st.dataframe(sdf.pivot(index="slice", columns="metric", values=["v1", "v2"]), width="stretch")
        st.subheader("Gate checks")
        show_checks(ev["checks"])

elif page == "3 · Register challenger":
    st.title("Stage 3 · Register the challenger")
    st.markdown("""MLflow deprecated the fixed *Staging / Production / Archived* stages (since MLflow 2.9).
**Aliases** are mutable named pointers to a version: `@champion` and `@challenger` here. Moving an alias is one
atomic, auditable operation, a model can be in any number of named roles, and deployments resolve
`models:/nova-assist@champion` instead of a hard-coded version number.""")
    stage = core.lifecycle()["stage"]
    if stage == "offline_passed":
        if st.button("Register v2 as nova-assist@challenger", type="primary"):
            mv = governed(lifecycle.register_challenger, actor(), success="Registered.")
            if mv:
                st.markdown(f"Registered version **{mv}**.")
    elif stage in ("offline_failed",):
        st.error("The offline gate failed: v2 cannot be registered.")
    else:
        st.info(f"Current stage: `{stage}`.")
    st.dataframe(pd.DataFrame([{"registry version": v["version"], "aliases": ", ".join(v["aliases"]), **v["tags"]}
                               for v in lifecycle.registry_versions()]), hide_index=True)

elif page == "4 · Shadow":
    st.title("Stage 4 · Shadow deployment")
    st.markdown("""LiteLLM **mirrors** every production request to v2 (`silent_model`). Customers only ever see the
v1 answer. The worker pairs both answers from LiteLLM's logs and the judge compares them, with A/B
positions randomised to counter position bias.""")
    lc = core.lifecycle()
    if lc["stage"] in ("challenger_registered", "shadow_failed"):
        res = approval_form("shadow-form", "traffic_change", "Approve: start shadow mirroring")
        if res:
            governed(lifecycle.start_shadow, res[0], res[1], success="Mirroring on.")
    if lc["stage"] == "shadow":
        replay_button(core.policy()["shadow"]["replay_requests"])
        jobs_panel(("replay",))
        s = lifecycle.shadow_stats(lc["window"])
        a, b, c, d, e = st.columns(5)
        a.metric("Pairs", s["pairs"])
        b.metric("Judged", s["judged"])
        c.metric("Win + tie rate", "–" if s["win_tie_rate"] is None else f"{s['win_tie_rate']:.0%}")
        d.metric("Critical violations", s["critical_violations"])
        e.metric("Challenger errors", "–" if s["error_rate"] is None else f"{s['error_rate']:.1%}")
        st.caption(f"Wins v2 {s['challenger_wins']} · ties {s['ties']} · wins v1 {s['champion_wins']} · "
                   f"mean latency v1 {s['champion_latency_ms'] or 0:.0f} ms vs v2 {s['challenger_latency_ms'] or 0:.0f} ms")
        pairs = core.query("""SELECT p.intent, p.prompt, p.champion_response, p.challenger_response, p.verdict,
                              p.challenger_violation, p.verdict_reason FROM governance.shadow_pairs p
                              JOIN governance.requests r USING (request_id) WHERE r.stage = %s ORDER BY p.id DESC""",
                           (lc["window"],))
        st.dataframe(pd.DataFrame(pairs), hide_index=True, width="stretch")
        if st.button("Check shadow gate", type="primary"):
            out = governed(lifecycle.shadow_gate, actor(), success="Gate evaluated.")
            if out:
                gate_banner(out[0], "Shadow gate")
                show_checks(out[1])
    elif lc["stage"] in ("shadow_passed", "canary", "canary_passed") or lc["stage"].startswith("rollout"):
        st.success("Shadow gate passed.")
        st.json(lc.get("shadow_stats") or {})

elif page in ("5 · Canary", "6 · Gradual rollout"):
    canary = page.startswith("5")
    st.title("Stage 5 · Canary" if canary else "Stage 6 · Gradual rollout")
    lc = core.lifecycle()
    g = core.policy()["live_gate"]
    st.markdown(f"Live gate (policy): ≥ {g['min_challenger_requests']} challenger requests, ≥ {g['min_judged_samples']} "
                f"judged, error rate ≤ {g['max_error_rate']:.0%}, p95 latency ≤ {g['max_p95_latency_ratio']}× v1, "
                f"cost ≤ {g['max_cost_ratio']}× v1, quality ≥ {g['min_quality']}. The worker re-checks every "
                f"{g['auto_check_interval_seconds']} s and **rolls back automatically** on a breach.")
    if lc["stage"] == "rolled_back":
        st.error(f"⛔ Rolled back from `{lc.get('rolled_back_from')}`: {lc.get('rollback_reason')}. "
                 "Production is 100% v1. See the incident in the Audit log.")
        last = core.query("SELECT checks FROM governance.gate_decisions WHERE passed = false ORDER BY id DESC LIMIT 1")
        if last:
            show_checks(last[0]["checks"])
    if canary and lc["stage"] in ("shadow_passed", "rolled_back"):
        res = approval_form("canary-form", "traffic_change",
                            f"Approve: send {core.policy()['canary']['weight_percent']}% of traffic to v2")
        if res:
            governed(lifecycle.start_canary, res[0], res[1], success="Canary started.")
    if not canary and lc["stage"] in ("canary_passed", "rollout_25_passed", "rollout_50_passed"):
        nxt = next(s for s in core.policy()["rollout"]["steps"] if s > lc["v2_weight"])
        res = approval_form("rollout-form", "traffic_change", f"Approve: advance to {nxt}% v2")
        if res:
            governed(lifecycle.next_rollout_step, res[0], res[1], success=f"Now at {nxt}%.")
    live = lc["stage"].removesuffix("_passed") in lifecycle.LIVE_STAGES
    if live and (canary == (lc["stage"].startswith("canary"))):
        st.subheader(f"Live window `{lc['window']}` · v2 weight {lc['v2_weight']}%")
        default = core.policy()["canary"]["replay_requests"] if canary else \
            int(core.policy()["rollout"]["replay_requests"].get(str(lc["v2_weight"]), 20))
        replay_button(default)
        jobs_panel(("replay",))
        traffic_metrics(lc["window"])
        c1, c2 = st.columns(2)
        if c1.button("Check gate now", type="primary"):
            out = governed(lifecycle.live_gate, actor(), success="Gate evaluated.")
            if out:
                gate_banner(out[0], "Live gate")
                show_checks(out[1])
        if c2.button("Manual rollback to 100% v1"):
            governed(lifecycle.rollback, actor(), "manual rollback by operator", success="Rolled back.")
        if lc["stage"].endswith("_passed"):
            st.success(f"`{lc['stage'].removesuffix('_passed')}` gate passed. Monitoring continues at this step.")
    history = core.query("""SELECT ts, stage, passed, policy_version FROM governance.gate_decisions
                            WHERE stage IN ('canary','rollout_25','rollout_50','rollout_100') ORDER BY id""")
    if history:
        st.subheader("Gate history")
        st.dataframe(pd.DataFrame(history), hide_index=True)

elif page == "7 · Promotion & monitoring":
    st.title("Stage 7 · Promotion, retirement and continuous governance")
    lc = core.lifecycle()
    if lc["stage"] == "rollout_100_passed":
        res = approval_form("promote-form", "promotion", "Approve: promote v2 to @champion, retire v1")
        if res:
            governed(lifecycle.promote, res[0], res[1], success="v2 is now @champion; v1 retired (kept).")
    elif lc["stage"] == "promoted":
        st.success("v2 is @champion. v1 is tagged `retired` with alias @retired, kept for rollback.")
    else:
        st.info(f"Promotion requires a passed 100% rollout gate. Current stage: `{lc['stage']}`.")
    st.dataframe(pd.DataFrame([{"registry version": v["version"], "aliases": ", ".join(v["aliases"]),
                                "nova_version": v["tags"].get("nova_version"), "status": v["tags"].get("status")}
                               for v in lifecycle.registry_versions()]), hide_index=True)
    st.subheader("Governance report")
    if st.button("Generate governance report from live records"):
        path = governed(report.generate, actor(), success="Report written to reports/ and logged to MLflow.")
        if path:
            text = Path(path).read_text(encoding="utf-8")
            st.download_button("Download report (Markdown)", text, file_name=Path(path).name)
            st.markdown(text)
    st.subheader("Continuous governance: drift re-evaluation of the current champion")
    st.caption(f"Re-runs the offline suite on @champion with fresh calls and compares it with that champion's "
               f"reference evaluation; allowed drop per metric: {core.policy()['drift']['max_drop']}.")
    if st.button("Run drift check now"):
        core.enqueue("drift", {}, actor())
        st.success("Queued.")
    jobs_panel(("drift",))
    last = core.query("""SELECT * FROM governance.gate_decisions WHERE stage = 'continuous_governance'
                         ORDER BY id DESC LIMIT 1""")
    if last:
        gate_banner(last[0]["passed"], f"Drift check {last[0]['ts']:%Y-%m-%d %H:%M}")
        show_checks(last[0]["checks"])

elif page == "Audit log":
    st.title("Audit log (append-only, hash-chained)")
    intact, n, bad = core.verify_audit_chain()
    (st.success if intact else st.error)(f"Hash chain over {n} entries: {'INTACT' if intact else f'BROKEN at id {bad}'}")
    st.caption("UPDATE, DELETE and TRUNCATE on this table are blocked by Postgres triggers. "
               "Each row's hash covers the previous row's hash, so editing history is detectable.")
    since_reset = st.toggle("Only since the last demo reset", value=True)
    last_reset = core.query("SELECT COALESCE(MAX(id),0) AS id FROM governance.audit_log WHERE action='demo_reset'")[0]["id"]
    rows = core.query("SELECT * FROM governance.audit_log WHERE id > %s ORDER BY id DESC",
                      (last_reset - 1 if since_reset and last_reset else 0,))
    st.dataframe(pd.DataFrame([{"id": r["id"], "time": r["ts"], "actor": r["actor"], "stage": r["stage"],
                                "action": r["action"], "decision": r["decision"],
                                "details": json.dumps(r["details"], default=str)[:300],
                                "evidence": json.dumps(r["evidence"], default=str)[:200], "hash": r["hash"][:12]}
                               for r in rows]), hide_index=True, width="stretch")
    if st.button("Prove it: try to edit history"):
        try:
            core.query("UPDATE governance.audit_log SET decision = 'APPROVED' WHERE id = 1")
            st.error("Update succeeded: the log is NOT protected!")
        except Exception as exc:  # noqa: BLE001
            st.success(f"Postgres refused the edit: {str(exc).splitlines()[0]}")

elif page == "Policy":
    st.title("Governance policy (governance/policy.yaml)")
    st.markdown("All gate thresholds live here, versioned. Changing them is a governed action: the role is "
                "checked, the version must change, and the diff is written to the audit log. "
                "**Rollback demo:** during a rollout step, tighten `live_gate.max_p95_latency_ratio` "
                "(e.g. to `0.5`) and save. The worker re-checks within "
                f"{core.policy()['live_gate']['auto_check_interval_seconds']} s and rolls back for real.")
    current = core.POLICY_FILE.read_text(encoding="utf-8")
    st.caption(f"Current fingerprint `{core.policy_fingerprint()}` · allowed editors: "
               f"{', '.join(core.policy()['approvals']['policy_change'])}")
    with st.form("policy-form"):
        new = st.text_area("policy.yaml", current, height=600)
        why = st.text_input("Reason for the change (required)")
        submitted = st.form_submit_button("Save new policy version", type="primary")
    if submitted:
        try:
            lifecycle.require_role("policy_change", st.session_state.get("role", "Student"))
            parsed = yaml.safe_load(new)
            if parsed.get("version") == yaml.safe_load(current).get("version"):
                raise GovernanceError("Bump the `version:` field for a new policy version.")
            if not why.strip():
                raise GovernanceError("A reason is required.")
            for section in ("evaluation", "shadow", "live_gate", "approvals", "rate_limits"):
                if section not in parsed:
                    raise GovernanceError(f"Missing section `{section}`.")
            diff = "\n".join(difflib.unified_diff(current.splitlines(), new.splitlines(), "before", "after", lineterm=""))
            core.POLICY_FILE.write_text(new.replace("\r\n", "\n"), encoding="utf-8")
            core.audit(actor(), "policy", "policy_changed", "APPROVED",
                       {"reason": why, "new_version": parsed["version"], "diff": diff[:4000]},
                       {"fingerprint": core.policy_fingerprint()})
            st.success(f"Saved policy version {parsed['version']}.")
            st.code(diff, language="diff")
        except GovernanceError as exc:
            st.error(f"Refused: {exc}")
        except yaml.YAMLError as exc:
            st.error(f"Invalid YAML: {exc}")
