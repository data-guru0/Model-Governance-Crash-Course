# Model card: Nova Assist v2

| Field | Value |
|---|---|
| System | Nova Assist, NovaBank customer-support assistant |
| Version | v2 (challenger), registered model `nova-assist`, alias `@challenger` until promotion |
| Provider model | `openai/gpt-oss-120b` served by Groq, called only through the LiteLLM route `nova-v2` |
| Base model licence | Apache-2.0 (open-weight gpt-oss release) |
| System prompt | `governance/policy.md`, versioned in the MLflow Prompt Registry as `nova-assist-system` |
| Parameters | temperature 0.2, max_tokens 1024, reasoning_effort low |
| Owner | Priya Raman (Product Owner); technical owner Tomás Okafor (ML Platform Lead) |
| Proposal | `proposals/nova-assist-v2.yaml` (MCP-2026-014) |

## Intended use
Answering retail-banking support questions (cards, accounts, transfers, loans, mortgages, ATMs, fees, passwords). The assistant explains how to complete a task in NovaBank's channels and escalates to humans for fraud or when it is unsure.

## Out of scope
Personal financial, investment, tax or legal advice. Acting on accounts. Handling credentials. Any decision with legal or similarly significant effect on a customer.

## Evaluation
- **Offline (Stage 2):** golden set built from the Bitext retail-banking dataset (see `data/DATASET_CARD.md`), plus 12 course-authored red-team cases. DeepEval metrics: answer relevancy, G-Eval helpfulness, correctness and policy compliance, toxicity, bias, and red-team refusal. Latency, tokens and cost are measured on the same run. Results for every run are in MLflow (experiment `nova-assist-governance`), linked from the registry version tags.
- **Online (Stages 4–6):** shadow pairwise preference against v1, then canary and rollout metrics per version from LiteLLM logs, with online judge sampling.

Real numbers are not copied into this card, because they would go stale. The governance report (`reports/`) and the MLflow runs are the source of truth.

## Known limitations and risks
- The judge (`qwen/qwen3.8-27b`) is itself an LLM: scores are noisy and may carry the judge's biases. The judge is from a different model family to limit self-preference.
- The golden references are generic and synthetic, so correctness scores are relative indicators, not ground truth.
- English only; there is no evaluation of other languages or accessibility needs.
- Being larger, v2 has higher latency and cost per request than v1. The gate bounds both.

## Ethical considerations
The assistant must never request credentials and must escalate fraud. Both are tested with red-team cases and checked in shadow (zero critical violations allowed). Customers are told they are talking to an AI assistant (EU AI Act Art. 50 transparency).
