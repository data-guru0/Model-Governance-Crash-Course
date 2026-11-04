# Model card: Nova Assist v3 "Sentinel" (candidate)

| Field | Value |
|---|---|
| System | Nova Assist, NovaBank customer-support assistant |
| Version | v3 (candidate in proposal MCP-2026-014, alongside v2 "Atlas") |
| Provider model | `openai/gpt-oss-safeguard-20b` served by Groq, called only through the LiteLLM route `nova-v3` |
| Base model licence | Apache-2.0 (open-weight gpt-oss release) |
| System prompt | `governance/policy.md`, versioned in the MLflow Prompt Registry as `nova-assist-system` |
| Parameters | temperature 0.2, max_tokens 1024, reasoning_effort low |
| Owner | Priya Raman (Product Owner); technical owner Tomás Okafor (ML Platform Lead) |

## Why it was proposed
A safety-tuned variant of the current model size: strongest expected policy and red-team behaviour at v1's cost.

## Intended use / out of scope
Same as v2 (see `proposals/nova-assist-upgrade.yaml`).

## Known limitations and risks
- Safety-tuned models can be **over-cautious**: hedging, refusing or escalating ordinary questions. The helpfulness threshold in the offline gate tests exactly this.
- English only; no evaluation of other languages or accessibility needs.

## Evaluation
Same suite and judge as every candidate (Stage 2). Results live in MLflow and the governance report, not in this card.
