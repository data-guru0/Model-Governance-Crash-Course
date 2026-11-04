# DEMO.md: The NovaBank story, an instructor's guide to model governance

**Audience:** beginners and intermediates · **Length:** about 2 h 30 min plus a break · **You drive:** the governance console at <http://localhost:8501> (MLflow at <http://localhost:5000> in a second tab, for the evidence).

You teach model governance as **one story that unfolds over seven weeks**. NovaBank wants to change the model behind its customer-support chatbot. The product team proposes **two candidates**. The governance board says: *"Prove it, roll it out safely, and keep an audit trail."* Students watch that change go through a proposal, an exam, a shadow week, a canary week and a weekly rollout, ending in promotion (or rollback).

**How the work is split.** The console is the *practical* side: each chapter is a page with the story, the buttons, a live architecture diagram and the evidence. **All the theory is in this file.** Each chapter below has the same seven parts:

1. **The story**: what happens at NovaBank that week (read it aloud).
2. **The theory**: the governance concept, why companies do it, and the frameworks it maps to.
3. **Do it in the console**: the exact clicks.
4. **What students see**: how to read every number on screen.
5. **Discussion**: talking points and common questions, with answers.
6. **Real-world incident**: a short, realistic story of what goes wrong without this step.
7. **Checkpoint**: one question for the class.

---

## The cast

| Person | Role in the console | What they do in the story |
|---|---|---|
| **Priya Raman** | Product Owner | Wants a better chatbot; writes the proposal |
| **Dr. Amara Celik** | Model Risk Officer | Independent challenger: approves the proposal, reviews judge flags, edits the policy |
| **Tomás Okafor** | ML Platform Lead | Runs the platform: approves every traffic change |
| **The Board** | Governance Board | Approves the final promotion |
| **Nova (v1)** | `gpt-oss-20b` | Today's chatbot, the **champion** |
| **Atlas (v2)** | `gpt-oss-120b` | Candidate: a 6× larger model ("better answers") |
| **Sentinel (v3)** | `gpt-oss-safeguard-20b` | Candidate: a safety-tuned model ("fewer unsafe answers") |

Set **who you are** in the console's top bar (person icon: name + role). Approvals are refused for the wrong role. That is intentional; show it at least once.

## Before class

1. `docker compose up -d`, then open the console. The **The story** page shows four health tiles; all should read *Healthy*. **Live check** makes one tiny real call per model (4 calls) to prove the key works.
2. Go to **Chapter 0 → Reset to Week 0** so the story starts fresh. The calendar strip at the top of every page shows Week 1 to Week 7 with real dates starting this week.
3. Keep `governance/policy.yaml` open in an editor. Every threshold the class will see lives there.

## Timed lesson plan

| Time | Chapter | Story week | Click time |
|---|---|---|---|
| 0:00 | Prologue: why model governance | - | - |
| 0:15 | 0 · Where we start | Week 0 | < 1 min |
| 0:25 | 1 · The proposal | Week 1 · Monday | < 1 min |
| 0:40 | 2 · The exam | Week 1 · Tue–Thu | ~15 s |
| 1:05 | 3 · Registration | Week 1 · Friday | < 1 min |
| 1:15 | *Break* | | |
| 1:25 | 4 · Shadow week | Week 2 | ~20 s |
| 1:45 | 5 · Canary week + rollback demo | Week 3 | ~1 min |
| 2:05 | 6 · Weekly rollout | Weeks 4–6 | ~15 s per week |
| 2:15 | 7 · Promotion & drift | Week 7 | < 1 min |
| 2:25 | Epilogue, recap, take-home | | |

Clicks are fast, so **the time is for talking**. Every chapter's console page starts with the story text and a "What happens when you click" panel; read both aloud before clicking.

## Real calls vs simulated data (say this in the prologue)

A real bank looks at **tens of thousands** of conversations per week and thousands of evaluation examples per change. On a free LLM tier that would take days and burn the daily quota. So the console runs in **classroom simulation mode** (`simulation.enabled: true` in `policy.yaml`):

- **A handful of calls per chapter are real.** They go to Groq through the real gateway and are really mirrored, routed and judged. Students see real answers, and the plumbing is proven end to end.
- **The bulk is simulated** by `governance/simulate.py`: each traffic chapter simulates a **full week of 10,000 customer questions**, and the exam simulates 141 of the 142 examples per model. The numbers come from synthetic profiles of the three models in `policy.yaml → simulation`. **We invented those profiles for teaching. They are not measurements of the real models.**
- **Everything else is the real production machinery:** gateway weights and mirroring, virtual keys, the MLflow registry and aliases, gates with production-sized minimums, automatic rollback, human review, the hash-chained audit log and the report.
- **Never mixed up:** simulated rows carry `simulated = true`, simulated exam examples `source: simulated`, the console shows a yellow *Classroom simulation* badge and "N real · M simulated" on every tile, and the simulator never writes into LiteLLM's or MLflow's own tables.

**Reference run** (whole story driven end to end through the console API on 2026-11-05):

| Chapter | Real answers | Real judge calls | Simulated | Click time | Outcome |
|---|---|---|---|---|---|
| 0 · Where we start | 1 | 0 | 0 | 2 s | Live answer from v1 |
| 1 · The proposal | 0 | 0 | 0 | < 1 s | Student refused; Model Risk Officer approved |
| 2 · The exam | 2 | 2 | 141 examples × 3 models | 10 s | **Atlas PASS (64/64), Sentinel FAIL (42/64)**: Atlas selected |
| 3 · Registration | 0 | 0 | 0 | 4 s | Atlas = `@challenger` |
| 4 · Shadow week | 2 (v1 + mirrored v2) | 1 | 10,000 questions + pairs | 14 s | Gate PASS: 9,920 judged pairs, 77% win+tie |
| 5 · Canary week | 1 | 0 | 10,000 | 18 s | Passed automatically |
| 5b · Rollback demo | 0 | 0 | 10,000 | 29 s | Threshold tightened → **automatic rollback** → restored → canary passed again |
| 6 · Rollout 25 / 50 / 100% | 0 / 0 / 1 | 0 / 0 / 1 | 10,000 per week | 14 / 14 / 13 s | Each week passed automatically |
| 7 · Promotion & drift | 0 | 0 | 142 examples | 8 s | Atlas = `@champion`, Nova retired, report, drift PASS |
| **Whole story** | **7** | **4** | | **~2.5 min of clicks** | Audit chain intact |

---

## Prologue (15 min): why companies govern models

**Plain-language pitch.** A model is a decision-maker you hired. Governance is the hiring process, the probation period and the performance reviews, all written down. Without it, "the new model seemed better in a demo" is the only evidence anyone has when a regulator, an auditor or a journalist asks why the bot told a customer to read out their card number.

**Why banks care most:**
- **Incidents:** a support bot that gives wrong refund rules or asks for a PIN is a conduct risk and a fraud vector.
- **Cost:** a 2× pricier model across millions of chats is a budget line, not a detail.
- **Regulators:** banks have been supervised on their models for over a decade.

**The four frameworks** (brief and accurate):

| Framework | What it is | Where it shows up in the story |
|---|---|---|
| **SR 11-7** (US Federal Reserve / OCC, 2011) | *Supervisory Guidance on Model Risk Management*: model inventory, sound development, **independent validation with "effective challenge"**, ongoing monitoring, governance and documentation | Chapter 0 inventory, the Model Risk Officer, the exam, monitoring |
| **NIST AI RMF 1.0** (2023) + Generative AI Profile (NIST AI 600-1, 2024) | Voluntary framework with four functions: **Govern, Map, Measure, Manage** | Govern = policy + approvals · Map = proposal · Measure = exam & shadow · Manage = rollout & rollback |
| **EU AI Act** (Regulation (EU) 2024/1689) | Risk-based law. Chatbots have **transparency duties (Art. 50)**. High-risk systems (e.g. credit scoring, Annex III) have obligations on risk management (Art. 9), logging (Art. 12), human oversight (Art. 14), accuracy and robustness (Art. 15) and post-market monitoring (Art. 72). Obligations apply in phases, so check current dates. | Nova Assist is not high-risk, but NovaBank applies the same discipline |
| **ISO/IEC 42001:2023** | Certifiable **AI management system** standard: policy, roles, risk assessment, life-cycle controls, performance evaluation, continual improvement | The whole seven-week process is what an auditor would look for |

**One slide of the lifecycle:** Inventory → Proposal → Exam → Registration → Shadow → Canary → Rollout → Promotion (or Rollback) → Continuous monitoring. **Every arrow is a gate; every gate writes to the audit log.**

---

## Chapter 0 · Where we start (Week 0)

**The story.** Nova (v1) answers about 10,000 customer questions a week. Before anyone may change it, Tomás writes down exactly what is live.

**The theory.** You cannot govern what you have not inventoried. The "model" is not just the weights: it is **model + prompt + parameters + route**, and changing any of them changes behaviour. SR 11-7 starts with a model inventory. MLflow gives each version a registry entry, and **aliases** (`@champion`, `@challenger`, `@retired`) are named, movable pointers to versions. MLflow replaced its old fixed stages (Staging / Production) with aliases in version 2.9.

**Do it in the console.**
1. **The story** page: point at the **Live architecture** diagram. Customers → Nova Assist app → LiteLLM gateway → v1, with animated dots showing 100% of traffic on v1.
2. **Chapter 0** → *What is live, exactly*: champion, provider model, prompt URI (`prompts:/nova-assist-system/1`), route.
3. *Try production* → **Send to the production app**. One real customer question goes through the real stack. The caption says *answered by v1 · Nova* and *real Groq call*.
4. Open MLflow → Models → `nova-assist` (alias `@champion`), then Prompts → `nova-assist-system`.

**What students see.** The registry table: registry version, aliases, model, status, provider model. The *Routes behind the gateway* table on the story page: `nova-assist` is marked **governed** because it lives in the LiteLLM database, and only governed actions may change it.

**Discussion.**
- *"Why register the prompt? It's just text."* Changing the prompt changes behaviour as much as changing the model.
- *"Why can't the app call Groq directly?"* One choke point (the gateway) gives one place for keys, budgets, logging, retries and traffic control. The app holds only a virtual key that cannot even call the judge.

**Real-world incident.** A retailer's bot started granting refunds its policy didn't allow. Nobody could say whether the prompt, the model or the provider had changed, because none of them were recorded. The investigation took three weeks; the fix took ten minutes.

**Checkpoint.** *"If someone edits `policy.md` tomorrow, is that a model change?"* (Yes. It becomes prompt version 2 and should go through the same pipeline.)

---

## Chapter 1 · The proposal (Week 1, Monday)

**The story.** Customers complain Nova is vague; the fraud team wants fewer unsafe answers. Priya proposes **two** candidates: Atlas (bigger) and Sentinel (safety-tuned). Nothing is tested until Amara signs off.

**The theory.** Every change starts as a **written, structured request**: business justification, intended and out-of-scope use, risk tier and assessment, cost estimate, success criteria, rollback plan, and named owner and approvers. Writing success criteria and the rollback plan *before* testing is what keeps later decisions honest. Approval must come from someone **independent** of the team that wants the change ("effective challenge", SR 11-7). Proposing several candidates is normal: the evaluation, not enthusiasm, picks the winner. The EU AI Act risk classification belongs here: a support chatbot is not high-risk (no credit decisions), but has transparency duties.

**Do it in the console.**
1. **Chapter 1**: three cards compare **Nova (champion)**, **Atlas** and **Sentinel**: model, pitch, estimated cost per 1,000 questions, main risk.
2. Read the proposal: risk table (each risk names the later chapter that controls it), success criteria, rollback plan. Expand both **model cards**.
3. As *Product Owner*: **Submit to the governance board**.
4. Switch the top bar to **Student**, choose **Approve**, write a rationale, **Record decision**. You get **Refused**: the wrong role.
5. Switch to **Model Risk Officer**, approve with a rationale ("Medium risk accepted; evaluate both candidates under policy 1.0").
6. **Audit log**: *proposal submitted* (with the proposal's and model cards' SHA-256) and *proposal decision · APPROVED*.

**Discussion.**
- *"Why hash the proposal?"* It proves which version was approved. Editing the YAML afterwards changes the hash.
- *"Why do model cards contain no scores?"* Numbers copied into documents go stale. The MLflow runs are the source of truth.

**Real-world incident.** A team swapped their support model "temporarily" for a cheaper one during a cost crunch. There was no proposal and no owner. Six months later complaints were up 30% and nobody remembered the swap.

**Checkpoint.** *"Which section of the proposal will we rely on if something goes wrong in week 4?"* (The rollback plan.)

---

## Chapter 2 · The exam (Week 1, Tuesday–Thursday)

**The story.** Nova, Atlas and Sentinel sit **the same exam**: 130 real banking questions and 12 attacks. An independent judge marks every answer. A candidate must pass every check; if both pass, the better one wins.

**The theory.** Offline evaluation is the validation step of SR 11-7, and *Measure* in the NIST AI RMF. Key ideas:
- **Same exam for everyone:** a versioned **golden set** (real questions with reference answers, from the Bitext retail-banking dataset) plus a **red-team set** (attacks).
- **Metrics:** answer relevancy; G-Eval rubrics for helpfulness, correctness and policy compliance; toxicity and bias; red-team refusal. Also latency, tokens and cost.
- **LLM-as-a-judge:** the judge (`qwen3.8-27b`) is from a *different model family* than the candidates, to limit self-preference bias. Judges are noisy, so thresholds have margins and humans spot-check.
- **The gate is an AND:** absolute thresholds **and** no safety regression versus the champion **and** no per-intent slice regression (so a good average can't hide a bad area).
- **Selection:** among passing candidates, the best by correctness, then helpfulness (`policy.yaml → evaluation.selection`).

**Do it in the console.**
1. **Chapter 2 → Run the exam** (about 15 s; 4 real calls).
2. Read the **Exam result** banner, then the three cards:
   - **Atlas: selected** (64 of 64 checks).
   - **Sentinel: rejected**: it fails *helpfulness*, *correctness* and many intent slices. It is very safe but over-cautious, and the gate catches exactly the risk its model card warned about.
3. **Quality & safety, side by side**: one bar per model per metric, with a black threshold tick. Hover for exact values.
4. **Live sample**: the one real answer from each candidate, scored by the real judge.
5. **Per-intent slices**: Nova vs the selected candidate per intent, sorted by difference. Red labels would mean the challenger is worse there. Toggle the metric.
6. Expand **Gate checks** for each candidate. Open the **MLflow run** links: params (judge, dataset version, prompt, git commit, policy fingerprint), datasets and the per-example table (`source` says real or simulated).

**Discussion.**
- *"Sentinel was the safest. Why reject it?"* Safety alone isn't the goal. An assistant that refuses ordinary questions fails customers and pushes them to call centres. The policy requires helpfulness **and** safety.
- *"Why evaluate v1 too?"* "No regression versus what customers have today" is a gate check.
- *"Who sets the thresholds?"* The Model Risk Officer, **before** results exist. Moving a threshold after a FAIL is the classic governance smell, and every gate decision records the policy fingerprint.

**Real-world incident.** A lender approved a new chatbot model because average helpfulness rose. Nobody sliced by intent: on "dispute a transaction" it started telling customers disputes were impossible after 30 days. That was wrong, and a regulator complaint followed.

**Checkpoint.** *"A candidate scores higher on helpfulness, but its red-team pass rate drops from 1.00 to 0.92 with a tolerance of 0.02. What does the gate say?"* (FAIL. Safety regressions are not traded for quality.)

---

## Chapter 3 · Registration (Week 1, Friday)

**The story.** Atlas, the winner, gets an official identity in the registry. It is now the challenger: allowed to see production traffic next week, not yet to answer customers. Sentinel is never registered.

**The theory.** Traceability: the registry entry is linked to its evidence (evaluation run, proposal hash, model card hash, approver). Two years from now, "why was this model allowed?" must be answerable from the registry alone. Aliases make roles explicit and moving them is atomic and auditable.

**Do it in the console.** **Chapter 3 → Register v2 · Atlas as @challenger**. The registry table gains a version with alias `@challenger` and the lineage tags. In the diagram, Atlas appears as *REGISTERED · NO TRAFFIC* and Sentinel as *REJECTED AT THE EXAM*. In MLflow, the model card is attached to the registration run.

**Discussion.** *"Registry version 8 but our label is v2?"* The registry counts every registration over time. The business label is a tag.

**Real-world incident.** An insurer's audit found a production model with no record of who approved it. The model was fine; the finding was "material weakness in model governance".

**Checkpoint.** *"Which tag would you open first if an auditor asked how v2 was validated?"* (`eval_run_id`.)

---

## Chapter 4 · Shadow week (Week 2)

**The story.** For a week every customer question is silently copied to Atlas. Customers only see Nova's answers. The judge compares both. On Friday the board reviews the week.

**The theory.** Curated exams miss messy real traffic: typos, slang, odd requests. **Shadow deployment** exposes the challenger to real traffic with **zero customer risk**. Mechanics:
- **Mirroring** happens at the gateway: LiteLLM's native `silent_model` setting.
- **Pairing:** each copied call is matched to the customer's real answer by request ID.
- **Pairwise judging** randomises which answer is "A" and which is "B" to counter the judge's *position bias*.
- **Human review:** the judge is an automated decision-maker too, so a flagged *critical* violation needs a human to confirm or overturn it (human oversight, EU AI Act Art. 14).
- **Shadow doesn't show customer reactions.** Only canary does.

**Do it in the console.**
1. As **ML Platform Lead**: **Monday: approve shadow mirroring**. Watch the diagram: a **dashed animated copy line** now runs from the gateway to Atlas, labelled *SHADOW · SILENT*, and a second line shows Atlas's answers going to the judge, never to the customer. The top bar says *shadow on*.
2. **Simulate the shadow week** (1 real + 10,000 simulated questions). The real one is truly mirrored by LiteLLM and truly judged.
3. Read the tiles: *Questions copied*, *Judged pairs* (how many by the real judge), *Critical violations*, *Challenger errors* (missing or failed copies).
4. **Who answered better?** shows Atlas better / tie / Nova better. **The week, day by day** shows what customers experienced (Nova), with weekend dips.
5. If a **critical violation** is flagged, read it aloud. As **Model Risk Officer**, confirm or overturn it with a reason. (While building this course the judge flagged *"you may need to confirm a one-time code sent to your phone"* as asking for a code. It doesn't; the reviewer overturned it.)
6. **Friday: check the shadow gate**. A PASS switches mirroring off automatically.

**Discussion.**
- *"Does copying slow customers down?"* No. The copied call runs in the background, and pairing and judging happen later in the worker.
- *"Why was a real shadow run rejected while we built this course?"* We replayed 45 requests in 90 seconds. Groq rate-limited the copies, and LiteLLM drops failed copies without logging them, so 11% were missing. The gate rightly failed. Real replays are paced to provider limits.

**Real-world incident.** A telecom shadow-tested a new assistant but logged only the new model's answers. Without pairs nothing could be compared, and two weeks of shadow traffic were wasted.

**Checkpoint.** *"77% win+tie but one confirmed critical violation: go to canary?"* (No. `max_critical_violations: 0`.)

---

## Chapter 5 · Canary week (Week 3)

**The story.** 5% of real customers are now answered by Atlas. The worker watches every 15 seconds and rolls back on its own if anything breaches policy.

**The theory.** A **canary** limits exposure while producing real evidence (EU AI Act Art. 72 post-market monitoring; SR 11-7 ongoing monitoring). The live gate compares challenger and champion **in the same window**: error rate (including failures hidden from customers by fallback), p95 latency ratio, cost ratio and judged quality. **Minimum sample sizes** stop a decision on too little data. Breaches trigger **automatic rollback**, because machines react in seconds and people in hours.

**Do it in the console.**
1. As **ML Platform Lead**: **Monday: approve 5% of customers to v2 · Atlas**. The diagram now shows two live lines: 95% to Nova, 5% to Atlas.
2. **Simulate the canary week**. Per-version tiles fill (questions, error rate, p95, quality, cost), and **Canary week, day by day** draws both models across Mon–Sun.
3. The gate banner turns PASS on its own within 15 s; the gate checks table shows each value against its threshold.

**Rollback demo (honest, nothing faked).**
1. Go to **Governance policy** as **Model Risk Officer**. Change `max_p95_latency_ratio: 1.5` to `0.5`, bump `version: "1.0"` to `"1.1-demo"`, give a reason ("Board demands Atlas be twice as fast as Nova"), **Save policy version**.
2. Within 15 s the worker re-checks the week against the stricter rule, finds the challenger's p95 above 0.5× Nova's, and **rolls back**. The diagram snaps back to 100% Nova, Atlas shows *ROLLED BACK*, the calendar marks the canary week red, and the audit log has an `INCIDENT_auto_rollback` entry with the failed check.
3. Restore `1.5` with version `"1.2"`, then **approve the canary again** and simulate the week. The policy history now tells the whole episode.

**Discussion.**
- *"Wasn't that rollback fake?"* No. The policy changed, which is exactly what a board does when its risk appetite changes, and the system enforced it on the week's data.
- *"Why ratios, not absolute latency?"* Provider speed varies through the day. Comparing in the same window cancels that out.

**Real-world incident.** A bank went to 100% on a Friday evening "because the canary looked fine". The canary had run for 20 minutes at 3 a.m. with 14 requests. On Monday the traffic mix changed and the model failed on mortgages.

**Checkpoint.** *"Why does the gate refuse to decide with 30 challenger requests when the minimum is 50?"* (Missing evidence must never pass.)

---

## Chapter 6 · Weekly rollout (Weeks 4–6)

**The story.** Every Monday Tomás approves the next step (25%, then 50%, then 100%), and each step runs a full week under the same gate.

**The theory.** Some problems only appear at scale: rate limits, cost, rare intents, month-end traffic. Pre-agreed steps bound the **blast radius**. **People approve increases; the system may only decrease exposure on its own.** At 100% there is no champion traffic left in the window, so ratios compare against the champion's canary-week numbers.

**Do it in the console.** For each step: **Monday: approve the next step, N% to v2**, then **Simulate the rollout N% week**. Watch the diagram's line thickness and percentages move (75/25, 50/50, 0/100), the daily charts for both models, and the gate pass. **Gate history** lists every weekly decision with the policy version it used. **Manual rollback** is always available.

**Discussion.**
- *"Who approves each step?"* A person approves every increase; automation only reduces exposure.
- *"Why weekly?"* A week covers weekday and weekend patterns; real programmes often use a full business cycle (payday, month-end).

**Real-world incident.** A payments company jumped from 5% to 100% because 5% "looked great". At full traffic the new model's longer answers tripled token spend, and the monthly budget was gone in nine days.

**Checkpoint.** *"At 50% the error-rate check fails. What happens in the next 15 seconds, without anyone clicking?"* (Automatic rollback to 100% champion, plus an incident in the audit log.)

---

## Chapter 7 · Promotion & beyond (Week 7)

**The story.** Every gate has passed at 100%. The Board makes Atlas the champion. Nova is retired but kept. The report goes to the board and the weekly drift check begins.

**The theory.** Promotion is a governed alias move, not a deployment trick. **Retire, don't delete**: rollback must stay one click away and auditors must be able to reproduce past decisions. The **governance report** is generated only from records. **Continuous governance**: models drift even if their weights don't (provider updates, changing questions, prompt edits), so the champion is re-examined on a schedule (SR 11-7 ongoing monitoring; EU AI Act Art. 12 record-keeping; ISO 42001 continual improvement).

**Do it in the console.**
1. As **Governance Board**: **Board: promote v2 · Atlas to @champion, retire v1**. The diagram now shows Atlas answering 100% and Nova as *RETIRED · KEPT FOR ROLLBACK*. The registry shows `@champion` on Atlas and `@retired` on Nova.
2. **Generate the report for the board**: proposal, the three-way exam, shadow stats, every gate decision (including the rollback incident), approvals, and the full audit trail with the hash chain verified **INTACT**. It can be downloaded as Markdown.
3. **Run this week's drift check**. To show a detection, first set `simulation.drift_shift: -0.10` in the policy: the check FAILs and records it.
4. **Audit log → Try to edit history**: Postgres refuses the edit.

**Discussion.**
- *"What causes drift if nobody changed anything?"* The provider updating a model behind the same ID, new products changing customer questions, prompt edits, or a judge change.
- *"Is the hash chain a blockchain?"* Same idea, small scale: each entry's hash covers the previous one, so editing any old entry breaks every later hash.

**Real-world incident.** A provider silently updated a model behind an unchanged ID. One bank's assistant became verbose and started suggesting "speak to an adviser about investing". Only a team with a weekly re-evaluation noticed within days; others found out from complaints.

**Checkpoint.** *"Name three pieces of evidence you would hand an auditor."* (Proposal + hash, MLflow exam runs, gate decisions with policy fingerprints, the verified audit log, the report.)

---

## Epilogue: what a real bank does differently

The console teaches the **mechanics** with production-sized gates; only the volumes are simulated. In production the same pipeline runs with:

| Chapter | This classroom | A real bank |
|---|---|---|
| Exam | 142 examples per model, 1 answered and judged for real | Thousands of golden examples per intent, hundreds of red-team attacks, confidence intervals, several calibrated judges, human review of samples |
| Shadow week | 10,000 simulated questions, 1 really copied | Every production question for one to several weeks |
| Canary week | 5% of a simulated week | 1–5% of real customers for a week or more |
| Rollout | One simulated week per step | One business cycle per step |
| Drift | Simulated re-check on demand | Scheduled real re-evaluation with alerting |

To run everything for real, set `simulation.enabled: false` and size the volumes to your quota (the `demo` exam profile is 14 examples, about 8 min per model on the Groq free tier).

## Glossary

| Term | Meaning |
|---|---|
| **Champion** | The model version serving production (`@champion`) |
| **Challenger** | The selected candidate trying to replace the champion (`@challenger`) |
| **Candidate** | A model proposed for evaluation; at most one becomes the challenger |
| **Gate** | A pass/fail check with thresholds fixed in advance (`policy.yaml`) |
| **Shadow deployment** | The challenger receives a silent copy of real traffic; its answers are never shown to customers |
| **Canary** | A small share of real customers is served by the challenger while metrics are watched |
| **Gradual rollout** | Exposure grows in pre-agreed steps, each with a gate and automatic rollback |
| **Rollback** | Returning traffic to the champion; automatic on any gate breach |
| **Model card** | A short document on a model's intended use, limits, evaluation and risks |
| **Audit trail** | Append-only record of who did what, when, why and with what evidence |
| **LLM-as-a-judge** | Using an LLM, ideally from another model family, to score or compare answers |
| **Drift** | A change in a model's behaviour or quality over time |
| **Golden set / red-team set** | Fixed real questions with references / adversarial inputs that test safety |
| **Slice** | A subset of the evaluation (here an intent) compared on its own so averages can't hide regressions |

## Recap slides (5)

1. **The question:** how does a company decide which model goes to production, prove it, roll it out with control, and keep a trail?
2. **The story in one line:** proposal (2 candidates) → exam (1 passes) → registration → shadow week → canary week → weekly rollout → promotion, plus weekly drift checks.
3. **Evidence over opinion:** thresholds set before results; the same exam for everyone; per-intent slices; an independent judge; human review of the judge.
4. **Control:** one gateway, least-privilege keys, people approve increases, machines only decrease exposure, automatic rollback, retire don't delete.
5. **Trail:** proposal hashes, MLflow runs and tags, gate decisions with policy fingerprints, a hash-chained audit log and a generated report, mapped to SR 11-7, NIST AI RMF, the EU AI Act and ISO 42001.

## Take-home exercise

**Write the next chapter.** NovaBank's fraud team proposes **v4 = Nova with a stricter system prompt**.
1. Copy `proposals/nova-assist-upgrade.yaml`, propose your candidate, and change **one threshold** in `policy.yaml` with a two-sentence justification to the risk committee.
2. Reset to Week 0 and run the story to promotion or rollback.
3. Submit your proposal, the generated governance report, and one paragraph: *As Model Risk Officer, would you sign this off? Which single piece of evidence convinced you, and what evidence is still missing?*

Reward students who name the limits of their own evidence (simulated volumes, judge noise, sample size) over students whose run simply passed.
