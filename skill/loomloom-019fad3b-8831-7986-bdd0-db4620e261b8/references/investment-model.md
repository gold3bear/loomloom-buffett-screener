# Investment Model Contract (v4)

![v4 model map](../../docs/images/v4-model-map.png)

The Skill can attach a deterministic **three-statement projection + DCF** to every
row. The model is not a second opinion from a language model: it is Python code
that runs in a LoomLoom Code node and, independently, on the local machine. The
local audit recomputes the same numbers and compares them with the cloud output.

**Boundary.** A model value is conditional arithmetic on explicitly supplied
assumptions. It is not a target price, a return forecast, a position size, or a
buy/sell instruction. If a driver is missing, the model refuses to run. There are
no automatic discount rates, growth rates, or terminal multiples.

## Cloud preflight gate (`stp_preflight`)

Before any paid review runs, a Code node validates the input contract:

| Output | Type | Meaning |
|---|---|---|
| `ready` | boolean | false when any error-severity finding exists |
| `findings` | array | `[{code, severity, path, message}]` |
| `summary` | object | ticker, asOf, checks, errors, warnings, ready |

It checks packet shape, ticker/company/fiscal period, data and price freshness,
HTTPS sources, units/currency, PE-null explanation, market-cap reconciliation
(`price * shares ≈ marketCapUsd`, ±2%), three-year history lengths, opening
balance-sheet fields and balance, qualitative groups, `sourceTier` S/A/B/C, and
every DCF driver / range / terminal assumption.

`asOf` is an optional template input. When blank, it falls back to
`modelAssumptions.asOf`, then the run date.

The five downstream steps declare:

```json
"dependsOn": ["stp_preflight"],
"when": {"stepId": "stp_preflight", "portId": "ready", "equals": true}
```

A failed gate records the five steps as skipped, without creating Attempts or
incurring model fees. It does not replace the local preflight or the local audit;
it is a fail-fast copy of the contract.

## Where it runs

| Location | Entry point | Purpose |
|---|---|---|
| LoomLoom Code node (`python-pure@1`, CPython 3.12, stdlib only) | `main(inputs)` in `model/valuation_model.py`, injected into the v4 template | Produces the model JSON value and the xlsx artifact during a paid run |
| Local audit | `node scripts/run-model.mjs` -> `python3 model/valuation_model.py` | Produces the reference model the merge step trusts and compares against |
| Template sync | `node scripts/sync-model-code.mjs` | Ensures the template embeds exactly the reviewed engine source |

The Code node has no network access, cannot install packages, and cannot read
platform secrets. The xlsx writer uses only `zipfile` and XML generation from the
standard library.

## Required input packet fields

The existing three packets are unchanged. Modeling needs a few additional
`financialPacket` fields:

```json
{
  "balanceSheet": {
    "cash": 30000,
    "currentAssets": 145000,
    "currentLiabilities": 80000,
    "shortTermDebt": 10000,
    "netPPE": 95000,
    "otherAssets": 5000,
    "totalDebt": 100000,
    "otherLiabilities": 15000,
    "equity": 60000,
    "sharesOutstanding": 14800
  }
}
```

Field rules:

- Required: `equity`, `sharesOutstanding`, and either `netWorkingCapital` or
  (`currentAssets` and `currentLiabilities`), and either `netPPE` or `totalAssets`.
- `cash` and `totalDebt` default to 0 with an explicit warning when absent. A
  missing debt figure is never silently treated as fact.
- `otherAssets` and `otherLiabilities` default to 0. Supply them when the opening
  balance sheet otherwise does not reconcile.
- The opening balance sheet must balance to within 0.01% of total assets (minimum 1 unit). If it does
  not, the model returns `OPENING_BALANCE_SHEET_DOES_NOT_BALANCE` and no valuation.
- `annualHistory.revenue[-1]` is the projection base. `startingRevenue` in a
  scenario overrides it, with a warning when the override differs by more than 5%.

## Assumptions schema (`modelAssumptions`)

`modelAssumptions` is a JSON string template input (and a local file for the
runner). Minimum shape:

```json
{
  "schemaVersion": "loomloom-model-assumptions/v1",
  "asOf": "2026-09-01",
  "currency": "USD",
  "units": "USD millions",
  "baseScenario": "base",
  "scenarios": {
    "base": {
      "label": "Base",
      "years": 5,
      "revenueGrowth": [0.04, 0.04, 0.04, 0.035, 0.035],
      "ebitMargin": [0.32, 0.32, 0.32, 0.32, 0.32],
      "taxRate": 0.21,
      "daPctRevenue": 0.03,
      "capexPctRevenue": 0.035,
      "nwcPctRevenue": 0.10,
      "interestRateOnDebt": 0.04,
      "debtRepaymentPct": 0.05,
      "dividendPayoutRatio": 0.15,
      "buybackPctOfNetIncome": 0.5,
      "wacc": 0.085,
      "terminalMethod": "perpetuity",
      "terminalGrowth": 0.025
    }
  },
  "sources": [
    {
      "field": "scenarios.base.wacc",
      "value": "0.085",
      "source": "user-supplied assumption",
      "date": "2026-09-01"
    }
  ],
  "unknowns": []
}
```

### Driver table

| Field | Required | Range / values | Meaning |
|---|---|---|---|
| `years` | yes | integer 1-10 | Explicit forecast years |
| `revenueGrowth` | yes | number or array of `years` numbers | Year-over-year revenue growth |
| `ebitMargin` | yes | number or array of `years` numbers | EBIT / revenue |
| `taxRate` | yes | 0-0.6 | Cash tax rate on positive pre-tax income |
| `daPctRevenue` | yes | 0-1 | D&A / revenue |
| `capexPctRevenue` | yes | 0-2 | Capex / revenue |
| `nwcPctRevenue` | yes | -1 to 2 | Net working capital / revenue at each year end |
| `interestRateOnDebt` | yes | 0-0.5 | Interest on opening debt |
| `debtRepaymentPct` | yes | 0-1 | Share of opening debt repaid each year |
| `dividendPayoutRatio` | no (0) | 0-1 | Dividends / positive net income |
| `buybackPctOfNetIncome` | no (0) | 0-1 | Buybacks / positive net income |
| `wacc` | yes | 0.005-0.5 | Discount rate |
| `terminalMethod` | yes | `perpetuity` / `exitMultiple` | Terminal value method |
| `terminalGrowth` | when perpetuity | -0.5 to 0.25, and `wacc > g + 0.005` | Perpetuity growth |
| `exitMultiple` | when exit multiple | > 0 | EV / EBIT or EV / EBITDA |
| `exitMultipleBasis` | no (`ebit`) | `ebit` / `ebitda` | Multiple basis |
| `startingRevenue` | no | > 0 | Override the last historical revenue |
| `baseScenario` | no (`base`) | scenario name | Scenario used for the headline value |
| `sources[]` | no (warning) | array | Owner/date of each driver |

Scenario names are free-form. `bear` / `base` / `bull` is the recommended set.

## Model mechanics

Let `t = 1..N`, and all values be in the packet's declared units.

```
Revenue_t      = Revenue_(t-1) * (1 + growth_t)
EBIT_t         = Revenue_t * margin_t
D&A_t          = Revenue_t * daPct
Capex_t        = Revenue_t * capexPct
NWC_t          = Revenue_t * nwcPct
ΔNWC_t         = NWC_t - NWC_(t-1)
Interest_t     = Debt_(t-1) * interestRate
EBT_t          = EBIT_t - Interest_t
Tax_t          = max(0, EBT_t) * taxRate
NetIncome_t    = EBT_t - Tax_t
Dividends_t    = max(0, NetIncome_t) * payout
Buybacks_t     = max(0, NetIncome_t) * buybackPct
DebtRepay_t    = min(Debt_(t-1), Debt_(t-1) * repaymentPct)

CFO_t          = NetIncome_t + D&A_t - ΔNWC_t
CFI_t          = -Capex_t
CFF_t          = -DebtRepay_t - Dividends_t - Buybacks_t
Cash_t         = Cash_(t-1) + CFO_t + CFI_t + CFF_t
NetPPE_t       = NetPPE_(t-1) + Capex_t - D&A_t
Debt_t         = Debt_(t-1) - DebtRepay_t
Equity_t       = Equity_(t-1) + NetIncome_t - Dividends_t - Buybacks_t

FCFF_t         = EBIT_t * (1 - taxRate) + D&A_t - Capex_t - ΔNWC_t
DiscountFactor = 1 / (1 + WACC)^t
```

The balance sheet identity holds by construction:

```
Cash + NWC + NetPPE + OtherAssets = Debt + OtherLiabilities + Equity
```

Terminal value:

- `perpetuity`: `FCFF_N * (1 + g) / (WACC - g)`, discounted at `N`.
- `exitMultiple`: `EBIT_N * multiple` (or `(EBIT_N + D&A_N) * multiple` for
  `ebitda`), discounted at `N`.

Valuation bridge:

```
EV            = Σ PV(FCFF_t) + PV(TerminalValue)
NetDebt       = Debt_N - Cash_N
EquityValue   = EV - NetDebt
ValuePerShare = EquityValue / SharesOutstanding
MOS           = (ValuePerShare - Price) / ValuePerShare
```

`MOS` is reported as a fraction; the report renders it as a percentage.

### Reverse DCF

The engine solves, by bisection, for a uniform shift to every explicit-year
revenue growth rate that makes `ValuePerShare` equal the current price. All other
drivers stay fixed. The result is `impliedAverageRevenueGrowth` — the growth the
current price implies under this model, not a forecast.

### Sensitivity

A 5x5 grid: WACC offsets of ±2% and ±1%, crossed with terminal growth offsets of
±1.0% and ±0.5% (or exit-multiple offsets of ±1x and ±2x). Invalid combinations
(WACC at or below terminal growth) are `null`.

## Integrity checks

Every scenario reports these checks; `error`-severity failures make
`model_ready=false`.

| Check | Severity | What it proves |
|---|---|---|
| `balanceSheetBalances` | error | Assets equal liabilities + equity every year |
| `cashFlowReconciles` | error | Ending cash equals opening cash plus the sum of net cash change |
| `equityRollsForward` | error | Ending equity equals opening equity plus net income less distributions |
| `fcffRecomputes` | error | FCFF equals NOPAT + D&A - capex - change in NWC |
| `dcfComponentsReconcile` | error | EV equals displayed PV(FCFF) plus PV(terminal) |
| `waccExceedsTerminalGrowth` | error | Perpetuity denominator is positive |
| `terminalValueNotDominant` | warning | Terminal value is at most 85% of EV |

Warnings include `NWC_DRIVER_MISMATCH` (opening NWC inconsistent with
`nwcPctRevenue`), `NEGATIVE_CASH`, `NEGATIVE_EQUITY`, `TERMINAL_VALUE_DOMINANT`,
`STARTING_REVENUE_OVERRIDE`, `CASH_DEFAULTED`, `DEBT_DEFAULTED`, and
`ASSUMPTIONS_WITHOUT_SOURCES`.

### Model-level invariants

The model also proves two cross-grid properties and reports two monotonicity
symptoms:

| Check | Severity | What it proves |
|---|---|---|
| `sensitivityCenterMatchesBase` | error | The center of the sensitivity grid equals the base-scenario value per share |
| `reverseDcfReproducesPrice` | error | Re-running the model at the solved implied growth reproduces the current price within 1% |
| `sensitivityWaccMonotonic` | warning | Value per share does not increase as WACC increases |
| `sensitivityTerminalMonotonic` | warning | Value per share does not decrease as terminal growth or exit multiple increases |

The first two are arithmetic invariants: a failure means the engine is
inconsistent, so `model_ready` becomes false. The last two are symptoms, not hard
failures: negative cash flows or unusual terminal assumptions can legitimately
break monotonicity.

## Output schema (`loomloom-investment-model/v1`)

Top-level keys:

```text
schemaVersion, engineVersion, ticker, companyName, asOf,
price, priceAsOf, currency, units, model_ready, baseScenario,
missingInputs[], errors[], warnings[], limitations[],
history[], openingBalanceSheet, assumptions,
scenarios{name: {label, rows[], summary, checks[], warnings[], integrity}},
sensitivity{waccOffsets[], axisLabel, axisOffsets[], valuesPerShare[][], price, checks[]},
reverseDcf{solved, method, growthDelta, impliedRevenueGrowth[], impliedAverageRevenueGrowth, impliedValuePerShare, checks[]},
modelChecks[]
```

Each scenario row carries the full projection: revenue, EBIT, D&A, capex, NWC,
interest, tax, net income, debt, equity, cash, PP&E, total assets, liabilities and
equity, balance check, CFO/CFI/CFF, net cash change, FCFF, discount factor, and PV.

`summary` carries `enterpriseValue`, `pvExplicit`, `terminalValue`, `pvTerminal`,
`terminalPctOfEv`, `netDebt`, `equityValue`, `valuePerShare`, `price`,
`marginOfSafetyPct`, `upsidePct`, `priceToModelValue`, `minCash`, and `minEquity`.

## Workbook artifact

The Code node emits `model.xlsx` (MIME
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) with:

| Sheet | Contents |
|---|---|
| `Cover` | Ticker, price, as-of, model status, errors, warnings, limitations |
| `Assumptions` | Driver table for every scenario, plus the assumption source list |
| `Historical` | Revenue, net income, and FCF for the supplied fiscal years |
| `P&L <scenario>` | Revenue through net income with a formula-description column |
| `BS <scenario>` | Cash through the balance check |
| `CF <scenario>` | CFO, CFI, CFF, and ending cash |
| `DCF <scenario>` | FCFF, discount factor, PV, terminal bridge, per-share value, MOS |
| `Sensitivity` | 5x5 value-per-share grid for the base scenario |
| `Checks` | Every integrity check with pass/fail and detail |

The workbook stores audited values, not live Excel formulas. It is a presentation
of the JSON the audit verifies; changing a cell does not change the model. To test
different assumptions, rerun the engine with a new assumptions file.

## Local audit integration

`merge-public-results.mjs` accepts:

- `--models <file>`: a model object, an array, `{models:[...]}`, or `{TICKER: model}`.
- `--require-model`: veto rows with no model.
- Cloud output is discovered by scanning row artifacts and values for an object
  with `schemaVersion: "loomloom-investment-model/v1"`.

Audit results:

| Status | Meaning |
|---|---|
| `not_run` | No cloud and no local model |
| `cloud_model_missing` | Local model only; cloud output not found |
| `local_reference_missing` | Cloud model only; not independently verified |
| `matched` | Every scenario summary and the sensitivity grid agree within 1e-4 relative |
| `mismatch` | A number disagrees; adds the `model_recompute_mismatch` veto |

Model-related vetos:

- `model_required_but_missing` — `--require-model` and no local model.
- `model_not_ready` — `--require-model` and the model has blocking errors.
- `model_recompute_mismatch` — cloud and local numbers disagree.
- `model_contradicts_valuation_verdict` — base MOS below -50% while the valuation
  dimension claims `eligible_for_manual_deep_research`.

The model does **not** override the four-dimension scores. It adds an independent,
reproducible valuation anchor and a contradiction check.

## One-command gate

`scripts/check-invariants.mjs` runs the packet, model, workbook, and audit checks
in one pass and exits non-zero on any error-severity failure:

```bash
node scripts/check-invariants.mjs \
  --packets packets.json --assumptions assumptions.json \
  --model model.json --xlsx model.xlsx --require-model \
  --output invariants.json --pretty
```

It does not replace the engine's own checks; it proves that the documents agree
with each other (ticker, price, as-of, currency, shares), that the model's
invariants pass, that the workbook contains the expected parts, and that the
audit has no model mismatch.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `MODEL_DRIVER_MISSING` | A required driver is absent | Supply it; never add a default |
| `OPENING_BALANCE_SHEET_DOES_NOT_BALANCE` | Partial balance sheet | Add `otherAssets` / `otherLiabilities` or correct the inputs |
| `MODEL_WACC_NOT_ABOVE_TERMINAL` | `wacc <= g + 0.5%` | Use a defensible discount rate or lower terminal growth |
| `NWC_DRIVER_MISMATCH` | `nwcPctRevenue` inconsistent with opening NWC | Set NWC% from historical NWC / revenue |
| `NEGATIVE_CASH` | Growth funded by negative cash | Add funding assumptions or lower growth; the model does not assume financing |
| `TERMINAL_VALUE_DOMINANT` | Terminal value > 85% of EV | Shorten/lengthen the explicit period or question the terminal assumption |
| Cloud artifact missing | Code node not admitted on the server | Run the local engine and use `--models`; check the server's Code delivery record |
