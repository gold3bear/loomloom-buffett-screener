# US Value Screen — Cloud Ranking

Deterministic cross-row ranking for v9 audit rows. **No LLM, no network.**

## What it does

Input a JSON array of compact audit rows:

```json
[
  {
    "ticker": "AAPL",
    "score": 86,
    "decision": "watchlist",
    "price": 220.5,
    "modelValue": 122.81,
    "mos": -0.7954,
    "evidenceVerified": 35,
    "evidenceRejected": 3,
    "veto": [],
    "findings": []
  }
]
```

Output:

- `ranking` — normalized rows, rank, summary;
- `report` — Markdown artifact `ranking.md`.

## Ranking rule

1. score descending;
2. MOS descending (null last);
3. verified evidence descending;
4. ticker ascending.

Invalid rows are excluded and counted in `summary.invalidRows`. Vetoed rows remain in the ranking and are marked; rank is not a buy list.

## Template

- step: `stp_rank01` (`codeProfile`, `python-pure@1`)
- inputs: `rankRows` string, `topN` integer
- outputs: `ranking` object, `report` text/markdown
- no LLM calls, no network, no API key

## Verified run

- template: `5c639cf5-232e-4a04-9145-251e61ce595d`
- version: `bcb3bf36-a8b5-4759-9f55-796ef3860708` (v1)
- run: `fd023094-64a7-4094-9058-b0a59d4c184d`
- result: 3 valid rows, top 2, AAPL/NVDA ranked, ORCL vetoed and retained
- cost: Code-only, 0 CNY
