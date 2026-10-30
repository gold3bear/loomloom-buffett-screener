---
name: "loomloom-019fad3b-8831-7986-bdd0-db4620e261b8"
description: "Batch research long-term value of US equities. The local Agent collects a complete ticker packet and explicit model assumptions; the LoomLoom Market template runs a deterministic preflight, four research reviews, a three-statement + DCF model, a cloud evidence audit, a Markdown report and a 17-sheet workbook. Use for US stock screening, batch comparison, investment modeling, or re-runs after price or filing updates."
---

# US Equity Long-Term Value Batch Screening (v11)

Run one US equity per row through the LoomLoom Market template. The cloud does the
model, audit and report; local work is limited to data collection, assumptions and
optional independent verification. Research aid only — not investment advice. No
target prices, position sizes, or buy/sell instructions.

## Public Listing

```text
Listing: 019fad3b-8831-7986-bdd0-db4620e261b8
```

Always read the current Listing and public input schema before executing. Run only
through the Market path. Never reveal or package private prompts, step IDs, model
settings, template definitions, or internal mappings.

## Input Schema (4 fields)

| Field | Required | Meaning |
|---|---|---|
| `tickerPacket` | yes | One JSON string containing `identityPacket`, `financialPacket`, `qualitativePacket` |
| `modelAssumptions` | yes | JSON string with bear/base/bull DCF drivers |
| `modelChoice` | no | Eligible model override; blank uses the server default |
| `asOf` | no | `YYYY-MM-DD` freshness reference; blank uses `modelAssumptions.asOf`, then run date |

### tickerPacket

```json
{
  "identityPacket": {
    "ticker": "AAPL",
    "companyName": "Apple Inc.",
    "industry": "Technology Hardware",
    "dataAsOf": "2026-09-01",
    "fiscalPeriod": "FY2025",
    "sources": ["https://www.sec.gov/..."]
  },
  "financialPacket": {
    "units": "USD millions",
    "marketSnapshot": {
      "price": 220.5,
      "currency": "USD",
      "asOf": "2026-09-01T20:00:00Z",
      "pe": 28.4,
      "marketCapUsd": 3263400,
      "sharesOutstanding": 14800
    },
    "annualHistory": {
      "fiscalYearEnd": ["2023-09-30", "2024-09-28", "2025-09-27"],
      "revenue": [383285, 391035, 416161],
      "netIncome": [96995, 93736, 112010],
      "freeCashFlow": [99584, 108807, 98767]
    },
    "balanceSheet": {
      "cash": 30000,
      "currentAssets": 145000,
      "currentLiabilities": 80000,
      "shortTermDebt": 10000,
      "netPPE": 95000,
      "totalDebt": 100000,
      "otherAssets": 5000,
      "otherLiabilities": 15000,
      "equity": 60000,
      "sharesOutstanding": 14800
    },
    "unknowns": []
  },
  "qualitativePacket": {
    "businessModel": [
      {"fact": "Atomic fact", "source": "https://...", "date": "2026-09-01", "sourceType": "SEC 10-K", "sourceTier": "S"}
    ],
    "moatEvidence": [],
    "managementCulture": [],
    "capitalAllocation": [],
    "riskFactors": [],
    "contraryEvidence": [],
    "unknowns": []
  }
}
```

The full data contract is in [references/data-contract.md](references/data-contract.md).

## Model Assumptions

`modelAssumptions` is a JSON string with explicit bear/base/bull drivers:

- `years`
- `revenueGrowth[]`
- `ebitMargin[]`
- `taxRate`
- `daPctRevenue`
- `capexPctRevenue`
- `nwcPctRevenue`
- `interestRateOnDebt`
- `debtRepaymentPct`
- `dividendPayoutRatio`
- `buybackPctOfNetIncome`
- `wacc`
- `terminalMethod` / `terminalGrowth`
- optional `startingRevenue` inside each scenario

There are **no defaults**. Missing drivers block the model. Never invent a WACC,
growth rate, terminal multiple, or a "reasonable default" to make the model run.
See [references/investment-model.md](references/investment-model.md).

## Cloud Flow

```text
stp_preflight
  -> four reviews
  -> stp_model01        three statements + DCF + reverse DCF + sensitivity + xlsx
  -> stp_audit1         evidence + narrative + scores + model checks + workbook manifest
  -> stp_report         Markdown (always labels accepted or rejected)
```

The preflight gate returns `ready=false` with findings; downstream steps are
skipped. Fix the packet or assumptions and re-run; never bypass the gate.

The audit returns:

- `accepted` — data/evidence integrity, **not** investment attractiveness;
- `findings` — errors/warnings, including `EVIDENCE_QUARANTINED`;
- `audit` — decision, score, confidence, veto items, model summary, workbook summary.

`accepted=true` can still carry warnings. A rejected report must not be treated as
a clean result.

## Market Run

```bash
loomloom market quote 019fad3b-8831-7986-bdd0-db4620e261b8 \
  --input-file <market-request.json> --output json

loomloom market run 019fad3b-8831-7986-bdd0-db4620e261b8 \
  --input-file <market-request.json> --confirm \
  --client-request-id <id> --output json
```

Before a paid run:

1. show task count, currency and fee;
2. get explicit user confirmation;
3. if tickers/data/Listing/quote change, re-quote and re-confirm.

After the run:

```bash
loomloom run result-rows <run-id> --output json
loomloom artifact download <run-id> --output-dir <dir>
```

Expected artifacts: workbook + report. Values include `preflight`, `model`, `audit`.

## Verdict Handling

| Audit result | Meaning | Action |
|---|---|---|
| `accepted=true`, no veto | evidence/model passed | can enter research queue |
| `accepted=true` with warnings | passed with quarantine/model warnings | read findings before using |
| `accepted=false` | evidence or model failed | do not treat as conclusion |
| `veto_items` non-empty | hard risk/valuation veto | drop or manual deep research |

`accepted` is not a buy signal. A negative or non-positive model value is
conditional arithmetic, not a target price.

## Optional Local Verification

The local Skill still provides:

- `scripts/preflight.mjs` — independent preflight;
- `scripts/merge-public-results.mjs` — evidence audit and cross-row ranking;
- `scripts/check-invariants.mjs` — workbook cell-level checks;
- local model source is not shipped in the public package; use the cloud model.
- `references/decision-policy.md` — veto/scoring policy.

These are **optional**. The cloud model/audit/report no longer require them.

## Hard Rules

- Every fact needs source URL, date and source tier (S/A/B/C); C is not evidence.
- Every quotable fact must be an atomic field; references use full paths.
- Missing/mismatched/unverified data goes to `unknowns`, never guessed.
- `modelAssumptions` must be explicit and user-confirmed.
- Price judgment binds to `marketSnapshot.price` and `priceAsOf`; without a
  historical valuation range or normalized owner earnings, never claim sufficient
  margin of safety.
- Never write the LoomLoom token into the Skill, data files, logs or reports.

Research aid only. Not investment advice.
