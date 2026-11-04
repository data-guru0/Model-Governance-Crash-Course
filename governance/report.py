"""Stage 7 governance report: one Markdown document generated purely from recorded data
(proposal file, MLflow registry, gate decisions, shadow pairs, audit log)."""
from __future__ import annotations

import json

import mlflow

from governance import core, lifecycle


def _table(rows: list[dict], cols: list[str]) -> str:
    if not rows:
        return "_none recorded_\n"
    out = "| " + " | ".join(cols) + " |\n|" + "---|" * len(cols) + "\n"
    for r in rows:
        out += "| " + " | ".join(str(r.get(c, "")).replace("|", "/").replace("\n", " ")[:160] for c in cols) + " |\n"
    return out


def _fmt(v) -> str:
    return f"{v:.3f}" if isinstance(v, float) else str(v)


def generate(actor: str) -> str:
    p = lifecycle.load_proposal()
    lc = core.lifecycle()
    ev = core.get_state("offline_eval") or {}
    gates = core.query("SELECT ts, stage, passed, checks, policy_version FROM governance.gate_decisions ORDER BY id")
    last_reset = core.query("""SELECT COALESCE(MAX(id), 0) AS id FROM governance.audit_log
                               WHERE action = 'demo_reset'""")[0]["id"]
    audit = core.query("SELECT * FROM governance.audit_log WHERE id > %s ORDER BY id", (last_reset,))
    intact, n, bad = core.verify_audit_chain()
    ts = core.now()

    md = [f"# Governance report: {p['title']}",
          f"Generated {ts:%Y-%m-%d %H:%M UTC} by {actor} from live records. Policy `{core.policy_fingerprint()}`, "
          f"git commit `{core.git_commit()[:10]}`.\n",
          f"**Outcome:** lifecycle stage `{lc['stage']}`, champion `{lc.get('champion')}`, "
          f"production weights `{core.current_weights()}`.\n",
          "## 1. Proposal",
          f"- ID: {p['id']}, submitted by {p['submitted_by']['name']} ({p['submitted_by']['role']})",
          f"- Risk tier: **{p['risk']['tier']}**",
          f"- Justification: {p['business_justification'].strip()}",
          f"- Rollback plan: {p['rollback_plan'].strip()}",
          f"- Estimated cost per 1K requests: {p['expected_cost_impact']['estimated_cost_per_1k_requests_usd']}\n",
          "## 2. Model registry (`nova-assist`)",
          _table([{"version": v["version"], "aliases": ", ".join(v["aliases"]),
                   "nova_version": v["tags"].get("nova_version"), "status": v["tags"].get("status"),
                   "provider_model": v["tags"].get("provider_model"), "eval_run": v["tags"].get("eval_run_id", "")}
                  for v in lifecycle.registry_versions()],
                 ["version", "aliases", "nova_version", "status", "provider_model", "eval_run"])]

    md.append("## 3. Offline evaluation")
    if ev:
        ch, cp = ev["challenger"]["overall"], ev["champion"]["overall"]
        md.append(f"Dataset `{ev['challenger']['dataset_version']}` (profile `{ev['challenger']['profile']}`), "
                  f"MLflow runs: champion `{ev['champion']['run_id']}`, challenger `{ev['challenger']['run_id']}`.\n")
        md.append(_table([{"metric": k, "v1 (champion)": _fmt(cp.get(k)), "v2 (challenger)": _fmt(ch.get(k))}
                          for k in ch], ["metric", "v1 (champion)", "v2 (challenger)"]))
        md.append(f"Gate: **{'PASS' if ev['passed'] else 'FAIL'}**\n")
        md.append(_table(ev["checks"], ["check", "value", "rule", "passed"]))
    else:
        md.append("_not run yet_\n")

    md.append("## 4. Shadow deployment")
    md.append("```json\n" + json.dumps(lc.get("shadow_stats") or {}, indent=2, default=str) + "\n```\n")

    md.append("## 5. Gate decisions (shadow, canary, rollout, drift)")
    md.append(_table([{"time": f"{g['ts']:%Y-%m-%d %H:%M:%S}", "stage": g["stage"],
                       "result": "PASS" if g["passed"] else "FAIL", "policy": g["policy_version"],
                       "failed checks": ", ".join(c["check"] for c in g["checks"] if not c["passed"]) or "-"}
                      for g in gates], ["time", "stage", "result", "policy", "failed checks"]))

    md.append("## 6. Traffic timeline and approvals")
    md.append(_table([{"time": f"{a['ts']:%H:%M:%S}", "actor": a["actor"], "stage": a["stage"],
                       "action": a["action"], "decision": a["decision"] or "",
                       "detail": json.dumps(a["details"].get("after") or a["details"].get("comment")
                                            or a["details"].get("reason") or "", default=str)}
                      for a in audit if a["action"] in ("proposal_decision", "traffic_change", "rollback",
                                                        "INCIDENT_auto_rollback", "champion_promoted",
                                                        "policy_changed", "challenger_registered")],
                     ["time", "actor", "stage", "action", "decision", "detail"]))

    md.append("## 7. Full audit trail (since last demo reset)")
    md.append(f"Hash chain verification over all {n} rows: **{'INTACT' if intact else f'BROKEN at row {bad}'}**\n")
    md.append(_table([{"id": a["id"], "time": f"{a['ts']:%Y-%m-%d %H:%M:%S}", "actor": a["actor"],
                       "stage": a["stage"], "action": a["action"], "decision": a["decision"] or "",
                       "hash": a["hash"][:12]} for a in audit],
                     ["id", "time", "actor", "stage", "action", "decision", "hash"]))

    text = "\n".join(md)
    path = core.ROOT / "reports" / f"governance-report-{ts:%Y%m%d-%H%M%S}.md"
    path.write_text(text, encoding="utf-8")
    mlflow.set_experiment(core.policy()["registry"]["experiment"])
    with mlflow.start_run(run_name="governance-report"):
        mlflow.set_tags({"stage": "report", "actor": actor})
        mlflow.log_artifact(str(path))
    core.audit(actor, "promotion", "report_generated", None, {"file": f"reports/{path.name}"})
    return str(path)
