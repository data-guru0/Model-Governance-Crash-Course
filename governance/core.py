"""Shared governance plumbing used by the app, the worker, the console and the tests.

Everything here talks to real services: Postgres (audit log, state), the LiteLLM gateway
(chat + model-management API) and the MLflow tracking server / Model Registry.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import httpx
import psycopg
import yaml
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parent.parent
POLICY_FILE = ROOT / "governance" / "policy.yaml"
SYSTEM_PROMPT_FILE = ROOT / "governance" / "policy.md"
LITELLM_CONFIG_FILE = ROOT / "litellm_config.yaml"

LITELLM_URL = os.environ.get("LITELLM_URL", "http://localhost:4000")
MASTER_KEY = os.environ.get("LITELLM_MASTER_KEY", "")
GOV_DB_URL = os.environ.get("GOV_DB_URL", "")
LITELLM_DB_URL = os.environ.get("LITELLM_DB_URL", "")
APP_URL = os.environ.get("APP_URL", "http://localhost:8000")


# --------------------------------------------------------------------------- config
def policy() -> dict:
    """Current governance policy. Re-read on every call so threshold edits apply immediately."""
    return yaml.safe_load(POLICY_FILE.read_text(encoding="utf-8"))


def policy_fingerprint() -> str:
    """`<version>@<sha12>`: the version label plus a content hash, recorded on every gate decision."""
    text = POLICY_FILE.read_text(encoding="utf-8")
    return f"{yaml.safe_load(text)['version']}@{hashlib.sha256(text.encode()).hexdigest()[:12]}"


def system_prompt_text() -> str:
    return SYSTEM_PROMPT_FILE.read_text(encoding="utf-8").strip()


def route_params(route: str) -> dict:
    """litellm_params of a fixed route (nova-v1 / nova-v2 / nova-judge) from litellm_config.yaml."""
    cfg = yaml.safe_load(LITELLM_CONFIG_FILE.read_text(encoding="utf-8"))
    for m in cfg["model_list"]:
        if m["model_name"] == route:
            return dict(m["litellm_params"])
    raise KeyError(f"route {route!r} not in litellm_config.yaml")


def route_for(version: str) -> str:
    return f"nova-{version}"


def version_for_deployment(model_id: str | None) -> str | None:
    """Map the deployment ID LiteLLM returns (x-litellm-model-id) to our version label.
    The map is refreshed by set_traffic(), so the app never needs gateway admin rights."""
    return get_state("deployment_versions", {}).get(model_id or "")


def git_commit() -> str:
    """Commit of the repo the code runs from, read straight from .git (no git binary in the image)."""
    git = ROOT / ".git"
    try:
        head = (git / "HEAD").read_text().strip()
        if not head.startswith("ref: "):
            return head
        ref = head[5:]
        if (git / ref).exists():
            return (git / ref).read_text().strip()
        for line in (git / "packed-refs").read_text().splitlines():
            if line.endswith(ref):
                return line.split()[0]
    except OSError:
        pass
    return "unknown"


def now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- database
def db() -> psycopg.Connection:
    return psycopg.connect(GOV_DB_URL, row_factory=dict_row, autocommit=True)


def litellm_db() -> psycopg.Connection:
    return psycopg.connect(LITELLM_DB_URL, row_factory=dict_row, autocommit=True)


def query(sql: str, params: Any = None, conn_factory: Callable = db) -> list[dict]:
    with conn_factory() as conn:
        cur = conn.execute(sql, params)
        return cur.fetchall() if cur.description else []


def get_state(key: str, default: Any = None) -> Any:
    rows = query("SELECT value FROM governance.state WHERE key = %s", (key,))
    return rows[0]["value"] if rows else default


def set_state(key: str, value: Any) -> None:
    query("""INSERT INTO governance.state (key, value, updated_at) VALUES (%s, %s, now())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
          (key, Jsonb(value)))


def lifecycle() -> dict:
    return get_state("lifecycle", {"stage": "not_initialised", "v2_weight": 0, "shadow": False})


def set_lifecycle(**changes: Any) -> dict:
    state = {**lifecycle(), **changes}
    set_state("lifecycle", state)
    return state


# --------------------------------------------------------------------------- audit log
def _audit_hash(prev_hash: str | None, row: dict) -> str:
    canonical = json.dumps(row, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(((prev_hash or "") + canonical).encode()).hexdigest()


def audit(actor: str, stage: str, action: str, decision: str | None = None,
          details: dict | None = None, evidence: dict | None = None) -> dict:
    """Append one entry to the hash-chained, append-only audit log."""
    with db() as conn, conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(4242)")  # serialise writers so the chain stays linear
        last = conn.execute("SELECT hash FROM governance.audit_log ORDER BY id DESC LIMIT 1").fetchone()
        prev = last["hash"] if last else None
        row = {"ts": now().isoformat(), "actor": actor, "stage": stage, "action": action,
               "decision": decision, "details": details or {}, "evidence": evidence or {}}
        h = _audit_hash(prev, row)
        conn.execute("""INSERT INTO governance.audit_log
                        (ts, actor, stage, action, decision, details, evidence, prev_hash, hash)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                     (row["ts"], actor, stage, action, decision, Jsonb(row["details"]),
                      Jsonb(row["evidence"]), prev, h))
    return {**row, "hash": h}


def verify_audit_chain() -> tuple[bool, int, int | None]:
    """Recompute every hash. Returns (intact, rows_checked, first_bad_id)."""
    rows = query("SELECT * FROM governance.audit_log ORDER BY id")
    prev = None
    for r in rows:
        content = {"ts": r["ts"].isoformat(), "actor": r["actor"], "stage": r["stage"],
                   "action": r["action"], "decision": r["decision"],
                   "details": r["details"], "evidence": r["evidence"]}
        if r["prev_hash"] != prev or _audit_hash(prev, content) != r["hash"]:
            return False, len(rows), r["id"]
        prev = r["hash"]
    return True, len(rows), None


# --------------------------------------------------------------------------- rate-limit aware retry
def with_backoff(fn: Callable[[], Any], what: str = "call") -> Any:
    """Retry on Groq/LiteLLM rate limits and transient errors with exponential backoff + jitter."""
    lim = policy()["rate_limits"]
    for attempt in range(1, lim["max_attempts"] + 1):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - classify below, re-raise the rest
            text = str(exc).lower()
            transient = any(s in text for s in ("429", "rate limit", "ratelimit", "rate_limit",
                                                "timeout", "timed out", "503", "502", "500",
                                                "overloaded", "connection"))
            if not transient or attempt == lim["max_attempts"]:
                raise
            time.sleep(lim["backoff_seconds"] * 2 ** (attempt - 1) + random.uniform(0, 1))
    raise RuntimeError(f"{what}: retries exhausted")  # unreachable


# --------------------------------------------------------------------------- LiteLLM gateway
def admin(method: str, path: str, **kw: Any) -> Any:
    r = httpx.request(method, f"{LITELLM_URL}{path}", timeout=60,
                      headers={"Authorization": f"Bearer {MASTER_KEY}"}, **kw)
    r.raise_for_status()
    return r.json()


def chat(route: str, messages: list[dict], key: str, metadata: dict | None = None,
         temperature: float | None = None, max_tokens: int | None = None) -> dict:
    """One real chat completion through the gateway, with the measurements governance needs."""
    body: dict[str, Any] = {"model": route, "messages": messages}
    if temperature is not None:
        body["temperature"] = temperature
    if max_tokens is not None:
        body["max_tokens"] = max_tokens
    if metadata:
        body["metadata"] = metadata
    t0 = time.perf_counter()
    r = httpx.post(f"{LITELLM_URL}/v1/chat/completions", json=body, timeout=180,
                   headers={"Authorization": f"Bearer {key}"})
    latency_ms = (time.perf_counter() - t0) * 1000
    if r.status_code >= 400:
        raise RuntimeError(f"gateway {r.status_code}: {r.text[:300]}")
    data = r.json()
    usage = data.get("usage") or {}
    return {
        "content": (data["choices"][0]["message"].get("content") or "").strip(),
        "model": data.get("model"),
        "latency_ms": latency_ms,
        "prompt_tokens": usage.get("prompt_tokens", 0),
        "completion_tokens": usage.get("completion_tokens", 0),
        "cost_usd": float(r.headers.get("x-litellm-response-cost") or 0.0),
        "call_id": r.headers.get("x-litellm-call-id"),
        "model_id": r.headers.get("x-litellm-model-id"),
        "attempted_fallbacks": int(r.headers.get("x-litellm-attempted-fallbacks") or 0),
    }


def answer(route: str, user_message: str, key: str, metadata: dict | None = None) -> dict:
    """Nova Assist's unit of work: governed system prompt + customer message -> answer.
    Used by offline evaluation, the production app and the registered MLflow pyfunc alike,
    so what we evaluate is exactly what we deploy."""
    gen = policy()["evaluation"]["generation"]
    messages = [{"role": "system", "content": system_prompt_text()},
                {"role": "user", "content": user_message}]
    return chat(route, messages, key, metadata, gen["temperature"], gen["max_tokens"])


def judge_json(prompt: str, key: str) -> dict:
    """Ask the judge model for a JSON object (used by shadow + online judging)."""
    route = policy()["evaluation"]["judge_route"]
    out = with_backoff(lambda: chat(route, [{"role": "user", "content": prompt}], key,
                                    {"tags": ["judge"]}, 0.0, 600), "judge")
    text = out["content"]
    start, end = text.find("{"), text.rfind("}")
    return json.loads(text[start:end + 1])


def production_deployments() -> list[dict]:
    """Current deployments behind the production route, as stored in the LiteLLM DB."""
    route = policy()["registry"]["production_route"]
    data = admin("GET", "/model/info")["data"]
    return [d for d in data if d.get("model_name") == route]


def current_weights() -> dict[str, int]:
    weights = {"v1": 0, "v2": 0}
    for d in production_deployments():
        v = (d.get("model_info") or {}).get("nova_version")
        if v in weights:
            weights[v] = int(d["litellm_params"].get("weight") or 0)
    return weights


def set_traffic(challenger_percent: int, shadow: bool = False, champion: str = "v1") -> dict[str, int]:
    """Send `challenger_percent` of production traffic to the challenger, the rest to the champion.

    New deployments are added first and the old ones removed afterwards, so the route is never
    empty. With shadow=True the champion deployment mirrors every request to the challenger
    route via LiteLLM's native `silent_model` (the user only ever gets the champion answer)."""
    route = policy()["registry"]["production_route"]
    challenger = "v2" if champion == "v1" else "v1"
    old_ids = [d["model_info"]["id"] for d in production_deployments()]
    split = {champion: 100 - challenger_percent, challenger: challenger_percent}
    for version, weight in split.items():
        if weight <= 0:
            continue
        params = {**route_params(route_for(version)), "weight": weight}
        if shadow and version == champion:
            params["silent_model"] = route_for(challenger)
        admin("POST", "/model/new", json={"model_name": route, "litellm_params": params,
                                          "model_info": {"nova_version": version}})
    for mid in old_ids:
        admin("POST", "/model/delete", json={"id": mid})
    refresh_deployment_versions()
    return current_weights()


def refresh_deployment_versions() -> None:
    """Store {deployment id: version} for every route (fixed ones and production deployments)."""
    mapping = {d["model_info"]["id"]: d["model_info"].get("nova_version")
               for d in admin("GET", "/model/info")["data"] if d["model_info"].get("nova_version")}
    set_state("deployment_versions", mapping)


def ensure_virtual_key(alias: str, models: list[str], limits: dict) -> str:
    """Create (once) a LiteLLM virtual key with model allow-list, RPM limit and budget."""
    keys = get_state("virtual_keys", {})
    if alias in keys:
        try:
            admin("GET", "/key/info", params={"key": keys[alias]})
            return keys[alias]
        except httpx.HTTPStatusError:
            pass  # key vanished (e.g. LiteLLM DB was reset): issue a new one
    data = admin("POST", "/key/generate", json={
        "key_alias": alias, "models": models, "rpm_limit": limits["rpm_limit"],
        "max_budget": limits["max_budget_usd"], "metadata": {"purpose": alias}})
    keys[alias] = data["key"]
    set_state("virtual_keys", keys)
    return data["key"]


def app_key() -> str:
    return ensure_virtual_key("nova-assist-app", [policy()["registry"]["production_route"],
                                                  "nova-v1", "nova-v2"],
                              policy()["rate_limits"]["app_key"])


def worker_key() -> str:
    return ensure_virtual_key("governance-worker", ["nova-v1", "nova-v2", "nova-judge"],
                              policy()["rate_limits"]["worker_key"])


# --------------------------------------------------------------------------- gates
def check(name: str, value: float | None, rule: dict) -> dict:
    """One gate check: value against {min: x} or {max: x}. Missing data fails the check."""
    if value is None:
        return {"check": name, "value": None, "rule": rule, "passed": False, "note": "no data"}
    ok = all((value >= v) if op == "min" else (value <= v) for op, v in rule.items())
    return {"check": name, "value": round(float(value), 4), "rule": rule, "passed": bool(ok)}


def record_gate(stage: str, checks: list[dict], evidence: dict, actor: str) -> bool:
    passed = all(c["passed"] for c in checks)
    fp = policy_fingerprint()
    query("""INSERT INTO governance.gate_decisions (stage, passed, checks, evidence, policy_version)
             VALUES (%s,%s,%s,%s,%s)""", (stage, passed, Jsonb(checks), Jsonb(evidence), fp))
    audit(actor, stage, "gate_check", "PASS" if passed else "FAIL",
          {"checks": checks, "policy_version": fp}, evidence)
    return passed


# --------------------------------------------------------------------------- jobs
def enqueue(kind: str, params: dict, actor: str) -> int:
    return query("INSERT INTO governance.jobs (kind, params, actor) VALUES (%s,%s,%s) RETURNING id",
                 (kind, Jsonb(params), actor))[0]["id"]


def job_progress(job_id: int, text: str) -> None:
    query("UPDATE governance.jobs SET progress = %s WHERE id = %s", (text, job_id))
