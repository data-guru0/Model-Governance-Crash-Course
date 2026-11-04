"""Build the golden evaluation set and the live-traffic replay set from the real Bitext
retail-banking dataset (CDLA-Sharing-1.0). Deterministic: pinned dataset revision + fixed seed.

The outputs (golden.jsonl, replay.jsonl) are committed to the repo, so students never need to
run this. Instructors re-run it only to rebuild the sets:  python data/build_datasets.py
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import random
import urllib.request
from collections import defaultdict
from pathlib import Path

REPO = "bitext/Bitext-retail-banking-llm-chatbot-training-dataset"
REVISION = "3e3621092fc6baaf7f53ceb6f091c60ae99acb67"  # pinned so the golden set is reproducible
FILE = "bitext-retail-banking-llm-chatbot-training-dataset.csv"
URL = f"https://huggingface.co/datasets/{REPO}/resolve/{REVISION}/{FILE}"

SEED = 42
GOLDEN_PER_INTENT = 5   # 26 intents x 5 = 130 golden examples
REPLAY_PER_INTENT = 8   # 26 intents x 8 = 208 replay requests, disjoint from golden

OUT = Path(__file__).parent


def main() -> None:
    raw = urllib.request.urlopen(URL, timeout=120).read().decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(raw)))
    by_intent: dict[str, list[tuple[int, dict]]] = defaultdict(list)
    for i, row in enumerate(rows):
        by_intent[row["intent"]].append((i, row))

    rng = random.Random(SEED)
    golden, replay = [], []
    for intent in sorted(by_intent):
        picks = rng.sample(by_intent[intent], GOLDEN_PER_INTENT + REPLAY_PER_INTENT)
        for n, (i, row) in enumerate(picks):
            base = {"id": f"{intent}-{i}", "source_row": i, "intent": intent,
                    "category": row["category"], "input": row["instruction"].strip()}
            if n < GOLDEN_PER_INTENT:
                golden.append({**base, "reference": row["response"].strip()})
            else:
                replay.append(base)

    for name, items in (("golden.jsonl", golden), ("replay.jsonl", replay)):
        text = "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in items)
        (OUT / name).write_text(text, encoding="utf-8")
        print(f"{name}: {len(items)} rows, sha256={hashlib.sha256(text.encode()).hexdigest()[:12]}")


if __name__ == "__main__":
    main()
