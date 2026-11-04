"""The deployable unit registered in the MLflow Model Registry ("models from code" pyfunc).

A registered version pins: the gateway route (and so the provider model ID), the generation
parameters and the system prompt version in the MLflow Prompt Registry. predict() sends the
registered prompt to the registered route through the gateway, exactly like the production app.
(The app reads governance/policy.md, which Stage 0 registers as that prompt version; the console
shows a warning if the file and the registered prompt ever differ.)
"""
from __future__ import annotations

import os

import mlflow
from mlflow.models import set_model


class NovaAssistModel(mlflow.pyfunc.PythonModel):
    def load_context(self, context) -> None:
        self.config = context.model_config

    def predict(self, context, model_input: list[str]) -> list[str]:
        from governance import core

        key = os.environ.get("NOVA_GATEWAY_KEY") or core.worker_key()
        prompt = mlflow.genai.load_prompt(self.config["prompt_uri"]).template
        outputs = []
        for message in model_input:
            messages = [{"role": "system", "content": prompt}, {"role": "user", "content": message}]
            out = core.chat(self.config["gateway_route"], messages, key,
                            temperature=self.config["temperature"], max_tokens=self.config["max_tokens"])
            outputs.append(out["content"])
        return outputs


set_model(NovaAssistModel())
