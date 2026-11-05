# Model Governance Crash Course

- **The console** (a web app) is the practical side: each chapter of the story is a page with buttons, a live architecture diagram and the evidence. **After setup, everything happens in the browser.**
- **[DEMO.md](DEMO.md)** is the instructor guide: simple theory plus step-by-step *do this → what happens → why* for every chapter.

## Setup (the only terminal commands)

**You need:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) running (give it at least 6 GB RAM, about 6 GB free disk) and a free **Groq API key** from <https://console.groq.com/keys>.

```bash
git clone <your-repo-url> model-governance && cd model-governance
cp .env.example .env            # open .env and paste your key after GROQ_API_KEY=
docker compose up -d --build    # first build takes about 5-10 minutes
```

Wait about a minute after the containers start (the worker sets up Week 0 by itself), then open **<http://localhost:8501>**.


Then follow [DEMO.md](DEMO.md).

## The UIs

| UI | URL | Login |
|---|---|---|
| **Governance console** (teach from here) | <http://localhost:8501> | none: pick a name and role in the top bar |
| MLflow (runs, Model Registry, Prompt Registry) | <http://localhost:5000> | none |
| LiteLLM admin (routes, keys, spend logs) | <http://localhost:4000/ui> | user `admin`, password = `LITELLM_MASTER_KEY` in `.env` (default `sk-nova-master-local`) |
| Nova Assist API (Swagger) | <http://localhost:8000/docs> | none |


## Models

Model IDs are confirmed against Groq's `/models` and live only in `litellm_config.yaml`.

| Role | Model | Why |
|---|---|---|
| Champion v1 "Nova" | `openai/gpt-oss-20b` | Small, cheap, fast: a plausible first launch |
| Candidate v2 "Atlas" | `openai/gpt-oss-120b` | Same family, 6× larger, 2× price: "bigger must be better, prove it" |
| Candidate v3 "Sentinel" | `openai/gpt-oss-safeguard-20b` | Safety-tuned, same price as v1. Its teaching profile is over-cautious, so the exam rejects it |
| Judge | `qwen/qwen3.8-27b` | Different model family from the candidates, which limits self-preference bias |

**Groq free tier (measured):** 1,000 requests/day, 8,000 tokens/min, 1,000 output tokens/min and about 200,000 tokens/day per model. The simulation keeps a full lesson to about 11 calls. With simulation off, the judge is the bottleneck (about 8 calls/min). Use the `demo` evaluation profile (14 examples, about 8 min per model) or `lite`; finished examples are cached, so an interrupted exam resumes.
