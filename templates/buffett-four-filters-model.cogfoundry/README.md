# Buffett Four-Filters + Investment Model — TemplateSpec v4

This directory holds the **cloud-side** half of the v4 Skill. It pairs with the
local Skill at `../../skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/`.

## What this template does

For each row (one US equity), it runs a **preflight gate**, **four parallel LLM
reviews**, and **one deterministic model Code node**:

| Step ID | Type | Purpose | Local dimension |
|---|---|---|---|
| `stp_preflight` | `codeProfile` (`python-pure@1`) | Packet / freshness / sources / units / market cap / BS / tier / driver gate | preflight |
| `stp_business` | capability profile | Business model & circle of competence | `business` |
| `stp_management` | capability profile | Moat + management / capital allocation | `moat` |
| `stp_financial` | capability profile | Financial quality supplement | `financial` |
| `stp_valuation` | capability profile | Valuation with margin of safety | `valuation` |
| `stp_model01` | `codeProfile` (`python-pure@1`) | Three-statement model + DCF + reverse DCF + sensitivity + xlsx | model audit |

The five downstream steps declare `dependsOn: ["stp_preflight"]` and
`when: {stepId: "stp_preflight", portId: "ready", equals: true}`. If the gate
returns `ready=false`, they are skipped without creating Attempts or incurring
model fees.

The model step is independent of the LLM steps, so it runs in parallel (after the
gate) and cannot be influenced by LLM prose. It reads two template inputs:

- `tickerPacket` — the three packets, including `financialPacket.balanceSheet`
  and `marketSnapshot.marketCapUsd`.
- `modelAssumptions` — explicit DCF drivers per scenario.
- `asOf` — optional freshness reference; blank falls back to
  `modelAssumptions.asOf`, then the run date.

It emits two outputs:

- `model` — a `loomloom-investment-model/v1` object.
- `workbook` — an xlsx artifact with Cover, Assumptions, Historical, P&L/BS/CF/DCF
  per scenario, Sensitivity, and Checks sheets.

## File shape

`template.json` is a bare canonical v2 spec:

```json
{
  "meta": {},
  "templateInputs": {},
  "steps": [],
  "workbook": {}
}
```

`loomloom template-spec check` and `create` take this file and wrap it in the
version-save envelope (`specVersion` + `canonicalSpecV2`) themselves. Do not add
the envelope to the file: the server rejects `specVersion` as an unknown field
inside the canonical spec. The spec uses lowerCamel field names throughout
(`templateInputs`, `stepId`, `executionBinding`, `inputBindings`, `sampleRows`, …).

## Code source is injected, not hand-edited

Each Cloud Code node limits `code.source` to **65,536 bytes**. Two sources are
injected by `sync-model-code.mjs`:

| Step | Source |
|---|---|
| `stp_preflight` | `model/preflight_code.py` (~21 KB, stdlib only) |
| `stp_model01` | `model/valuation_model.cloud.py` (compact copy, ~63.3 KB) |

The model's readable source of truth remains:

```
model/valuation_model.py          readable source of truth (local runner)
model/minify_code.py              AST-based compactor + --check
model/valuation_model.cloud.py    compact cloud copy (~63.3 KB, checked in)
```

Regenerate the compact copy, then inject both:

```bash
python3.12 ../../skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/model/minify_code.py
node ../../skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/scripts/sync-model-code.mjs
```

Check for drift (CI-friendly, exits `1` on drift or size overflow):

```bash
python3.12 ../../skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/model/minify_code.py --check
node ../../skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/scripts/sync-model-code.mjs --check
```

`minify_code.py` requires CPython 3.12+ because `ast.unparse` formatting is
version-specific. `model/test_minify.py` asserts that the compact copy compiles, fits the limit,
and produces byte-identical model JSON to the full engine. The readable file
remains the single source of truth; the compact copy is a reviewed artifact.

## Inputs

### `tickerPacket` (required, string)

The three packets concatenated as one JSON object. Modeling additionally needs
`financialPacket.balanceSheet`:

```json
{
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
```

### `modelAssumptions` (required, string)

JSON with at least one scenario. Required drivers per scenario: `years`,
`revenueGrowth`, `ebitMargin`, `taxRate`, `daPctRevenue`, `capexPctRevenue`,
`nwcPctRevenue`, `interestRateOnDebt`, `debtRepaymentPct`, `wacc`,
`terminalMethod`, plus `terminalGrowth` (perpetuity) or `exitMultiple`.
`dividendPayoutRatio` and `buybackPctOfNetIncome` default to 0. See
[investment-model.md](../../skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/references/investment-model.md).

### `modelChoice` (optional, string)

Existing model override for the four LLM steps. It does not affect the Code node.

## Validate and run

```bash
export LOOMLOOM_TOKEN_SHENGSUANYUN_TEST='<test key>'
bash ../../skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/scripts/dev/test-env.sh check ./template.json
bash ../../skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/scripts/dev/test-env.sh create ./template.json
```

The target server must have the Code runtime delivered and enabled. Code pricing
is not configured in the controlled test environment; `precheck` may return
`CODE_PRICING_PENDING`, which does **not** mean free execution.

If `check` returns `invalid canonical_spec_v2 ... unknown field "code"`, the
target server's validation schema does not include Code yet. That is an
environment delivery issue, not a spec error: use the v3 template or the local
model path until the Code-enabled environment is available. A server that is
Code-enabled accepts this spec as written (the field shape matches the official
`code-value-artifact.json` example).

## Differences from v3

| v3 | v4 |
|---|---|
| Four LLM steps | Four LLM steps + one Code step |
| Packets only | Packets + explicit `modelAssumptions` |
| Text output | Text + model JSON + xlsx artifact |
| Valuation anchored by LLM + optional 10-K P/E range | Deterministic DCF anchor plus the LLM review |
| Local audit: evidence + 9 vetos | Adds model recomputation and four model vetos |

The v3 directory remains valid for runs that do not need modeling.

## Boundaries

- The model never overrides the four-dimension scores; it adds an independent
  anchor and a contradiction check.
- A model value is conditional arithmetic, not a target price.
- Missing drivers block the model. No automatic WACC, growth, or multiple.
- Cloud and local outputs must agree within 1e-4 relative, or the local audit
  vetoes the row.
- The workbook is values-only by design; rerun the engine to test new assumptions.
