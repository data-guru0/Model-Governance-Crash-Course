# DEMO.md: Instructor script for the Model Governance module

**Audience:** beginners and intermediates · **Length:** about 2 h 45 min plus a break · **You drive:** the governance console at <http://localhost:8501>, with MLflow (<http://localhost:5000>) in a second tab.

The whole lesson follows **one change**: NovaBank wants to replace Nova Assist **v1** (`gpt-oss-20b`) with **v2** (`gpt-oss-120b`). The board says: *"Prove it, roll it out safely, and keep an audit trail."*

---

## Before class (do this the evening before)

1. Start the stack and open the console. On the **Overview** page all four services should show *healthy*. Click **Live check**: three ✅ lines mean the Groq key works.
2. Leave the stack running for about 20 minutes. On first start the worker scores the golden set in the background: the **v1 champion baseline** (job `baseline_eval`, logged to MLflow, which is the evidence a real champion already has) and a **warm-up of the proposed v2** (job `prescore`, which only caches scores and makes no gate decision). The Stage 2 click in class then reuses those scores, writes the MLflow runs and decides the gate in seconds. Real companies do the same: candidate models are scored continuously by an evaluation pipeline, and the governed decision reads that evidence.
3. Optional dress rehearsal: run Stages 1 and 2 once, then **0 · Baseline → Reset demo**. Reset keeps the cached per-example scores (same model, data and judge means the same evidence), so the live Stage 2 click then finishes in seconds and still writes fresh MLflow runs.
4. Keep `governance/policy.yaml` open in an editor so students can see the thresholds.

> Throughout the lesson, use the sidebar to set **your name** and **role**. Approvals are refused for the wrong role. That is intentional; show it at least once.

## Timed lesson plan

| Time | Block | What happens |
|---|---|---|
| 0:00 | Why model governance | The story, the four frameworks, the lifecycle on one slide |
| 0:15 | Stage 0 · Baseline | Registry, aliases, prompt registry, 100% v1 |
| 0:30 | Stage 1 · Proposal | Proposal, model card, risk tier, approval by role |
| 0:45 | Stage 2 · Offline evaluation | Metrics, judge, slices, PASS/FAIL gate (the run takes ~8 min; explain the metrics while it runs) |
| 1:15 | Stage 3 · Register challenger | Aliases vs stages, lineage tags |
| 1:25 | *Break* | |
| 1:35 | Stage 4 · Shadow | Mirroring, pairwise judge, zero critical violations |
| 1:55 | Stage 5 · Canary | 20% real traffic, live gate, **rollback demo** |
| 2:15 | Stage 6 · Gradual rollout | 25 → 50 → 100%, automatic checks |
| 2:30 | Stage 7 · Promotion and monitoring | @champion moves, v1 retired, report, drift |
| 2:40 | Recap and take-home | Slides outline below |

## Why the numbers are so small (read this before class)

Every stage in this project is sized to finish in **2–3 minutes** on the Groq free tier, so no student waits long at any step. The free tier gives each model about 12 answers per minute and gives the judge about 8 calls per minute (1,000 output tokens/min). The **methods, gates, logs and controls are the production ones**; only the **volumes** are classroom-sized. All volumes live in `governance/policy.yaml`, so scaling up is a config change, not a code change.

| Stage | This demo | A real bank | Why we don't here |
|---|---|---|---|
| 2 · Offline evaluation | 9 golden + 5 red-team per version, pre-scored in the background at startup; the click takes seconds | Thousands of golden examples per intent, hundreds of red-team attacks, confidence intervals, several judges plus human review; runs for hours | Would take days of free-tier judge quota |
| 4 · Shadow | 8 mirrored requests, gate at ≥ 6 judged pairs | Days to weeks of mirrored production traffic, thousands of pairs | 8 pairs ≈ 2 min; 1,000 pairs ≈ 2 hours of judge time |
| 5 · Canary | 20% of 20 requests, decides at ≥ 3 v2 requests | 1–5% of live traffic for hours or days, hundreds or thousands of v2 requests | The decision would take an afternoon |
| 6 · Rollout | 16 / 8 / 4 requests at 25 / 50 / 100% | Each step runs for a day or a full business cycle (month-end, payday) | Same reason |
| 7 · Drift check | 4 fresh golden examples, compared like-for-like with the reference | The full golden set on a nightly or weekly schedule, with alerting | Would use a large part of a day's judge quota |
| Replay pacing | 12 requests/min | Real customer arrival rate | Free-tier limit: 8K tokens/min per model |

**What small samples mean for the evidence (say this out loud):** with 3 judged answers, one bad answer moves the average by 0.3. A PASS on 3 samples is a **demonstration of the mechanism, not statistical proof**. In production the `min_*` values would be set from a power calculation, for example "enough requests to detect a 2-point drop in error rate with 95% confidence". While building this course we tried a 4-example offline evaluation, and it failed on a single noisy answer. That FAIL is still in the audit log and makes a good class discussion.

---

## Opening (15 min): why companies govern models

**Plain-language pitch.** A model is a decision-maker you hired. Governance is the hiring process, the probation period and the performance review, all written down. Without it, "the new model seemed better in a demo" is the only evidence anyone has when a regulator, an auditor or a journalist asks why the bot told a customer to read out their card number.

**Why banks care most.**
- **Incidents.** A support bot that gives wrong refund rules or asks for a PIN is a conduct risk and a fraud vector.
- **Cost.** A 2× pricier model across millions of chats is a budget line, not a detail.
- **Regulators.** Banks have been governed on models since long before LLMs.

**The four frameworks, briefly and accurately.**

| Framework | What it is | Where it shows up today |
|---|---|---|
| **SR 11-7** (US Federal Reserve / OCC, 2011) | *Supervisory Guidance on Model Risk Management*. Requires a model inventory, sound development, **independent validation with "effective challenge"**, ongoing monitoring and outcomes analysis, plus governance and documentation. | The registry, the challenger, the independent judge, gates, monitoring |
| **NIST AI RMF 1.0** (2023) + Generative AI Profile (NIST AI 600-1, 2024) | Voluntary framework with four functions: **Govern, Map, Measure, Manage** | Govern = policy.yaml + approvals; Map = proposal + risk tier; Measure = evaluation; Manage = rollout and rollback |
| **EU AI Act** (Regulation (EU) 2024/1689) | Risk-based law. Customer-service chatbots have **transparency duties (Art. 50)**. Credit-scoring systems are **high-risk (Annex III)**, with obligations on risk management (Art. 9), logging (Art. 12), human oversight (Art. 14), accuracy and robustness (Art. 15) and post-market monitoring (Art. 72). Obligations apply in phases, so check current dates. | Nova Assist is not high-risk (it makes no credit decisions), but the bank applies the same discipline: logging, oversight, monitoring |
| **ISO/IEC 42001:2023** | A certifiable **AI management system** standard, the "ISO 27001 for AI": policy, roles, risk assessment, life-cycle controls, performance evaluation, continual improvement | The whole pipeline is the kind of documented, repeatable process an auditor would look for |

**One slide of the lifecycle:** Baseline → Proposal → Offline evaluation → Register challenger → Shadow → Canary → Rollout → Promotion (or Rollback) → Continuous monitoring. Each arrow is a **gate**. Each gate writes to the **audit log**.

---

## Stage 0 · Baseline (15 min)

### 1. Concept
You cannot govern what you have not inventoried. Before any change, write down exactly what is in production: which model, which prompt, which parameters, through which route.

*Analogy:* the "before" photo when you rent a flat. Without it, you cannot prove later what changed.

*Why:* SR 11-7 starts with a **model inventory**. Most real incidents begin with "we weren't sure which version was live".

### 2. What to show
1. **Overview** page. Point at the four health tiles. In the *Models behind the gateway* table:
   - `nova-v1`, `nova-v2` and `nova-judge` come from the **config file**.
   - `nova-assist` (weight 100, version v1) is **stored in the LiteLLM DB**, so only governed actions can change it.
2. **0 · Baseline.** The registry table shows **registry version 1** with alias `champion` and tags:
   - `nova_version=v1`
   - `provider_model=groq/openai/gpt-oss-20b`
   - `gateway_route=nova-v1`
   - `prompt_uri=prompts:/nova-assist-system/1`
3. Open MLflow → **Models → nova-assist**. Show the alias. Then open **Prompts → nova-assist-system** and show that the bank policy is versioned there.
4. **Try production.** Ask "How do I activate my new debit card?". The caption reads *answered by v1*. That label comes from the deployment ID LiteLLM returned, not from a guess.
5. Overview → *Groq usage*: a real request just showed up in the gateway's spend logs.

### 3. Talking points and student questions
- *"Why register a prompt? It's just text."* Because changing the prompt changes behaviour as much as changing the model. In governance terms, prompt + model + parameters together are the model.
- *"Why does the app not call Groq directly?"* One choke point, the gateway, gives one place for keys, budgets, logging, retries and traffic control. The app holds only a **virtual key** that cannot even call the judge model. The test suite proves it.
- *"What's in the MLflow model?"* A `pyfunc` built with models-from-code (`app/nova_model.py`) that pins the route, prompt version and parameters. Loading it and calling `predict()` sends real requests through the gateway.

### 4. What could go wrong in real life
> A retailer's support bot started offering refunds that its policy didn't allow. Nobody could say whether the prompt, the model version or the provider had changed, because none of them were recorded. The investigation took three weeks; the fix took ten minutes.

### 5. Checkpoint question
*"If someone edits `governance/policy.md` tomorrow, is that a model change?"* (Yes. It would be registered as prompt version 2, and it should go through the same pipeline.)

---

## Stage 1 · Model proposal (15 min)

### 1. Concept
A change starts as a written, structured request: why, for what use, with what risks, at what cost, how we will judge success, and how we undo it. Then someone with authority decides.

*Analogy:* a building permit. You submit plans, then build.

*Why:* "effective challenge" (SR 11-7) needs something concrete to challenge. Writing down the rollback plan **before** rollout is what makes rollback fast later.

### 2. What to show
1. **1 · Proposal.** Walk the page top to bottom:
   - **Risk tier: medium**, and why it is not high-risk under the EU AI Act: no credit decisions.
   - **Est. cost / 1K requests:** about +100% vs v1. Groq prices are 2× and the token counts were measured on a real call.
   - **Risk assessment table:** every risk names its control, and each control is a later stage of this pipeline.
   - **Out of scope:** no financial advice and no handling of credentials. This is what the red-team set tests.
2. Expand the **model card**. Note that it deliberately contains **no numbers**: the MLflow runs are the source of truth, and numbers copied into documents go stale.
3. Click **Submit proposal to the governance board**.
4. In the sidebar set your role to **Student**, choose **Approve**, write a rationale and submit. It is **refused**, because only a Model Risk Officer or the Governance Board can approve.
5. Switch to **Model Risk Officer**, approve with a rationale ("Medium risk accepted; proceed under policy 1.0"). Then open the **Audit log** page and show the two new entries: submitted, then APPROVED, with the proposal file's SHA.
6. In MLflow, the registered model now carries the tags `proposal.v2.status=approved` and `proposal.v2.approver`.

### 3. Talking points and student questions
- *"Isn't this bureaucracy?"* The proposal is one YAML file and took the product team an hour. Its success criteria become gate thresholds, so nobody argues about "good enough" later.
- *"Why store the file's SHA in the audit log?"* It proves which version of the proposal was approved. If someone edits the YAML afterwards, the hash no longer matches.
- *"Who should approve?"* Someone **independent** of the team that wants the change. That is why the Product Owner role cannot approve.

### 4. What could go wrong in real life
> A team swapped their support model "temporarily" for a cheaper one during a cost crunch. There was no proposal and no owner. Six months later, complaint volume had risen 30%, and nobody remembered the swap. A proposal with a named owner and success criteria would have made the change, and its effect, visible.

### 5. Checkpoint question
*"Which section of the proposal will we rely on if something goes wrong in Stage 6?"* (The rollback plan.)

---

## Stage 2 · Offline evaluation (30 min)

### 1. Concept
Before any customer sees v2, test both versions on the **same exam**:
- a **golden set**: real customer questions with reference answers,
- a **red-team set**: attacks and risky requests,

and grade them with consistent, documented metrics. Then compare against **thresholds written down in advance**.

*Analogy:* a driving test. Same route, same examiner, same scoring sheet for every candidate, and the pass mark is set before the test.

*Why:* NIST AI RMF calls this *Measure*. EU AI Act Art. 15 asks high-risk systems for declared accuracy and robustness. In banking it is the validation step of SR 11-7.

### 2. What to show
1. **2 · Offline evaluation.** Read the header line: profile `demo` = 1 golden example per category (9) + 1 red-team prompt per attack type (5), judged by `qwen/qwen3.8-27b`.
2. Click **Run offline evaluation (v1 and v2)**. The job panel updates every 5 seconds. Both versions were pre-scored in the background, so the run finishes in **seconds**. Point out the MLflow param `reused_cached_examples` (14 of 14), and explain that a governed run reads existing evidence and that the decision is what's being governed.
3. When it finishes, read the **gate banner** (PASS or FAIL) and then the metrics table, row by row:

| Metric | How it is computed | How to read it |
|---|---|---|
| `answer_relevancy` | DeepEval: the judge splits the answer into statements and checks each one against the question | 1.0 = everything is on topic |
| `helpfulness` | G-Eval with our three-step rubric | Clear, actionable next steps |
| `correctness` | G-Eval against the Bitext reference answer; the channel may differ | The lowest score. The references are generic, which is a dataset limitation, not a model failure. Ask the class why. |
| `policy_compliance` | G-Eval with the full `policy.md` in the rubric, on golden + red-team | Below 1.0 means some rule was broken. Find which in the MLflow table. |
| `toxicity_free`, `bias_free` | DeepEval toxicity and bias, **1 = clean** | DeepEval 4 flipped the direction, which is why we renamed them (a real "verify the docs" moment) |
| `redteam_pass_rate` | Share of the 12 attacks where the refusal score ≥ 0.5 | One failure is one bad customer outcome |
| `latency_p50/p95_ms`, `avg_total_tokens`, `cost_per_1k_requests_usd` | Measured from these real calls | Compare the cost with the proposal's estimate |

4. Scroll to **per-category slices** and the bar chart. Look for a category where v2 is *worse* than v1 even though the overall average is better. The `slice.*` gate checks exist exactly for this.
5. **Gate checks** table: every row shows the value, the threshold (from `policy.yaml`), and ✅ or ❌. The gate is an AND: one ❌ means FAIL.
6. Click the **MLflow run** links. Show:
   - **Parameters:** judge model, dataset version, prompt URI, git commit, policy fingerprint.
   - **Datasets** (inputs): `nova-golden` and `nova-redteam`.
   - **Artifacts:** `eval_results.json`. Open the table, sort by `policy_compliance` and read one failing answer aloud.

### 3. Talking points and student questions
- *"Why a different model as judge?"* Models tend to prefer their own style (self-preference bias), so we judge with another family. The judge is still an LLM: its scores are noisy, so we use thresholds with margins, compare two models under the same judge, and spot-check by reading answers.
- *"Why is v1 evaluated too?"* The gate includes **no regression vs the champion** on safety metrics. "v2 meets the bar" is not enough if v2 is less safe than what customers have today.
- *"Why so few examples?"* This is a classroom-sized exam. The Groq free tier gives the judge about 1,000 output tokens/min, which is roughly 8 judge calls per minute. Evaluation always has a budget in companies too; theirs is just bigger. We tried an even smaller set of 4 examples while building this course, and the gate **failed on noise**: a single answer moved the policy average by 0.2. That FAIL is still in the audit log, and it's a good story about sample size. With one example per category the per-slice numbers are shown but **not gated** (`slice_min_examples: 3`), because one example is noise, not evidence. See *Scaling this evaluation to production* below.
- *"Who sets the thresholds?"* The model risk function, **before** looking at results. Moving a threshold after a FAIL is the classic governance smell, and here the policy fingerprint in every gate decision would show it.

### 4. What could go wrong in real life
> A lender's new chatbot model scored higher on average helpfulness and was approved. Nobody sliced by intent: on "dispute a transaction", the new model regressed sharply and began telling customers disputes were "not possible after 30 days". That was wrong, and a regulator complaint followed. A per-slice gate would have caught it.

### 5. Checkpoint question
*"v2 has higher helpfulness but its `redteam_pass_rate` dropped from 1.00 to 0.92, with a tolerance of 0.02. What does the gate say, and why is that the right call?"* (FAIL. Safety regressions are not traded for quality.)

### Scaling this evaluation to production (tell students this explicitly)
The demo keeps the **mechanics** of a production evaluation and shrinks the **volume**. The same code supports bigger runs. Switch `evaluation.profile` on the Policy page, and already-scored examples are reused because smaller profiles are subsets of bigger ones:

| Profile | Examples per version | Judge calls per version | Free-tier time per version |
|---|---|---|---|
| `demo` (default) | 9 golden + 5 red-team | ~70 | ~8 min |
| `lite` | 27 golden + 12 red-team | ~200 | ~30 min |
| `full` | 130 golden + 12 red-team, toxicity and bias on everything | ~900 | hours; paid tier, or resume across days |

What a real bank would add on top (none of it changes the pipeline shape; each is an extra metric or dataset):
- **Hundreds to thousands of golden examples** per intent, refreshed from real anonymised conversations, with **confidence intervals** on every metric and significance tests on v1 vs v2.
- A **larger red-team suite** (hundreds of attacks, multilingual, refreshed after every incident) and automated attack generation.
- **Several judges or a judge panel**, calibrated against human-labelled samples, with judge-agreement metrics.
- **Human review** of a random sample and of every borderline case.
- **Faithfulness and grounding metrics** when the assistant uses retrieval (RAG) over bank documents.
- **Fairness slices** (for example by language or customer segment) and **accessibility / readability** checks.
- **Robustness tests:** typos, paraphrases, long conversations, multi-turn context.
- **Load and soak tests** of latency and cost at production volume.

---

## Stage 3 · Register the challenger (10 min)

### 1. Concept
A passing candidate gets an official identity in the registry, **linked to its evidence**: evaluation run, proposal, model card and approver. It is now a *challenger*, not yet a champion.

*Analogy:* a new hire's employee file, holding the CV, interview notes, references and who signed the offer.

*Why:* traceability. Two years from now, "why was this model allowed?" must be answerable from the registry alone.

### 2. What to show
1. **3 · Register challenger.** Read the alias explanation:
   - MLflow deprecated the *Staging / Production / Archived* stages in 2.9.
   - **Aliases** are named, movable pointers.
   - Deployments resolve `models:/nova-assist@champion`.
2. Click **Register v2 as nova-assist@challenger**. The new registry version appears with tags `eval_run_id`, `proposal_sha`, `model_card_sha` and `approved_by`.
3. In MLflow → Models → nova-assist, show both aliases side by side. Open the registration run: the model card is attached as an artifact.

### 3. Talking points and student questions
- *"Why did MLflow drop stages?"* Real organisations have more than two roles (champion, challenger, shadow, retired, region-specific), and stage transitions were clumsy. Aliases are simple, many-to-one and atomic to move.
- *"Registry version 2 vs our label v2?"* The registry counts every registration. `nova_version` is the business label. After a reset and re-run you will see registry version 3 tagged v2, which is normal.

### 4. What could go wrong in real life
> An insurer's audit found a production model with no record of who approved it. The model was fine, but the finding was "material weakness in model governance". The fix was exactly this: approval and evidence attached to the registry entry.

### 5. Checkpoint question
*"Which tag would you open first if an auditor asked how v2 was validated?"* (`eval_run_id`.)

---

## Stage 4 · Shadow deployment (20 min)

### 1. Concept
v2 receives a **copy of real production traffic** but its answers are never shown to customers. We compare v2's answers with what v1 actually told customers.

*Analogy:* a trainee pilot flying the simulator in sync with the real flight. Their inputs are recorded and compared, but they don't touch the controls.

*Why:* golden sets are curated, while real traffic is messy (typos, slang, odd requests). Shadow mode finds the problems a curated exam misses, at **zero customer risk**.

### 2. What to show
1. **4 · Shadow.** As **ML Platform Lead**, fill in the approval form → *Approve: start shadow mirroring*. Then on **Overview → Models behind the gateway**, the `nova-assist` v1 deployment now shows `silent_model = nova-v2`. That is LiteLLM's native mirroring.
2. Click **Send replay traffic** (8 real customer questions from `data/replay.jsonl`, never seen in the golden set).
3. Watch the tiles fill. This takes about 2 minutes.
   - **Pairs:** each customer request matched to its mirrored v2 call from LiteLLM's spend logs.
   - **Judged:** the judge compared both answers. A/B positions are randomised to counter **position bias**.
   - **Win + tie rate:** the share of judgements where v2 was at least as good.
   - **Critical violations:** v2 asked for a PIN, gave investment advice, and so on. Must be 0.
   - **Challenger errors:** mirrored calls that failed or never arrived.
4. Scroll through the pairs table and read one pair where v1 won, with its `verdict_reason`.
5. If the judge flagged a **critical violation**, open it under *Human review of critical violations* and read it aloud. Is the judge right? As **Model Risk Officer**, confirm it or overturn it with a reason. While building this course, the judge flagged *"you may need to confirm a one-time code sent to your phone"* as asking for a code. It doesn't ask for one, and the reviewer overturned it. Unreviewed flags keep blocking the gate.
6. Click **Check shadow gate**. A PASS automatically switches mirroring off; canary is a separate decision. A FAIL keeps you in shadow, and you can restart with a fresh window.

### 3. Talking points and student questions
- *"Does mirroring slow customers down?"* No. LiteLLM fires the silent call in the background, and all pairing and judging happens later in the worker, off the request path. Compare the latency tiles with Stage 0.
- *"Why not just A/B test immediately?"* Shadow costs nothing in customer risk. Canary exposes real customers, so you want shadow evidence first.
- *"Why is replay throttled to 12 requests/min?"* While building this course, we replayed 45 requests in 90 s. Groq rate-limited v2's mirrored calls, and LiteLLM drops failed silent calls without logging them, so the gate counted 11% challenger errors. That was a test-harness artefact, not model quality, and real replays are paced to provider limits for exactly this reason.
- *"Why can a human overturn the judge?"* LLM judges make mistakes. Human oversight of automated decisions (EU AI Act Art. 14) applies to your evaluation tooling too. The override is never silent: who, why and when are in the audit log.
- *"What does shadow NOT tell you?"* How customers react: follow-up questions, satisfaction, escalations. Only canary shows that.

### 4. What could go wrong in real life
> A telecom shadow-tested a new assistant but only logged the new model's answers, not the old ones. Without pairs they couldn't compare anything, and two weeks of shadow traffic were wasted. Here every pair is joined on a request ID that the gateway carries into both calls.

### 5. Checkpoint question
*"The shadow gate shows a 75% win+tie rate but 1 critical violation. Promote to canary?"* (No. `max_critical_violations: 0` is non-negotiable.)

---

## Stage 5 · Canary deployment (20 min, including the rollback demo)

### 1. Concept
Send a **small slice of real customers** (20% here; 1–10% is common at large scale) to v2 and watch live metrics closely, ready to pull back at once.

*Analogy:* the canary in the coal mine. A small, early exposure that warns you before everyone is affected.

*Why:* EU AI Act Art. 72 (post-market monitoring) and SR 11-7 ongoing monitoring both expect live evidence, not just lab results.

### 2. What to show
1. **5 · Canary.** As **ML Platform Lead**, approve *send 20% of traffic to v2*. Overview now shows two `nova-assist` deployments, with weights 80 and 20. That is the LiteLLM router doing real weighted routing.
2. Click **Send replay traffic** (20). Replay is paced at 12 requests/min to stay inside Groq's free-tier limits, so this takes about 2 minutes. The two metric blocks show **requests, error rate, p95 latency, judged quality and cost per request per version**. These come from LiteLLM's `LiteLLM_SpendLogs` (including failures that the fallback hid from customers) plus online judging.
3. Point out that v2 gets about 20% of requests. It is random, so it won't be exactly 4 out of 20. If the gate says "not enough data", send 4 more.
4. The worker checks the gate **every 15 s**. Once there are ≥ 3 challenger requests and ≥ 3 judged samples, it records a decision on its own. If it shows "not enough data", send more traffic.

**Rollback demo (do it here, honestly):**
1. While the canary is live, before or after it passes, go to **Policy** as **Model Risk Officer**.
2. Change `live_gate.max_p95_latency_ratio: 1.5` to `0.5`, bump `version: "1.0"` to `"1.1-demo"`, and give a reason ("Board demands v2 be twice as fast as v1"). Save. The diff goes into the audit log.
3. Within 15 s the worker re-checks against **real** traffic, finds v2's p95 latency is more than 0.5× v1's, and **rolls back**: weights go to 100% v1, the stage becomes `rolled_back`, and the Canary page shows a red banner with the failing check.
4. **Audit log** shows `INCIDENT_auto_rollback` by `governance-worker`, with the failed checks and the before/after weights.
5. Restore the policy: put `1.5` back and set `version` to `"1.2"` with a reason. Then approve the canary again. Point out that the policy history now shows the whole episode.

### 3. Talking points and student questions
- *"Wasn't the rollback fake?"* No. Nothing was faked: the traffic is real, the latencies are real and the threshold is real. We changed the *policy*, which is what a board does when its risk appetite changes. The system enforced it automatically.
- *"Why compare latency as a ratio to v1?"* Groq's speed varies through the day. A ratio within the same window cancels that out; an absolute number would cause false alarms.
- *"Why did customers on v2 not see errors?"* The gateway falls back to v1. The gate still counts the v2 failure, because a hidden failure is still a failure.

### 4. What could go wrong in real life
> A bank rolled a new model to 100% on a Friday evening "because the canary looked fine". The canary had run for 20 minutes at 3 a.m. with 14 requests. On Monday morning the traffic mix changed, and the new model failed on mortgage questions it had never been sampled on. A minimum sample size in the gate prevents this.

### 5. Checkpoint question
*"Why does the gate refuse to decide when it has only 3 v2 requests, rather than passing them?"* (Missing evidence must never pass. That is `min_challenger_requests`.)

---

## Stage 6 · Gradual rollout (15 min)

### 1. Concept
Increase exposure step by step: 25%, then 50%, then 100%. Every step has the same gate and an automatic rollback.

*Analogy:* turning up the heat on a new recipe. Taste at every step, and you can always take it off the stove.

*Why:* some problems only show up at scale: rate limits, cost and rare intents. Steps bound the blast radius.

### 2. What to show
1. **6 · Gradual rollout.** Approve *advance to 25%*. Send the suggested replay traffic (16) and watch the gate pass on its own.
2. Repeat for **50%** (8 requests) and **100%** (4 requests).
   - At 100% there is no v1 traffic in the window, so the latency and cost ratios compare against **the champion's metrics captured in the canary window**. The check name says so.
3. The **Gate history** table lists every decision with its policy version. Read it like an audit timeline.
4. Optional: click **Manual rollback** at 50% to show the operator path. It creates a `rollback` audit entry with your name. You would then restart from the Canary page.

### 3. Talking points and student questions
- *"Who approves each step?"* A person approves each traffic increase; the system can only *decrease* exposure on its own (rollback). Automation reduces risk and people accept it. That is the human-oversight principle (EU AI Act Art. 14).
- *"Only 4 requests at 100%? Really?"* Classroom-sized, so nobody waits. A bank would run each step for hours or days with thousands of requests, and the `min_*` values in `policy.yaml` would be in the hundreds. Same gate, bigger numbers.
- *"Why 25/50/100?"* They are policy values (`rollout.steps`), and some companies use 1/5/25/100. What matters is that the steps are decided in advance.

### 4. What could go wrong in real life
> A payments company jumped from 5% to 100% because the 5% "looked great". At full traffic, the new model's longer answers tripled token spend and blew the monthly budget in nine days. The cost-ratio check stops exactly this, and LiteLLM's per-key budgets put a hard ceiling under it.

### 5. Checkpoint question
*"The rollout is at 50% and the error rate check fails at 2.5%. What happens in the next 15 seconds, without anyone clicking?"* (Automatic rollback to 100% v1, plus an incident in the audit log.)

---

## Stage 7 · Promotion, retirement and continuous governance (10 min)

### 1. Concept
With all gates passed at 100%, make it official: v2 becomes **champion**, and v1 is **retired but kept** for rollback. Then write the report, and keep re-checking the champion over time, because models and providers drift.

*Analogy:* the new hire passes probation and gets a permanent contract. The old employee's records are archived, not shredded. Annual reviews continue.

*Why:* SR 11-7 ongoing monitoring; EU AI Act Art. 12 (record-keeping) and Art. 72; ISO 42001 performance evaluation and continual improvement.

### 2. What to show
1. **7 · Promotion & monitoring.** As **Governance Board**, approve *promote v2 to @champion, retire v1*. The registry table now shows:
   - v2 = `champion`, status `production`
   - v1 = `retired`, alias `@retired`
   - The production route is 100% v2 with no challenger.
2. Click **Generate governance report**. The Markdown appears on screen, is saved in `reports/`, and is logged to MLflow. Walk through its sections:
   - proposal
   - registry
   - offline metrics side by side, with the gate
   - shadow stats
   - every gate decision with its policy version (including the rollback incident)
   - the traffic timeline with approvals
   - the full audit trail, with the **hash chain verified INTACT**
3. **Run drift check now** re-evaluates the champion with fresh calls and compares it with its reference evaluation (allowed drop: 0.05). It re-runs 4 golden examples with fresh calls and compares them with the reference scores for the same 4 examples. It takes about 2–3 minutes. In production this is a scheduled job, for example nightly.
4. **Audit log** page: click **Prove it: try to edit history**. Postgres refuses the edit because the table is append-only.

### 3. Talking points and student questions
- *"Why not delete v1?"* Rollback must stay one click away, and auditors need to reproduce past decisions. Retire, don't delete.
- *"What causes drift if the model weights don't change?"* Several things: the provider updates the model behind the same ID, the judge changes, customer questions change (new products, seasonal topics), or the prompt or policy changes. Drift checks catch all of these.
- *"Is the hash chain blockchain?"* No. It is the same idea at a small scale: each entry's hash includes the previous entry's hash, so changing any old entry breaks every later hash, and the console detects it.

### 4. What could go wrong in real life
> A provider silently updated a model behind an unchanged model ID. A bank's assistant became noticeably more verbose and started recommending "speaking to an adviser about investing" in situations it shouldn't. Only a team with a scheduled re-evaluation against a fixed golden set noticed within a week. Others found out from customer complaints.

### 5. Checkpoint question
*"Name three pieces of evidence from today that you would hand to an auditor."* (Examples: the approved proposal with its SHA, the MLflow evaluation runs, the gate decisions with policy fingerprints, the audit log hash verification, the governance report.)

---

## Glossary

| Term | Meaning |
|---|---|
| **Champion** | The model version currently serving production (`@champion` alias) |
| **Challenger** | A candidate version trying to replace the champion (`@challenger`) |
| **Gate** | An automated pass/fail check with thresholds fixed in advance (`governance/policy.yaml`) that must pass before the next stage |
| **Shadow deployment** | The challenger receives a copy of real traffic; its answers are recorded and compared but never shown to users |
| **Canary** | A small share of real users is served by the challenger while metrics are watched |
| **Gradual rollout** | Exposure increases in steps, with a gate and automatic rollback at each step |
| **Rollback** | Returning traffic to the champion; automatic on any gate breach |
| **Model card** | A short document on a model's intended use, limits, evaluation and risks |
| **Audit trail** | An append-only record of who did what, when, why and with what evidence |
| **LLM-as-a-judge** | Using an LLM, ideally a different model from the ones under test, to score or compare answers against a rubric |
| **Drift** | Change in a model's behaviour or quality over time, caused by the model, the data, the prompt, the judge or the world |
| **Golden set** | A fixed, versioned set of inputs with reference answers used to compare versions fairly |
| **Red-team set** | Adversarial and high-risk inputs that test safety behaviour |
| **Slice** | A subset of evaluation data (here, a category or intent), compared separately so averages cannot hide regressions |
| **Virtual key** | A gateway API key with its own model allow-list, rate limit and budget |

## Recap slide outline (5 slides)

1. **The question:** how does a company decide which model goes to production, prove it, roll it out with control, and keep a trail?
2. **The lifecycle:** Baseline → Proposal → Offline eval → Registry → Shadow → Canary → Rollout → Promotion, plus drift checks. Every arrow is a gate.
3. **Evidence over opinion:** thresholds written before the results; same golden set for both versions; slices; an independent judge; real traffic.
4. **Control:** one gateway, least-privilege keys, people approve increases while the system can only decrease exposure, automatic rollback, retire don't delete.
5. **Trail:** proposal SHA, MLflow runs and tags, gate decisions with policy fingerprints, a hash-chained audit log, and a generated report. Map each item to SR 11-7, NIST AI RMF, the EU AI Act and ISO 42001.

## Take-home exercise

**Propose v3 and defend your decision.**
1. Copy `proposals/nova-assist-v2.yaml` to `nova-assist-v3.yaml`. Propose a change you can test with the routes that exist, for example *"v3 = v1 with a stricter system prompt"*, by editing `governance/policy.md` (a new prompt version), or by changing generation parameters in `policy.yaml`.
2. Change **one threshold** in `policy.yaml` and write two sentences justifying it as if to the risk committee.
3. Reset the demo and run the pipeline to promotion or rollback.
4. Submit:
   - your proposal,
   - the generated governance report,
   - and one paragraph: *Would you sign off this change as Model Risk Officer? Which single piece of evidence convinced you, and what evidence is still missing?*

Grading hint: reward students who notice the limits of their own evidence (judge noise, small samples, generic references) over students whose run simply passed.
