"""Nova Assist: NovaBank's production customer-support service.

It calls models ONLY through the LiteLLM gateway's production route, using its own virtual key
(model allow-list, RPM limit, budget). It never sees the Groq key or the gateway master key.
Every call carries a request ID and stage tags; every answer is tagged with the model version
that actually produced it.
"""
from __future__ import annotations

import uuid
from functools import lru_cache

from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel, Field

from governance import core

app = FastAPI(title="Nova Assist (NovaBank)", version="1.0")


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    # Optional labels used by traffic replay so live metrics can be sliced by intent.
    intent: str | None = Field(default=None, max_length=100)
    category: str | None = Field(default=None, max_length=50)


class ChatResponse(BaseModel):
    request_id: str
    answer: str
    model_version: str | None


@lru_cache(maxsize=1)
def _app_key() -> str:
    keys = core.get_state("virtual_keys", {})
    if "nova-assist-app" not in keys:
        raise HTTPException(503, "Nova Assist is not initialised yet (open the console, Stage 0)")
    return keys["nova-assist-app"]


def _log(row: dict) -> None:
    cols = ", ".join(row)
    core.query(f"INSERT INTO governance.requests ({cols}) VALUES ({', '.join(['%s'] * len(row))})",
               tuple(row.values()))


@app.get("/health")
def health() -> dict:
    core.query("SELECT 1")
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest, background: BackgroundTasks) -> ChatResponse:
    request_id = str(uuid.uuid4())
    # The traffic window (e.g. "canary-1730745600") tags this request so gates measure one window only.
    stage = core.lifecycle().get("window", "not_initialised")
    route = core.policy()["registry"]["production_route"]
    metadata = {"tags": ["nova-assist", f"stage:{stage}"],
                "spend_logs_metadata": {"request_id": request_id, "stage": stage, "intent": req.intent}}
    base = {"request_id": request_id, "stage": stage, "intent": req.intent,
            "category": req.category, "prompt": req.message}
    try:
        out = core.answer(route, req.message, _app_key(), metadata)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - log the failure, return a safe error to the customer
        background.add_task(_log, {**base, "error": str(exc)[:500]})
        raise HTTPException(503, "Nova Assist is temporarily unavailable, please try again.") from exc

    version = core.version_for_deployment(out["model_id"])
    # Logged after the response is sent, so bookkeeping never adds latency for the customer.
    background.add_task(_log, {**base, "litellm_call_id": out["call_id"], "response": out["content"],
                               "model_version": version, "model_id": out["model_id"],
                               "latency_ms": out["latency_ms"], "prompt_tokens": out["prompt_tokens"],
                               "completion_tokens": out["completion_tokens"], "cost_usd": out["cost_usd"]})
    return ChatResponse(request_id=request_id, answer=out["content"], model_version=version)
