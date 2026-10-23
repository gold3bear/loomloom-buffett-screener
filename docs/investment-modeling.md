# Investment Modeling — Setup and Runbook (v4)

Run the commands below from the installed Skill directory
(`skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/`), unless a step says
otherwise.

![LoomLoom native template flow](images/v4-loomloom-flow.png)

![v4 pipeline](images/v4-pipeline.png)

*The pipeline view focuses on the data path and omits the preflight gate; the native flow above is the step-exact view.*

![v4 model map](images/v4-model-map.png)

This guide covers the deterministic three-statement + DCF capability:

- what the model computes,
- how to supply assumptions,
- how to run it locally,
- how to exercise the Code node against the LoomLoom test environment,
- how to audit the cloud output and read the report.

The model is a research aid. It does not produce target prices, position sizes,
or buy/sell instructions. A model value is conditional arithmetic on the
assumptions you supply.

---

## 1. What you get

Per ticker:

| Output | Description |
|---|---|
| `model.json` | Full projection, scenario summaries, reverse DCF, sensitivity grid, warnings, checks |
| `model.xlsx` | Nine-sheet workbook: Cover, Assumptions, Historical, P&L/BS/CF/DCF per scenario, Sensitivity, Checks |
| Report section | Base value per share, price, margin of safety, terminal-value share, scenario range, audit status |
| Audit status | `matched` / `mismatch` between the cloud Code node and the local recomputation |

Model highlights:

- Integrated three statements with a balance-sheet identity that holds by construction.
- Bear / base / bull scenarios.
- Perpetuity growth or exit-multiple terminal value.
- Reverse DCF: what average explicit-period growth the current price implies.
- 5×5 WACC × terminal sensitivity grid.
- Six error-severity integrity checks plus warnings.

---

## 2. Prerequisites

- Node.js 18+ (the Skill scripts use ESM and `node:test`).
- Python 3.9+ (the engine uses only the standard library; tested on 3.9 and 3.12).
- LoomLoom CLI **0.6.2-beta.1 or newer** for Code-node authoring/execution.
  Older CLIs do not ship the Code/Loop manual and cannot check `codeProfile` steps.

```bash
node --version
python3 --version
loomloom --version
```

If the installed CLI is older:

```bash
npm install -g @cogfoundry/loomloom@0.6.2-beta.1
loomloom --version
```

---

## 3. Test environment

The test server is not the production Market. It is for controlled Code/Loop
review and does not qualify production availability or formal charging.

```bash
export LOOMLOOM_TOKEN_SHENGSUANYUN_TEST='<your test-environment API key>'

loomloom doctor --name shengsuanyun-test \
  --server https://loomloom-test.shengsuanyun.com/loom/v1 \
  --token "$LOOMLOOM_TOKEN_SHENGSUANYUN_TEST"
```

A helper script wraps the same settings:

```bash
export LOOMLOOM_TOKEN_SHENGSUANYUN_TEST='<your test key>'
bash scripts/dev/test-env.sh doctor
bash scripts/dev/test-env.sh check ../../templates/buffett-four-filters-model.cogfoundry/template.json
```

`scripts/dev/test-env.sh` reads:

| Variable | Default |
|---|---|
| `LOOMLOOM_TOKEN_SHENGSUANYUN_TEST` | required |
| `LOOMLOOM_TEST_SERVER` | `https://loomloom-test.shengsuanyun.com/loom/v1` |
| `LOOMLOOM_TEST_PROFILE` | `shengsuanyun-test` |
| `LOOMLOOM_CLI` | `loomloom` |

Never commit the key. The script exports `LOOMLOOM_TOKEN` and `LOOMLOOM_SERVER`
for the child process instead of passing the token in argv, so it does not appear
in process listings. Keep shell history and CI logs free of it as well.

---

## 4. Prepare the packet and assumptions

### 4.1 Packet additions

Add `marketSnapshot.marketCapUsd` (same units as the packet), `sourceTier` on each
qualitative fact (S/A/B/C), and an opening balance sheet to `financialPacket`:

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

Required: equity, shares, working capital (or current assets/liabilities), and
net PP&E (or total assets). The opening balance sheet must reconcile within 0.01% of
total assets (minimum 1 unit).

### 4.2 Assumptions

Create `assumptions.json`:

```json
{
  "schemaVersion": "loomloom-model-assumptions/v1",
  "asOf": "2026-09-01",
  "currency": "USD",
  "units": "USD millions",
  "baseScenario": "base",
  "scenarios": {
    "bear": {
      "label": "Bear", "years": 5,
      "revenueGrowth": [0.01, 0.01, 0.01, 0.01, 0.01],
      "ebitMargin": [0.28, 0.27, 0.26, 0.25, 0.24],
      "taxRate": 0.21, "daPctRevenue": 0.03, "capexPctRevenue": 0.04,
      "nwcPctRevenue": 0.10, "interestRateOnDebt": 0.045, "debtRepaymentPct": 0.05,
      "dividendPayoutRatio": 0.15, "buybackPctOfNetIncome": 0.5,
      "wacc": 0.10, "terminalMethod": "perpetuity", "terminalGrowth": 0.015
    },
    "base": {
      "label": "Base", "years": 5,
      "revenueGrowth": [0.04, 0.04, 0.04, 0.035, 0.035],
      "ebitMargin": [0.32, 0.32, 0.32, 0.32, 0.32],
      "taxRate": 0.21, "daPctRevenue": 0.03, "capexPctRevenue": 0.035,
      "nwcPctRevenue": 0.10, "interestRateOnDebt": 0.04, "debtRepaymentPct": 0.05,
      "dividendPayoutRatio": 0.15, "buybackPctOfNetIncome": 0.5,
      "wacc": 0.085, "terminalMethod": "perpetuity", "terminalGrowth": 0.025
    },
    "bull": {
      "label": "Bull", "years": 5,
      "revenueGrowth": [0.07, 0.07, 0.06, 0.06, 0.05],
      "ebitMargin": [0.34, 0.35, 0.35, 0.36, 0.36],
      "taxRate": 0.21, "daPctRevenue": 0.03, "capexPctRevenue": 0.03,
      "nwcPctRevenue": 0.10, "interestRateOnDebt": 0.04, "debtRepaymentPct": 0.05,
      "dividendPayoutRatio": 0.15, "buybackPctOfNetIncome": 0.5,
      "wacc": 0.075, "terminalMethod": "perpetuity", "terminalGrowth": 0.03
    }
  },
  "sources": [
    {"field": "scenarios.base.wacc", "value": "0.085", "source": "user-supplied assumption", "date": "2026-09-01"}
  ],
  "unknowns": []
}
```

No defaults are applied. If a required driver is absent, the model reports
`MISSING_ASSUMPTION` and `model_ready=false`.

### 4.3 Optional as-of date

The v4 template accepts an optional `asOf` string (`YYYY-MM-DD`) as the freshness
reference for the 7-day price and 45-day identity checks. Blank falls back to
`modelAssumptions.asOf`, then the run date.

---

## 5. Preflight

```bash
node scripts/preflight.mjs \
  --input financial-packets.json \
  --assumptions assumptions.json \
  --require-model \
  --output preflight.json --pretty
```

Exit `0` means the packet and assumptions are model-ready. Exit `1` lists the
blocking issues. `--require-model` is what turns a missing assumptions file into
an error; without it, modeling is optional and missing assumptions are a warning.

The same contract is enforced in the cloud by `stp_preflight`. It returns
`ready=false` plus findings; the five downstream steps are skipped. The local
preflight is the offline reference, the cloud gate is the fail-fast copy.

For a batch, `--assumptions` may be a single object shared by every row, or a map
keyed by ticker: `{"AAPL": {...}, "COST": {...}}`. The local runner handles one
ticker per invocation; loop over the rows in the batch.

---

## 6. Local reference run

```bash
node scripts/run-model.mjs \
  --packets financial-packets.json \
  --assumptions assumptions.json \
  --out model.json --xlsx model.xlsx
```

Choose the interpreter explicitly if needed:

```bash
PYTHON=/path/to/python3 node scripts/run-model.mjs ...
```

Exit `0` = model ready; exit `2` = model not ready (files are still written so you
can inspect the errors). The engine refuses to invent drivers.

Run the cross-document invariant gate:

```bash
node scripts/check-invariants.mjs \
  --packets financial-packets.json --assumptions assumptions.json \
  --model model.json --xlsx model.xlsx --require-model \
  --output invariants.json --pretty
```

It checks, in one pass:

- packet preflight (freshness, sources, units, model inputs);
- model vs packet identity (ticker, price, price timestamp, as-of, currency, shares);
- `model_ready` and every error-severity scenario/model invariant;
- sensitivity shape and center;
- reverse-DCF reproduction;
- workbook zip parts and sheet count;
- optional audit: no model mismatches and every accepted row is modeled.

Exit `0` = pass, `1` = at least one error-severity invariant failed, `2` = parameter/system error.

Verify the template embeds the reviewed engine:

```bash
node scripts/sync-model-code.mjs --check
```

If it reports drift, run without `--check` and create a new template version.

---

## 7. Cloud Code node (test environment)

### 7.1 Check the spec

```bash
LOOMLOOM_SERVER='https://loomloom-test.shengsuanyun.com/loom/v1'
LOOMLOOM_TOKEN="$LOOMLOOM_TOKEN_SHENGSUANYUN_TEST"

loomloom --server "$LOOMLOOM_SERVER" --token "$LOOMLOOM_TOKEN" \
  template-spec check ../../templates/buffett-four-filters-model.cogfoundry/template.json
```

The file is a bare canonical v2 spec:

```json
{ "meta": {}, "templateInputs": {}, "steps": [], "workbook": {} }
```

`check` and `create` wrap it in the version-save envelope themselves. Adding
`specVersion` to the file makes the server reject it as an unknown field inside
`canonical_spec_v2`.

The preflight gate and model step are:

```json
{
  "stepId": "stp_preflight",
  "displayName": "Input preflight gate (deterministic code)",
  "executionBinding": {"kind": "codeProfile"},
  "code": {
    "language": "python",
    "entrypoint": "main",
    "source": "<model/preflight_code.py>",
    "inputs": {
      "tickerPacket": {"kind": "value", "valueType": "string", "required": true, "nullable": false},
      "assumptions": {"kind": "value", "valueType": "string", "required": true, "nullable": false},
      "asOf": {"kind": "value", "valueType": "string", "required": true, "nullable": false}
    },
    "outputs": {
      "ready": {"kind": "value", "valueType": "boolean", "schema": {"type": "boolean"}},
      "findings": {"kind": "value", "valueType": "array", "schema": {"type": "array"}},
      "summary": {"kind": "value", "valueType": "object", "schema": {"type": "object"}}
    }
  },
  "inputBindings": {
    "tickerPacket": {"source": "templateInput", "inputKey": "tickerPacket"},
    "assumptions": {"source": "templateInput", "inputKey": "modelAssumptions"},
    "asOf": {"source": "templateInput", "inputKey": "asOf", "fallbackValue": ""}
  }
}
```

```json
{
  "stepId": "stp_model01",
  "displayName": "Three-statement model + DCF (deterministic code)",
  "executionBinding": {"kind": "codeProfile"},
  "code": {
    "language": "python",
    "entrypoint": "main",
    "source": "<model/valuation_model.cloud.py>",
    "inputs": {
      "tickerPacket": {"kind": "value", "valueType": "string", "required": true, "nullable": false},
      "assumptions": {"kind": "value", "valueType": "string", "required": true, "nullable": false}
    },
    "outputs": {
      "model": {"kind": "value", "valueType": "object", "schema": {"type": "object"}},
      "workbook": {"kind": "artifact", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
    }
  },
  "inputBindings": {
    "tickerPacket": {"source": "templateInput", "inputKey": "tickerPacket"},
    "assumptions": {"source": "templateInput", "inputKey": "modelAssumptions"}
  }
}
```

Both steps omit `profileId` / `profileRevision`; Core defaults to `python-pure@1`.
Every step except `stp_preflight` declares `dependsOn: ["stp_preflight"]` and
`when: {stepId: "stp_preflight", portId: "ready", equals: true}`.

Core defaults both steps to `python-pure@1` (Python 3.12 standard library) and
freezes the binding at version creation.

The server enforces a **65,536-byte** limit on `code.source`. The file in
`steps[5].code.source` is therefore the compact copy
`model/valuation_model.cloud.py` (~63.3 KB), generated from the readable engine by
`model/minify_code.py` under CPython 3.12 (the `python-pure@1` runtime version). The readable engine remains the source of truth; the
compact copy is checked in and verified by tests.

### 7.2 Create a private template version

```bash
loomloom --server "$LOOMLOOM_SERVER" --token "$LOOMLOOM_TOKEN" \
  template-spec create ../../templates/buffett-four-filters-model.cogfoundry/template.json \
  --version-note "v4 three-statement DCF code node"
```

Record `templateId` and `versionId`.

> If `check` returns `unknown field "code"`, the target server has not enabled the
> Code schema yet. This is an environment delivery gate, not a spec typo. The
> same spec is accepted by a Code-enabled server. Until then, use the local model
> path (`run-model.mjs` + `--models`) or the v3 template.

### 7.3 Submit a run

Create `rows.jsonl`, one JSON object per line whose keys are template input keys:

```jsonl
{"tickerPacket":"{\"identityPacket\":{...},\"financialPacket\":{...},\"qualitativePacket\":{...}}","modelAssumptions":"{\"schemaVersion\":\"loomloom-model-assumptions/v1\",...}"}
```

```bash
loomloom --server "$LOOMLOOM_SERVER" --token "$LOOMLOOM_TOKEN" \
  orchestration-input upload rows.jsonl
# -> inputFileId

loomloom --server "$LOOMLOOM_SERVER" --token "$LOOMLOOM_TOKEN" \
  template-spec run <template-id> \
  --version-id <version-id> --input-file-id <input-file-id> \
  --client-request-id "$(uuidgen)"
```

Cost precheck for a template containing Code may return `CODE_PRICING_PENDING`.
That is not a zero price. Use a fresh request ID per execution; an ambiguous
network retry with the same version/input/request ID should return the original
run.

### 7.4 Watch and retrieve

```bash
loomloom --server "$LOOMLOOM_SERVER" --token "$LOOMLOOM_TOKEN" run watch <run-id>
loomloom --server "$LOOMLOOM_SERVER" --token "$LOOMLOOM_TOKEN" run result-rows <run-id> --output json > result-rows.json
loomloom artifact list <run-id>
loomloom artifact download <run-id> <artifact-id> --output model.xlsx
```

Text outputs are previewed; JSON preserves typed values, loop status, and step
errors. The workbook is an artifact, so download it separately if you need the
file.

---

## 8. Audit and report

```bash
node scripts/merge-public-results.mjs \
  --input result-rows.json --models model.json \
  --require-model --output audit.json --pretty

node scripts/render-report.mjs --input audit.json --output report.md
```

`--models` accepts a single model, an array, `{models:[...]}`, or
`{TICKER: model}`. The merge:

1. Finds the cloud model object by `schemaVersion` among row artifacts/values.
2. Compares every scenario summary and the sensitivity grid with the local model.
3. Adds `model_recompute_mismatch` if anything differs by more than 1e-4 relative.
4. Adds `model_required_but_missing`, `model_not_ready`, or
   `model_contradicts_valuation_verdict` where applicable.
5. Attaches `investment_model`, `model_verdict`, and `model_audit` to each row.

---

## 9. Reading the output

### Scenario summary

```text
Base: EV 1,887,640 | net debt 70,000 | equity 1,817,640 | value/share 122.81 | price 220.50 | MOS -79.5%
```

All figures are in the declared unit (normally USD millions), except per-share
values and the price.

### Margin of safety

`MOS = (valuePerShare - price) / valuePerShare`.

- `≥ 30%` → `margin_of_safety_present`
- `0–30%` → `at_or_near_model_value`
- `< 0` → `price_above_model_value`

These labels are descriptive. They are not recommendations.

### Reverse DCF

`impliedAverageRevenueGrowth` answers: "what uniform explicit-period growth does
the current price imply under these other assumptions?" A high number is a
statement about the price, not a forecast.

### Checks

Read `Checks` before the valuation:

- `balanceSheetBalances`, `cashFlowReconciles`, `equityRollsForward`,
  `fcffRecomputes`, `dcfComponentsReconcile`, `waccExceedsTerminalGrowth` are
  error-severity. Any failure makes the model not ready.
- `terminalValueNotDominant` is a warning. Above 85% of EV, the result is mostly a
  terminal assumption.
- `NWC_DRIVER_MISMATCH` means the opening NWC and `nwcPctRevenue` tell different
  stories; year 1 will show a large working-capital swing.

Model-level invariants are shown in the same `Checks` sheet with scenario
`model`:

- `sensitivityCenterMatchesBase` (error) — the 5x5 grid center equals the base value.
- `reverseDcfReproducesPrice` (error) — the solved implied growth reproduces the price within 1%.
- `sensitivityWaccMonotonic` / `sensitivityTerminalMonotonic` (warnings) — expected direction of the grid.

---

## 10. Failure modes and fixes

| Error / warning | Fix |
|---|---|
| `MISSING_ASSUMPTION` | Supply the driver. Do not add a default. |
| `OPENING_BALANCE_SHEET_DOES_NOT_BALANCE` | Add `otherAssets` / `otherLiabilities`, or correct the inputs. |
| `MODEL_WACC_NOT_ABOVE_TERMINAL` | Raise WACC or lower terminal growth; the perpetuity denominator must stay positive. |
| `NWC_DRIVER_MISMATCH` | Set `nwcPctRevenue` from historical NWC / revenue. |
| `NEGATIVE_CASH` | The model does not assume financing. Lower growth/capex or add explicit funding. |
| `TERMINAL_VALUE_DOMINANT` | Reconsider the explicit period or the terminal assumption. |
| `CODE_PRICING_PENDING` | Code pricing is not configured; this is not free execution. |
| Cloud artifact missing | Confirm the server has the Code runtime enabled; use the local model with `--models`. |

---

## 11. Security and boundaries

- The token is read from the environment and passed on the command line. Do not
  write it into templates, packets, logs, or reports.
- The Code node has no network access, no package installation, and no platform
  secrets.
- The workbook is values-only by design: it presents the audited JSON. Editing a
  cell does not change the model; rerun with new assumptions instead.
- A model value is not a target price. The report must show the assumptions, the
  price timestamp, the terminal-value share, and the integrity checks next to it.
- The model does not override the four-filter judgment. It adds an independent
  anchor and catches direct contradictions.

---

## 12. Production path vs controlled test

The v4 template and the public Listing are different surfaces:

| Surface | Input schema | Code node | Status |
|---|---|---|---|
| Public Listing `019fad3b-…` (v3) | Three packets | No | Live |
| Private v4 template | Three packets + `modelAssumptions` | Yes (`stp_model01`) | Controlled test review |
| Local runner | Packets + assumptions file | Python engine | Ready now |

Until a new Listing version exposes `modelAssumptions`, a Market run cannot pass
modeling assumptions to the Code node. The production-safe sequence is:

```bash
node scripts/run-model.mjs ... --out model.json --xlsx model.xlsx
node scripts/merge-public-results.mjs --input result-rows.json --models model.json ...
```

The merge reports `cloud_model_missing` for those rows and still attaches the
local model, its checks, and its margin of safety. `--require-model` still works:
it requires the local model, not a cloud artifact.

Publishing a new Listing version that includes the Code step is a separate
creator action. It needs:

1. a public input-schema update that adds `modelAssumptions`,
2. a price review (Code execution pricing is not configured in the test
   environment),
3. explicit user confirmation,
4. a new Listing version snapshot and a re-quote for every run.

The v4 template is the reviewed source for that future version; it is not a
published Listing.

---

## 13. Verified test run (2026-10-23)

A single-row NVDA run on the controlled test server completed end to end after
the equity-bridge fix:

| Item | Value |
|---|---|
| Server | `https://loomloom-test.shengsuanyun.com/loom/v1` |
| Template | `03cc5781-ddca-40e3-a9df-ccf1fe626447` |
| Version | `b1a5c31b-9b10-44dc-93c9-a4dca7b5ef60` (v3, opening-net-debt bridge) |
| Final run | `1aa64499-6e2e-404e-b36b-7027d128d614` |
| Estimated / actual cost | `0.0437328` / `0.0223041` CNY |
| Status | completed, 1/1 tasks |
| Cloud preflight | `ready=true`, 246 checks, 0 errors |
| Cloud model | `model_ready=true`, engine `1.1.0` |
| Base value / price / MOS | `136.639377` / `212.21` / `-55.31%` |
| Scenario values | Bear `61.938682` / Base `136.639377` / Bull `239.646285` |
| Model checks | 7/7 scenario integrity checks, 2/2 model invariants |
| Cloud vs local | `matched` |
| Invariant gate | 25/25 error checks passed |
| Workbook | 17 sheets, opened with openpyxl |
| Local audit | accepted, overall 80, decision `watchlist`, 31 verified evidence, 5 rejected |
| Narrative checks | 2 conflicts: FCF/NI `1.03x` vs packet `0.66x`; net cash vs net debt |

Prompt v4 adds an explicit allowlist: cite only existing leaf paths, never cite
`unknowns[i]` or the `unknowns` array, and never cite an object such as
`quarterlyMostRecent.ttm`. Validation showed this reduces but does not eliminate
bad citations: with an empty `unknowns` array the model still cited the whole
array once. The local audit now rejects that with
`source_ref must point to an atomic leaf, not an array`. Prompt hardening is a
mitigation; the local resolver remains the enforcement point.

The earlier AAPL run `96a6542c-...` and the archived AAPL values were produced
with the old `Debt_N - Cash_N` bridge. They are retained only as history and are
not comparable with v3 numbers. The corrected AAPL local value is `122.813487`
per share, not `137.681532`.

A second run, `9464a209-fe37-44fc-abd8-a001b8434119`, submitted two rows (one
valid, one deliberately broken: stale price, +5% market cap, C-tier moat fact).
The broken row returned `ready=false` with `STALE_PRICE`,
`MARKET_CAP_MISMATCH`, and `TIER_C_NOT_EVIDENCE`; it produced **0 artifacts** and
all five downstream steps were skipped. The two-row run cost `0.0178544 CNY`
against a `0.0661593 CNY` estimate.

The Code node returned both the model object and the xlsx artifact. The local
merge discovered the cloud model in `row.values` (`stepId=stp_model01`,
`portId=model`), attached the local recomputation, and confirmed zero numeric
mismatches.

The key used for this run is not stored in the repository. The CLI profile entry
does not persist the token; it is read from `LOOMLOOM_TOKEN_SHENGSUANYUN_TEST`.
