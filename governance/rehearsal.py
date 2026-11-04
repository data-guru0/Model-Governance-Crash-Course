"""Story rehearsal: plays the whole seven-week story automatically, chapter by chapter, using the
same governed functions as the console buttons, then (optionally) resets to Week 0.

Instructors run it from the console (System check) before class to prove the stack works end to
end, without touching a terminal. Each chapter's result, timing and outcome go into the job result.
"""
from __future__ import annotations

import time
from typing import Callable

from governance import core, lifecycle, report

ACTORS = {"po": ("Priya Raman", "Product Owner"), "mro": ("Dr. Amara Celik", "Model Risk Officer"),
          "plat": ("Tomás Okafor", "ML Platform Lead"), "board": ("Board Chair", "Governance Board")}


def _who(k: str) -> str:
    n, r = ACTORS[k]
    return f"{n} ({r})"


def _wait(cond: Callable[[], bool], what: str, limit: float = 150) -> None:
    t = time.time()
    while time.time() - t < limit:
        if cond():
            return
        time.sleep(2)
    raise TimeoutError(f"timed out waiting for: {what}")


def _real_calls_since(ts) -> int:
    return core.query('SELECT COUNT(*) AS n FROM "LiteLLM_SpendLogs" WHERE "startTime" >= %s', (ts,),
                      conn_factory=core.litellm_db)[0]["n"]


def job_rehearsal(job_id: int, actor: str, reset_after: bool = True, rollback_demo: bool = True) -> dict:
    pol = core.policy()
    t_start = time.time()
    db_start = core.query("SELECT now() AS t")[0]["t"]
    chapters: list[dict] = []

    def chapter(name: str, fn: Callable[[], str]) -> None:
        core.job_progress(job_id, f"Chapter {len(chapters)}: {name}…")
        t = time.time()
        try:
            outcome = fn()
            chapters.append({"chapter": name, "ok": True, "seconds": round(time.time() - t, 1), "outcome": outcome})
        except Exception as exc:
            chapters.append({"chapter": name, "ok": False, "seconds": round(time.time() - t, 1), "outcome": str(exc)[:300]})
            raise

    def ch0() -> str:
        lifecycle.reset_demo(_who("mro"))
        out = lifecycle.job_replay(job_id, 1, _who("plat"))
        return f"Week 0 reset; 1 real customer question answered by {list(out['by_version']) or ['none']}"

    def ch1() -> str:
        lifecycle.submit_proposal(_who("po"))
        try:
            lifecycle.decide_proposal("Student", "Student", True, "looks fine")
            raise AssertionError("a Student was allowed to approve")
        except lifecycle.GovernanceError:
            pass
        lifecycle.decide_proposal(*ACTORS["mro"], True, "Rehearsal: medium risk accepted; evaluate both candidates.")
        return "Student refused (role check works); Model Risk Officer approved"

    def ch2() -> str:
        lifecycle.job_offline_eval(job_id, _who("mro"))
        ev = core.get_state("offline_eval")
        res = ", ".join(f"{v} {'PASS' if c['passed'] else 'FAIL'}" for v, c in ev["candidates"].items())
        if not ev["selected"]:
            raise AssertionError(f"no candidate passed the exam ({res})")
        return f"{res}; selected {ev['selected']}"

    def ch3() -> str:
        return f"registry version {lifecycle.register_challenger(_who('plat'))} is @challenger"

    def ch4() -> str:
        lifecycle.start_shadow(*ACTORS["plat"])
        sh = pol["shadow"]
        lifecycle.job_replay(job_id, sh["real_requests"], _who("plat"), sh["simulated_requests"])
        win = core.lifecycle()["window"]
        if sh["real_requests"]:
            _wait(lambda: (lifecycle.shadow_stats(win)["real_judged"] or 0) >= 1 or core.query(
                """SELECT 1 FROM governance.shadow_pairs p JOIN governance.requests r USING (request_id)
                   WHERE r.stage = %s AND NOT p.simulated AND p.challenger_error IS NOT NULL""", (win,)),
                "the real shadow pair to be judged")
        for f in core.query("""SELECT p.id FROM governance.shadow_pairs p JOIN governance.requests r USING (request_id)
                               WHERE r.stage = %s AND p.challenger_violation = 'critical' AND p.review_decision IS NULL""",
                            (win,)):
            lifecycle.review_violation(f["id"], *ACTORS["mro"], False, "Rehearsal review: judge flag checked by MRO")
        passed, checks, s = lifecycle.shadow_gate(_who("mro"))
        if not passed:
            raise AssertionError("shadow gate FAILED: " + ", ".join(c["check"] for c in checks if not c["passed"]))
        return f"gate PASS: {s['judged']:,} judged pairs ({s['real_judged']} real), win+tie {s['win_tie_rate']:.0%}"

    def live_week(stage_label: str, real: int, simulated: int) -> str:
        lifecycle.job_replay(job_id, real, _who("plat"), simulated)
        passed, checks, _ = lifecycle.live_gate(_who("mro"))
        if passed is None:
            raise AssertionError(f"{stage_label}: not enough data for a gate decision")
        if not passed:
            raise AssertionError(f"{stage_label} gate FAILED: " + ", ".join(c["check"] for c in checks if not c["passed"]))
        return f"gate PASS, weights {core.current_weights()}"

    def ch5() -> str:
        lifecycle.start_canary(*ACTORS["plat"])
        return live_week("canary", pol["canary"]["real_requests"], pol["canary"]["simulated_requests"])

    def ch5b() -> str:
        original = core.POLICY_FILE.read_text(encoding="utf-8")
        version = core.policy()["version"]
        try:
            strict = original.replace(f'version: "{version}"', f'version: "{version}-rehearsal"', 1)
            strict = strict.replace("max_p95_latency_ratio: 1.5", "max_p95_latency_ratio: 0.5", 1)
            core.POLICY_FILE.write_text(strict, encoding="utf-8")
            core.audit(_who("mro"), "policy", "policy_changed", "APPROVED",
                       {"reason": "Rehearsal: tighten latency ratio to demonstrate automatic rollback"},
                       {"fingerprint": core.policy_fingerprint()})
            _wait(lambda: core.lifecycle()["stage"] == "rolled_back", "the worker's automatic rollback", 90)
            weights = core.current_weights()
        finally:
            core.POLICY_FILE.write_text(original, encoding="utf-8")
            core.audit(_who("mro"), "policy", "policy_changed", "APPROVED",
                       {"reason": "Rehearsal: restore the original policy"}, {"fingerprint": core.policy_fingerprint()})
        lifecycle.start_canary(*ACTORS["plat"])
        live_week("canary (again)", 0, pol["canary"]["simulated_requests"])
        return f"automatic rollback to {weights}; policy restored; canary passed again"

    def rollout(pct: int) -> Callable[[], str]:
        def run() -> str:
            lifecycle.next_rollout_step(*ACTORS["plat"])
            out = live_week(f"rollout {pct}%", int(pol["rollout"]["real_requests"][str(pct)]),
                            int(pol["rollout"]["simulated_requests"][str(pct)]))
            if pct == 100 and pol["rollout"]["real_requests"]["100"]:
                time.sleep(20)  # let the worker judge the real 100% request before moving on
            return out
        return run

    def ch7() -> str:
        mv = lifecycle.promote(*ACTORS["board"])
        path = report.generate(_who("board"))
        drift = lifecycle.job_drift(job_id, _who("board"))
        return f"registry version {mv} is @champion; report {path.rsplit('/', 1)[-1]}; drift {'PASS' if drift.get('passed') else drift}"

    steps = [("Where we start", ch0), ("The proposal", ch1), ("The exam", ch2), ("Registration", ch3),
             ("Shadow week", ch4), ("Canary week", ch5)]
    if rollback_demo:
        steps.append(("Rollback demo + canary again", ch5b))
    steps += [(f"Rollout {p}% week", rollout(p)) for p in pol["rollout"]["steps"]] + [("Promotion & drift", ch7)]

    error = None
    try:
        for name, fn in steps:
            chapter(name, fn)
    except Exception as exc:  # noqa: BLE001 - reported in the result, story stops here
        error = str(exc)[:300]
    time.sleep(12)  # LiteLLM writes spend logs in batches
    real_calls = _real_calls_since(db_start)
    intact, rows, _ = core.verify_audit_chain()
    result = {"passed": error is None, "error": error, "chapters": chapters, "real_llm_calls": real_calls,
              "seconds": round(time.time() - t_start), "audit_chain_intact": intact, "audit_rows": rows,
              "final_stage": core.lifecycle()["stage"]}
    core.job_progress(job_id, f"{sum(c['ok'] for c in chapters)} of {len(steps)} chapters OK in {result['seconds']} s, "
                              f"{real_calls} real LLM calls")
    core.audit(actor, "system_check", "story_rehearsal", "PASS" if error is None else "FAIL",
               {k: v for k, v in result.items() if k != "chapters"})
    if reset_after:
        lifecycle.reset_demo(actor)
        result["reset_to_week_0"] = True
    return result
