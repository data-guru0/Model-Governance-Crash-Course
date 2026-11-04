"""Classroom simulator: production-sized traffic and evaluation scores WITHOUT spending LLM calls.

Why it exists: a real governance programme looks at thousands of evaluations and requests. On a
free Groq tier that would take days, so in class only a handful of calls are real (to prove the
plumbing works) and the bulk is generated here from the synthetic model profiles in
`governance/policy.yaml -> simulation`. These profiles were invented for teaching; they are not
measurements of the real models.

Rules this module follows so the simulation can never be mistaken for evidence:
  * every row it writes has simulated = true (requests, shadow pairs) or source = "simulated"
    (evaluation results), and every gate decision records the real/simulated split;
  * it never writes into LiteLLM's or MLflow's own tables. Real calls go through the gateway;
    simulated ones don't exist there;
  * it is deterministic (seeded), so the class sees reproducible numbers.
Set `simulation.enabled: false` and every stage uses only real calls (see DEMO.md).
"""
from __future__ import annotations

import json
import math
import random
import uuid

from governance import core


def enabled() -> bool:
    return bool(core.policy().get("simulation", {}).get("enabled"))


def cfg() -> dict:
    return core.policy()["simulation"]


def _rng(tag: str) -> random.Random:
    return random.Random(f"{cfg()['seed']}:{tag}")


def _score(rng: random.Random, mean_sd: list[float], shift: float = 0.0) -> float:
    mean, sd = mean_sd
    return round(max(0.0, min(1.0, rng.gauss(mean + shift, sd))), 3)


def _usage(rng: random.Random, version: str, conf: dict | None = None) -> tuple[float, int, int, float]:
    """Synthetic latency (lognormal), tokens and cost priced with the route's real per-token prices.
    `conf` lets bulk callers pass the config once (each file read costs ~1 ms on a Docker bind mount)."""
    conf = conf or {"sim": cfg(), "prices": {version: core.route_params(core.route_for(version))}}
    p = conf["sim"]["versions"][version]
    latency = p["latency_p50_ms"] * math.exp(rng.gauss(0, p["latency_sigma"]))
    completion = max(20, int(rng.gauss(p["completion_tokens"], p["completion_tokens"] * 0.2)))
    prices = conf["prices"][version]
    cost = p["prompt_tokens"] * prices["input_cost_per_token"] + completion * prices["output_cost_per_token"]
    return latency, p["prompt_tokens"], completion, cost


# --------------------------------------------------------------------------- offline evaluation
def eval_example(ex: dict, version: str, metric_names: list[str], tag: str, shift: float = 0.0) -> dict:
    """One simulated evaluation result, shaped exactly like a real one."""
    rng = _rng(f"eval:{tag}:{version}:{ex['id']}")
    latency, prompt_t, completion_t, cost = _usage(rng, version)
    scores = cfg()["versions"][version]["scores"]
    return {"id": ex["id"], "kind": "redteam" if "attack" in ex else "golden", "slice": ex.get("slice"),
            "input": ex["input"], "output": "[simulated answer]", "source": "simulated",
            "latency_ms": latency, "prompt_tokens": prompt_t, "completion_tokens": completion_t, "cost_usd": cost,
            **{m: _score(rng, scores[m], shift) for m in metric_names}}


# --------------------------------------------------------------------------- live traffic
WEEKDAY_SHAPE = [1.10, 1.15, 1.10, 1.05, 1.00, 0.70, 0.60]   # Mon..Sun: banks are busier on weekdays


def story_week(stage: str) -> int:
    """Which week of the story a lifecycle stage belongs to (policy.yaml story.weeks)."""
    weeks = core.policy()["story"]["weeks"]
    base = stage.removesuffix("_passed").removesuffix("_failed")
    key = {"proposal_submitted": "proposal", "proposal_approved": "proposal", "proposal_rejected": "proposal",
           "offline_evaluating": "offline_evaluation", "offline": "offline_evaluation",
           "challenger_registered": "registration", "promoted": "promotion", "rolled_back": "canary"}.get(base, base)
    return weeks.get(key, 0)


def traffic(n: int) -> dict:
    """Insert n simulated production requests into the CURRENT traffic window, split by the
    current gateway weights. In shadow mode each request also gets a simulated shadow pair."""
    if n <= 0:
        return {"simulated": 0}
    lc = core.lifecycle()
    champion, challenger = lc.get("champion", "v1"), lc.get("challenger")
    share = lc.get("challenger_weight", 0) if challenger else 0
    weights = {champion: 100 - share, **({challenger: share} if challenger else {})}
    rows = [json.loads(x) for x in (core.ROOT / "data" / "replay.jsonl").read_text(encoding="utf-8").splitlines() if x]
    offset = core.get_state("sim_offset", 0)
    core.set_state("sim_offset", offset + n)
    s = cfg()
    rng = random.Random(f"{s['seed']}:traffic:{lc['window']}:{offset}")
    conf = {"sim": s, "prices": {v: core.route_params(core.route_for(v)) for v in weights}}
    week = story_week(lc["stage"])
    requests, pairs, by_version = [], [], {}
    for i in range(n):
        ex = rows[(offset + i) % len(rows)]
        version = champion if lc.get("shadow") else rng.choices(list(weights), weights=list(weights.values()))[0]
        by_version[version] = by_version.get(version, 0) + 1
        latency, prompt_t, completion_t, cost = _usage(rng, version, conf)
        failed = rng.random() < s["versions"][version]["error_rate"]
        rid = f"sim-{uuid.uuid4()}"
        day = week * 7 + rng.choices(range(7), WEEKDAY_SHAPE)[0]
        requests.append((rid, lc["window"], day, ex["intent"], ex["category"], ex["input"],
                         None if failed else "[simulated answer]", version, "simulated", latency, prompt_t,
                         completion_t, cost, "simulated provider error" if failed else None,
                         None if failed else _score(rng, s["versions"][version]["live_quality"]),
                         "simulated"))
        if lc.get("shadow") and not failed:
            sh = s["shadow"]
            c_lat, _, c_comp, c_cost = _usage(rng, challenger, conf)
            mirror_failed = rng.random() < sh["mirror_error_rate"]
            verdict = rng.choices(["challenger", "tie", "champion"],
                                  [sh["challenger_win"], sh["tie"], 1 - sh["challenger_win"] - sh["tie"]])[0]
            violation = rng.choices(["critical", "minor", "none"],
                                    [sh["critical_violation"], sh["minor_violation"],
                                     1 - sh["critical_violation"] - sh["minor_violation"]])[0]
            pairs.append((rid, ex["intent"], ex["input"], "[simulated answer]",
                          None if mirror_failed else "[simulated answer]", latency, None if mirror_failed else c_lat,
                          prompt_t + completion_t, None if mirror_failed else prompt_t + c_comp, cost,
                          None if mirror_failed else c_cost, "simulated mirror failure" if mirror_failed else None,
                          None if mirror_failed else verdict, None if mirror_failed else "simulated judgement",
                          None if mirror_failed else violation))
    # COPY is Postgres's bulk loader: a simulated week (10k rows + pairs) loads in about a second.
    with core.db() as conn, conn.cursor() as cur:
        with cur.copy("""COPY governance.requests (request_id, stage, story_day, intent, category, prompt, response,
                           model_version, model_id, latency_ms, prompt_tokens, completion_tokens, cost_usd, error,
                           quality_score, quality_reason, simulated) FROM STDIN""") as copy:
            for row in requests:
                copy.write_row((*row, True))
        if pairs:
            with cur.copy("""COPY governance.shadow_pairs (request_id, intent, prompt, champion_response,
                               challenger_response, champion_latency_ms, challenger_latency_ms, champion_tokens,
                               challenger_tokens, champion_cost_usd, challenger_cost_usd, challenger_error, verdict,
                               verdict_reason, challenger_violation, judged_at, simulated) FROM STDIN""") as copy:
                judged_at = core.now()
                for row in pairs:
                    copy.write_row((*row, judged_at, True))
    return {"simulated": n, "by_version": by_version, "shadow_pairs": len(pairs)}
