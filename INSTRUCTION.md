# Prompt for Claude Code: Model Governance Crash Course (Mini Project)

Copy everything below the line into Claude Code.

---

## Role and goal

You are a senior MLOps / LLMOps engineer and technical course author. Build a complete, runnable mini project that teaches **Model Governance**, one module of my AI Governance course. I will use it to teach beginner and intermediate students live, so it has to be real, production-grade, and easy to follow.

**Scope is model governance only.** Do not drift into data governance, general MLOps tutorials, fine-tuning, or prompt-engineering lessons. Every file and every step must serve one question: *how does a company safely decide which model goes to production, prove it is good enough, roll it out with control, and keep an audit trail?*

## Non-negotiable rules

1. **No mocking, no fakes, no simulated results.** Every model call hits the real Groq API. Every evaluation score comes from a real evaluation run. Every rollout percentage is real traffic routed by the real gateway. No hardcoded metrics, no `random()` standing in for quality scores, no "pretend" stages, and no placeholder functions that print success.
2. **Verify before you build.** Before writing code, check the current official docs for LiteLLM, MLflow, DeepEval (or Ragas) and Groq. Library APIs change. Do not invent config keys, flags or functions. If a feature I describe is not native to a tool, say so in a short note at the top of `README.md` and implement it properly yourself, for example as a small real service. Never fake it.
3. **Open source and free only.** Use only the open-source / free tiers of every tool. LiteLLM has some enterprise-only features: do not use them, and note which ones you avoided.
4. **Everything runs locally on Docker Desktop** using one `docker-compose.yml`. The only external dependency is the Groq API.
5. **Secrets.** The Groq API key goes in `.env`, which is git-ignored. Ship `.env.example` only. Never print or log the key.
6. **Minimal terminal for students.** Students should need about 3 commands total (clone, copy `.env`, `docker compose up`). Everything else happens through a web UI. Use the terminal in docs only when there is truly no alternative.

## Models (Groq)

I will give you a Groq API key. On first run, call Groq's `/models` endpoint to list the models currently available, then pick **2–3 chat models** and document why you picked them:

- **Champion (v1):** the model currently "in production" at the start of the scenario. A smaller, cheaper model is a good fit.
- **Challenger (v2):** the newly proposed model being governed through the pipeline. A larger or newer model fits here.
- **Judge model:** used only as the LLM-as-a-judge for evaluation. It should be a different model from the two under test, to reduce self-preference bias. If only two suitable models exist, explain the trade-off.

Do not hardcode model IDs from memory. Read them from config, after you have confirmed they exist. Handle Groq free-tier rate limits properly (retries with backoff, concurrency limits, and evaluation batch sizes that fit inside the limits), and document the limits in the README.

## The scenario (use this story throughout)

**Company:** "NovaBank", a fictional mid-size digital bank. The company is fictional; the data and system are real.

**System:** "Nova Assist", an LLM customer-support assistant that answers customer questions about accounts, cards, payments, refunds and so on.

**Real data:** use a real public dataset. A good fit is the Bitext customer-support dataset on Hugging Face (`bitext/Bitext-customer-support-llm-chatbot-training-dataset`). Verify it is available and check its licence. Build from it:
- a **golden evaluation set** (~100–150 curated, stratified examples by intent), versioned in the repo with a dataset card, and logged to MLflow as a dataset;
- a **live traffic replay set** of different examples, used to send real requests through the gateway during the shadow, canary and rollout stages.

**Bank policy:** write a short, realistic `policy.md` system prompt for Nova Assist covering tone, no financial advice, no requests for full card numbers or passwords, escalation to a human for fraud, and a clear refusal when unsure. Evaluation checks compliance with this policy.

**Storyline:** v1 is live. The product team proposes moving to v2 because they believe it gives better answers. The governance board says: "Prove it, roll it out safely, and keep an audit trail." The students follow that one change from proposal to full production, or to a rollback.

## Architecture (docker-compose services)

- **postgres**: backing store for LiteLLM and MLflow, plus a `governance` schema for the audit log, gate decisions and shadow comparisons.
- **litellm-proxy**: the LLM gateway, configured via `litellm_config.yaml`. Use real LiteLLM features: model aliases, router weights for traffic splitting, fallbacks, retries, per-key budgets / rate limits with virtual keys, and spend and request logging to Postgres.
- **mlflow**: tracking server plus Model Registry with a Postgres backend and local artifact storage.
- **nova-assist-app**: a small FastAPI service, the "production application". It calls models **only** through the LiteLLM gateway and never calls Groq directly. It adds a request ID and model-version tags to every call.
- **shadow-service** (if LiteLLM has no native traffic mirroring; verify this): receives a copy of each production request asynchronously, calls the challenger, stores both responses with latency, token and cost data, and runs an LLM-judge comparison in the background. The user only ever sees the champion response. It must never add latency to the user path.
- **governance-console**: a Streamlit (or similar) web UI with one page per governance stage. Instructors and students drive the whole lesson from here using buttons, tables and charts. It reads real data from MLflow, Postgres and the LiteLLM API.

Include a simple architecture diagram (Mermaid) in the README.

## The governance lifecycle (implement each as a real, gated stage)

Every stage must have: **(a)** what it is and why companies do it, **(b)** real implementation, **(c)** an explicit pass/fail **gate** with thresholds defined in a versioned `governance/policy.yaml` and not hidden in code, **(d)** an entry written to an **append-only audit log** (who, what, when, evidence links, decision).

### Stage 0 — Baseline
v1 is registered in the MLflow Model Registry as `nova-assist` with alias `@champion`. Register the deployable unit as a real MLflow model (for example a `pyfunc` or MLflow's LLM / prompt support, whichever current docs recommend) that captures the model ID, the system prompt (via MLflow Prompt Registry if available), parameters and gateway route. The gateway serves 100% of traffic to v1.

### Stage 1 — Model Proposal
A structured proposal (`proposals/nova-assist-v2.yaml` plus a filled **model card**) covering business justification, intended use and out-of-scope use, risk tier (with a short risk assessment), expected cost impact (estimated from real token pricing), success criteria, rollback plan, and named owner and approvers. The console shows the proposal and records a real approval or rejection, stored in the audit log and as MLflow tags. Nothing moves forward without approval.

### Stage 2 — Offline Evaluation (production grade)
Use **DeepEval** (preferred) or Ragas, with the Groq judge model through LiteLLM. This must be a real evaluation suite, not a demo:
- **Quality:** answer relevancy, plus G-Eval custom criteria for helpfulness and correctness against the golden reference.
- **Policy and safety:** G-Eval or custom metric for compliance with `policy.md`; toxicity and bias metrics; refusal behaviour on a small real red-team subset (prompt injection, requests for card numbers, attempts to get financial advice). Write the red-team prompts yourself as test cases and label them as such.
- **Operational:** p50/p95 latency, tokens, and cost per 1K requests, measured from the real runs.
- Run **both** v1 and v2 on the same golden set. Compare per metric and per intent slice, so one intent can't hide a regression in another.
- Log everything to MLflow (metrics, per-example results table, judge model, dataset version, prompt version, git commit).
- **Gate:** v2 must meet the absolute thresholds AND not regress beyond the tolerance against v1 on any safety metric. Show a clear PASS / FAIL report.

### Stage 3 — Register the Challenger
On a passing gate, register v2 as a new version of `nova-assist` with alias `@challenger`, linking the evaluation run, proposal, model card and approver. Explain why aliases (champion / challenger) replaced the old "Staging / Production" stages in MLflow (verify against current docs).

### Stage 4 — Shadow Deployment
Replay real traffic through the production app. v1 answers users; v2 receives mirrored requests silently. Collect side-by-side results: LLM-judge pairwise preference, policy violations, latency, errors and cost. **Gate:** minimum sample size, win/tie rate, zero critical policy violations, and an error-rate ceiling.

### Stage 5 — Canary Deployment
Change the LiteLLM router weights so ~5–10% of real traffic goes to v2. Do this through a governed action in the console that edits config and reloads the gateway, writes to the audit log, and requires approval. Do not edit by hand. Monitor live metrics per model version from LiteLLM logs plus online judge sampling. **Gate:** error rate, p95 latency, cost and sampled quality within the thresholds.

### Stage 6 — Gradual Rollout
Step through 25% → 50% → 100%. At each step, check the gate automatically. Implement a **real automatic rollback**: if a threshold is breached, weights revert to 100% v1, an incident entry goes to the audit log, and the console shows why. Provide a way to demonstrate rollback honestly, for example by tightening a threshold in `policy.yaml` and re-checking, without faking a failure.

### Stage 7 — Promotion and Retirement
At 100% with a passing gate, move `@champion` to v2 and tag v1 as `retired` (kept for rollback, not deleted). Generate a final **governance report** (Markdown / HTML) from real data: the proposal, evaluation results, shadow stats, canary / rollout timeline, approvals, and a full audit trail.

Also show **continuous governance**: a scheduled or on-demand re-evaluation of the current champion against the golden set to detect drift, logged to MLflow.

## Deliverables (repo structure)

```
model-governance-crash-course/
├── README.md              # setup + run + troubleshooting
├── DEMO.md                # instructor teaching script (theory + practice)
├── docker-compose.yml
├── .env.example
├── litellm_config.yaml
├── governance/policy.yaml # all gate thresholds, versioned
├── proposals/             # proposal YAML + model cards
├── data/                  # golden set, replay set, red-team set, dataset cards
├── app/                   # Nova Assist FastAPI service
├── shadow/                # shadow service (if needed)
├── evaluation/            # DeepEval / Ragas suite
├── console/               # governance console UI
├── reports/               # generated governance reports
└── tests/                 # real integration tests (hit real services)
```

### README.md
- Prerequisites (Docker Desktop, a Groq key, RAM needed), with setup in about 3 commands.
- How to open each UI (console, MLflow, LiteLLM admin) and default local credentials.
- Architecture diagram, what each service does, and how to verify everything is healthy (health checks in compose).
- Groq rate limits and approximate time for the full evaluation run.
- Troubleshooting (ports busy, key invalid, rate limited, reset to a clean state).
- A short "Honesty note" listing any feature that is not native to a tool and how you implemented it.

### DEMO.md (most important file)
Written for **me, the instructor**, to teach beginners and intermediates in about 2–3 hours. For **each stage**:
1. **Concept** in plain language, with a real-world analogy, and why companies do it (regulators, cost, incidents). Briefly link to frameworks such as NIST AI RMF, the EU AI Act, ISO/IEC 42001, and SR 11-7 model risk management for banking. Keep it brief and accurate.
2. **What to show** in the console: exact clicks, what appears on screen, and how to read every number.
3. **Talking points and common student questions**, with answers.
4. **"What could go wrong in real life"**, a short real-style incident story for this stage.
5. **Checkpoint question** for students.

Also include: a timed lesson plan, a glossary (champion, challenger, gate, shadow, canary, model card, audit trail, LLM-as-judge, drift), a recap slide outline, and a short take-home exercise (for example: "propose v3, change a threshold, run the pipeline, and defend your decision").

Use the terminal in DEMO.md only where it is unavoidable, and explain every command you do include.

## Quality bar

- Clean, typed, commented Python; config-driven; no magic numbers outside `policy.yaml`.
- Idempotent setup and a "Reset demo" button in the console that restores Stage 0.
- Integration tests that run against the real stack (gateway routes, registry aliases, gate logic, rollback).
- Before you finish, **run the whole pipeline end to end yourself** with my key, fix every error, and confirm that each stage produces real outputs. Then summarise what you verified, which models you chose, actual evaluation numbers, total Groq calls used, and any limitations.

## Working style

First, show me a short plan: verified tool versions, the chosen models, any non-native features, and the proposed thresholds. Wait for my OK, then build in stages and commit after each one. Ask me for the Groq API key when you need it, and tell me where to put it (`.env`).