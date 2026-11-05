# DEMO.md: The NovaBank story, an instructor's guide to model governance

**Everything happens in the browser:** the governance console at <http://localhost:8501> (MLflow at <http://localhost:5000> in a second tab, for the evidence). The terminal is only used once, for setup.

---

## Part 1 · One-time setup (the only terminal commands)

| Do this | What happens | Why |
|---|---|---|
| `git clone <your-repo-url> model-governance && cd model-governance` | You get the project | |
| `cp .env.example .env`, then paste your Groq key after `GROQ_API_KEY=` | The gateway can reach Groq | The key lives only in the gateway container, never in the app (least privilege) |
| `docker compose up -d --build` | Six services start: Postgres, LiteLLM gateway, MLflow, Nova Assist app, governance worker, console. The worker sets up Week 0 by itself | One command, so students can reproduce it at home |

From here on, **you never need the terminal again**. Open <http://localhost:8501>.

## Part 2 · Before class

| Do this | What happens | Why |
|---|---|---|
| Open **System check** in the sidebar | Four service tiles show *Healthy* | Proves the stack is up |
| Click **Live check** | One tiny real call to each of the four models (v1, v2, v3, judge), each with an OK | Proves the Groq key and every route work |
| Tick the boxes and click **Rehearse the whole story** | The whole seven-week story plays automatically in about 2 minutes; a table shows every chapter OK, the time taken and the number of real LLM calls (about 11). It ends by resetting to Week 0 | You know the full lesson works before students arrive |
| Open **Governance policy** | You see `policy.yaml`, where every threshold lives | Students will keep asking "where does that number come from?" |

Set **who you are** in the top bar (person icon: name + role). Roles matter: the console refuses an approval from the wrong role. 

## Part 3 · The cast

| Person / model | Role in the console | In the story |
|---|---|---|
| **Priya Raman** | Product Owner | Wants a better chatbot; writes the proposal |
| **Dr. Amara Celik** | Model Risk Officer | The independent checker: approves the proposal, reviews judge flags, owns the policy |
| **Tomás Okafor** | ML Platform Lead | Runs the platform; approves every traffic change |
| **The Board** | Governance Board | Approves the final promotion |
| **Nova (v1)** · `gpt-oss-20b` | champion | Today's chatbot |
| **Atlas (v2)** · `gpt-oss-120b` | candidate | 6× bigger: "better answers" |
| **Sentinel (v3)** · `gpt-oss-safeguard-20b` | candidate | Safety-tuned: "fewer unsafe answers" |

## Part 4 · Real calls vs simulated data

A real bank looks at tens of thousands of conversations per week. On a free LLM tier that would take days, so the console runs in **classroom simulation mode**:

- **About 11 calls in the whole story are real.** They go through the real gateway and are really answered, copied, routed and judged by Groq models, so students see real answers.
- **The bulk is simulated.** Each traffic week is 10,000 customer questions, and the exam has 141 of 142 examples per model. The numbers come from **made-up teaching profiles** in `policy.yaml → simulation`; they are *not* measurements of the real models.
- **The machinery is real:** gateway weights and mirroring, the model registry, gates, approvals, human review, automatic rollback, the audit log and the report.
- **You can always tell them apart:** a yellow *Classroom simulation* badge, "N real · M simulated" on every tile, and `simulated = true` in the database. Simulated rows never enter LiteLLM's or MLflow's own records.

---

## Chapter 0 · Where we start (Week 0)

**The story.** Nova (v1) answers about 10,000 customer questions a week. Before anyone may change it, Tomás writes down exactly what is live.

**The idea, simply.** You can't govern what you haven't written down. A "model" is more than the AI: it is **model + prompt + settings + route**, and changing any one of them changes behaviour. The model registry is the bank's official list of models; an **alias** like `@champion` is a label that points at the version in production.

**Step by step.**

| Do this | What happens | Why we do it |
|---|---|---|
| Open **The story** page and point at **Live architecture** | Animated dots flow Customers → Nova Assist app → LiteLLM gateway → **v1 · Nova** (100%) | Students see the real traffic path before anything changes |
| Open **Chapter 0** → *What is live, exactly* | Champion, provider model, prompt version (`prompts:/nova-assist-system/1`) and route | This is the inventory: the "before" photo |
| Type a question in **Try production** and click **Send to the production app** | A real answer appears, marked *answered by v1 · Nova* and *real Groq call* | Proves production works and only goes through the gateway |
| Scroll to **Model Registry** (or click *open in MLflow ↗*) | Registry version with alias `@champion` and tags (model, prompt, route) | Shows where the inventory is stored |
| On **The story** page, look at *Routes behind the gateway* | `nova-assist` is marked **governed** | Only governed actions in this console can change who serves customers |

**Questions students ask.**
- *"Why version the prompt? It's just text."* Changing the prompt can change answers as much as changing the model.
- *"Why can't the app call Groq directly?"* A single gateway gives one place for keys, budgets, logs, retries and traffic control. The app's key can't even reach the judge model.


---

## Chapter 1 · The proposal (Week 1)

**The story.** Customers complain that Nova is vague, and the fraud team wants fewer unsafe answers. Priya proposes **two** candidates, Atlas and Sentinel. Nothing gets tested until Amara signs off.

**The idea, simply.** Every change starts as a **written request**: why, for what use, the risks, the cost, how success will be judged, and how to undo it. Success criteria and the rollback plan are written **before** testing, so nobody moves the goalposts later. The approver must be **independent** of the team asking. Proposing several candidates is normal: the evidence, not enthusiasm, picks the winner.

**Step by step.**

| Do this | What happens | Why we do it |
|---|---|---|
| Open **Chapter 1** | Three cards: **Nova** (champion), **Atlas**, **Sentinel**, each with model, pitch, cost per 1,000 questions and main risk | Compare the options side by side before testing anything |
| Read the proposal: *Why*, *Risk assessment*, *Success criteria*, *Rollback plan*; expand both **model cards** | Each risk names the later chapter that controls it | Shows planning ahead: every risk has a control |
| Top bar → role **Product Owner**, click **Submit to the governance board** | Toast "Proposal submitted"; the audit log records the proposal and model-card fingerprints (SHA-256) | Fingerprints prove later exactly which document was approved |
| Switch to **Student**, choose **Approve**, write anything, click **Record decision** | **Refused**: Student is not an allowed approver | Only independent, authorised people can approve |
| Switch to **Model Risk Officer**, choose **Approve**, write a rationale (e.g. "Medium risk accepted; evaluate both candidates"), click **Record decision** | "Approved for evaluation" | The written rationale is what an auditor reads later |
| Open **Audit log** | *proposal submitted* and *proposal decision · APPROVED* with who, when and why | Every decision is traceable |

---

## Chapter 2 · The exam (Week 1)

**The story.** Nova, Atlas and Sentinel sit **the same exam**: 130 real banking questions and 12 attacks. An independent judge marks every answer. A candidate must pass **every** check; if both pass, the better one wins.

**The idea, simply.** Like a driving test: same route, same examiner, same score sheet, and the pass mark is set in advance.
- The **golden set** is real customer questions with model answers (from the Bitext banking dataset). The **red-team set** is attacks: prompt injection, requests for card numbers, investment advice, fraud.
- The **judge** is an AI from a different family than the candidates, so it doesn't favour its own style. Judges make mistakes, so thresholds have margins and humans spot-check.
- The **gate** is an AND of three things: every score above its bar; no safety score worse than today's chatbot; and no single topic (intent) worse than today, because an average can hide a weak area.

**Step by step.**

| Do this | What happens | Why we do it |
|---|---|---|
| Open **Chapter 2**, click **Run the exam** | A job runs for about 15 s: Nova, Atlas and Sentinel answer the same 142 questions; the judge scores them | Fair comparison: identical exam for everyone |
| Read the **Exam result** banner | **PASS: Atlas is selected** as the challenger | One clear decision, made by rules written in advance |
| Read the three cards | **Atlas: selected** (64/64 checks). **Sentinel: rejected**: it failed helpfulness, correctness and many topic checks | Sentinel was very safe but too cautious, exactly the risk its model card predicted |
| Look at **Quality & safety, side by side**; hover a bar | One bar per model per metric, plus a black threshold line | Shows *why* each model passed or failed |
| Read the **Live sample** | One real answer from each candidate, scored by the real judge | Students see real AI output, not just numbers |
| Look at **Per-intent slices**; switch between *correctness*, *policy compliance* and *helpfulness* | Nova vs Atlas per banking topic; red labels mean worse than Nova | A good average must not hide a bad topic |
| Expand **Gate checks** for each candidate; click **MLflow run ↗** | Open http://localhost:5000/#/experiments/1, the experiment called nova-assist-governance | Evidence an auditor can re-open |

**Questions students ask.**
- *"Sentinel was the safest. Why reject it?"* A bot that refuses ordinary questions fails customers. The policy needs helpful **and** safe.
- *"Why test Nova too?"* "Not worse than what customers have today" is itself a gate rule.
- *"Who sets the pass marks?"* The Model Risk Officer, **before** the results. Changing a threshold after a fail is a red flag, and every decision records the policy version used.


---

## Chapter 3 · Registration (Week 1)

**The story.** Atlas, the winner, gets an official identity in the registry. It is now the **challenger**: allowed to see production traffic next week, not yet to answer customers. Sentinel is never registered.


**Step by step.**

| Do this | What happens | Why we do it |
|---|---|---|
| Open **Chapter 3**, click **Register v2 · Atlas as @challenger** | A new registry version with alias `@challenger` and lineage tags (exam run, proposal and model-card fingerprints, approver) | Traceability: the model and its evidence are linked forever |
| Look at **Where it sits now** | Atlas: *REGISTERED · NO TRAFFIC*; Sentinel: *REJECTED AT THE EXAM*; Nova still answers 100% | Registering is not deploying; customers are unaffected |
| Optional: MLflow → Models → `nova-assist` | Both aliases are visible; the model card is attached to the registration run | Shows the same facts in the underlying tool |

---

## Chapter 4 · Shadow week (Week 2)

**The story.** For one week every customer question is **silently copied** to Atlas. Customers still only see Nova's answers. The judge compares both. On Friday the board reviews the week.

**The idea, simply.** Exams are tidy; real customers are messy (typos, slang, odd questions). Shadow mode lets the challenger practise on real traffic with **zero customer risk**, like a trainee pilot flying the simulator alongside the real flight.
- The **gateway** makes the copy (LiteLLM's built-in mirroring).
- The **worker** pairs each copy with the real answer and asks the judge which is better, shuffling the order so the judge can't favour "the first one".
- If the judge flags a **critical violation** (e.g. asking for a PIN), a **human must confirm or overturn it** before the gate can pass. Automated judges need human oversight too.

**Step by step.**

| Do this | What happens | Why we do it |
|---|---|---|
| Role **ML Platform Lead**, click **Monday: approve shadow mirroring** | The diagram shows a **dashed, animated copy line** to Atlas marked *SHADOW · SILENT*, plus a line from Atlas to the judge, never to the customer. The top bar says *shadow on* | Students *see* that customers are unaffected |
| Leave *1 real + 10,000 simulated* and click **Simulate the shadow week** | In a few seconds: 1 real question is really copied and judged; 10,000 simulated ones fill the week | A full week of evidence without using up the LLM quota |
| Read the four tiles | *Questions copied*, *Judged pairs* (how many by the real judge), *Critical violations*, *Challenger errors* | These are the four things the Friday gate looks at |
| Read **Who answered better?** and **The week, day by day** | Atlas better / tie / Nova better; daily charts with quieter weekends | Is the challenger at least as good as today's chatbot? |
| If a flagged pair appears under **Human review**, read it aloud; as **Model Risk Officer** type a reason and click **Confirm** or **Overturn** | The decision and reason go to the audit log; unreviewed flags keep blocking the gate | Humans oversee the automated judge |
| Click **Friday: check the shadow gate** | Gate PASS: mirroring switches off automatically | Going live with real customers needs a separate approval next week |

**Questions students ask.**
- *"Does copying slow customers down?"* No. The copy runs in the background, and judging happens later.

---

## Chapter 5 · Canary week (Week 3)

**The story.** Now **5% of real customers** get Atlas's answers; everyone else still gets Nova. The worker watches every 15 seconds and pulls Atlas back on its own if anything breaks the rules.

**The idea, simply.** Like a canary in a coal mine: a small, early exposure that warns you before everyone is affected. The live gate compares Atlas with Nova **in the same week**: errors (including ones the customer never saw because the gateway fell back to Nova), slowest-5% response time (p95), cost and judged quality. There is a minimum number of samples, so nobody decides on too little data. A breach triggers an **automatic rollback**, because machines react in seconds and people take hours.

**Step by step.**

| Do this | What happens | Why we do it |
|---|---|---|
| Role **ML Platform Lead**, click **Monday: approve 5% of customers to v2 · Atlas** | The diagram shows two live lines: **95% Nova**, **5% Atlas** | A person approves every increase in exposure |
| Click **Simulate the canary week** | Tiles per model (questions, errors, p95, quality, cost); **Canary week, day by day** charts both models | Live evidence about real-style traffic |
| Watch the gate banner (no click needed) | Within 15 s it turns **PASS** by itself; *Gate checks* shows each value against its threshold | Automatic monitoring: the system decides from rules |

**The rollback demo (honest: nothing is faked).**

| Do this | What happens | Why we do it |
|---|---|---|
| Role **Model Risk Officer** → **Governance policy**. Change `max_p95_latency_ratio: 1.5` to `0.5`, change `version: "1.0"` to `"1.1-demo"`, write a reason ("Board demands Atlas be twice as fast"), click **Save policy version** | The policy diff is saved to the audit log | Boards change their risk appetite; that is a governed action too |
| Go back to **Chapter 5** and wait up to 15 s | **Automatic rollback**: the diagram snaps back to 100% Nova, Atlas shows *ROLLED BACK*, the calendar turns the canary week red, and a red banner explains why | The system enforces the new rule on the week's data immediately |
| Open **Audit log** | `INCIDENT auto rollback` by `governance-worker`, with the failed check | Incidents are recorded automatically |
| Back in **Governance policy**, set `1.5` again with version `"1.2"` and a reason; then **Chapter 5 → approve the canary again** and **Simulate the canary week** | The canary passes again | The full episode, failure and recovery, is in the record |

---

## Chapter 6 · Weekly rollout (Weeks 4–6)

**The story.** Every Monday Tomás approves the next step (25%, then 50%, then 100%), and each step runs a full week under the same gate.


**Step by step (repeat three times).**

| Do this | What happens | Why we do it |
|---|---|---|
| Role **ML Platform Lead**, click **Monday: approve the next step, 25% to v2** | The diagram's lines change thickness: **75 / 25** | A human decides each increase |
| Click **Simulate the rollout 25% week** | Tiles and daily charts for both models; the gate passes within 15 s | Same rules at every step |
| Repeat for **50%** (50 / 50) and **100%** (0 / 100) | At 100% there is 1 real question, answered by Atlas and judged for real | Real traffic at full exposure |
| Read **Gate history** | Every weekly decision with the policy version it used | The timeline an auditor reads |
| (Optional) click **Manual rollback** | Back to 100% Nova, with a *rollback* audit entry carrying your name | An operator can always pull the plug |

---

## Chapter 7 · Promotion & beyond (Week 7)

**The story.** Every gate passed at 100%. The Board makes Atlas the champion. Nova is retired, but kept. The report goes to the board, and a weekly drift check starts.

**The idea, simply.**
- **Promotion** just moves the `@champion` label.
- **Retire, don't delete:** rollback stays one click away, and auditors can always reproduce past decisions.
- The **report** is generated only from records, never written by hand.
- **Drift:** models can get worse without anyone touching them (the provider updates the model, customers ask new things), so the champion is re-checked every week.

**Step by step.**

| Do this | What happens | Why we do it |
|---|---|---|
| Role **Governance Board**, click **Board: promote v2 · Atlas to @champion, retire v1** | The diagram shows Atlas answering 100% and Nova *RETIRED · KEPT FOR ROLLBACK*; the registry shows `@champion` on Atlas and `@retired` on Nova | The official change of champion is one recorded action |
| Click **Generate the report for the board** | The report appears: proposal, three-way exam, shadow results, every gate decision (including the rollback incident), approvals, and the full audit trail with the **hash chain verified INTACT**. **Download Markdown** saves it | One document an auditor can read end to end |
| Click **Run this week's drift check** | Gate PASS: no drift | Continuous monitoring after go-live |
| To show drift being caught: **Governance policy** → set `drift_shift: -0.10`, bump the version, save; run the drift check again | Gate **FAIL**: the quality drop is detected and recorded | Proves monitoring catches decay |
| **Audit log** → **Try to edit history** | "Postgres refused the edit" | The record can't be rewritten |
| **Chapter 0 → Reset to Week 0** (when done) | The story restarts; the audit log keeps everything, including the reset | Ready for the next class |

---
