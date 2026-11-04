# Dataset card: Nova Assist evaluation and replay sets

| | |
|---|---|
| **Source** | [bitext/Bitext-retail-banking-llm-chatbot-training-dataset](https://huggingface.co/datasets/bitext/Bitext-retail-banking-llm-chatbot-training-dataset) |
| **Revision** | `3e3621092fc6baaf7f53ceb6f091c60ae99acb67` (pinned in `build_datasets.py`) |
| **Licence** | CDLA-Sharing-1.0 (redistribution allowed; derived data stays under the same licence; attribution to Bitext) |
| **Source size** | 25,545 rows, 26 intents, 9 categories (CARD, LOAN, ACCOUNT, FIND, CONTACT, TRANSFER, ATM, PASSWORD, FEES) |
| **Build** | `python data/build_datasets.py`, seed 42, deterministic |

We use the Bitext **retail-banking** set rather than the generic customer-support set. Both come from the same publisher under the same licence, and this one matches NovaBank's domain (cards, loans, transfers, ATMs, passwords, fees).

## Files

| File | Rows | Purpose | Used in |
|---|---|---|---|
| `golden.jsonl` | 130 | Golden evaluation set: 5 examples per intent, stratified, with Bitext reference answers | Stage 2 offline evaluation, continuous re-evaluation |
| `replay.jsonl` | 208 | Live-traffic replay: 8 per intent, **disjoint** from golden (different source rows) | Stages 4–6 (shadow, canary, rollout) |
| `redteam.jsonl` | 12 | **Course-authored red-team test cases** (not from Bitext): prompt injection, card numbers, passwords, financial advice, fraud escalation | Stage 2 safety metrics |

Fields: `id`, `source_row` (row index in the source CSV), `intent`, `category`, `input`, and in the golden set only, `reference`. Red-team rows carry `attack` and `expected_behavior` (`refuse` or `escalate`).

## Evaluation profiles

`governance/policy.yaml → evaluation.profile` picks how much of the golden set a run uses:

- **lite** (default, sized for the Groq free tier): 3 examples per **category** = 27 examples, plus all 12 red-team cases. Slices are compared per category.
- **full**: all 130 examples, plus all red-team cases. Slices are compared per intent. Needs a paid Groq tier, or a run spread over several days (runs resume automatically).

## Known limitations

- Bitext reference answers are synthetic and generic. They often say "your card issuer" and contain placeholders such as `{{Customer Support Phone Number}}`. Correctness is judged on substance (right steps, right channel), not on wording or placeholders.
- The inputs deliberately include typos and informal language. That is realistic, not noise to clean.
- English only. The set has no multilingual or accessibility coverage, so a production programme would add both.
- 12 red-team cases is a teaching-sized set. Real programmes maintain hundreds and refresh them after every incident.
