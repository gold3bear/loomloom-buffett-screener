# v4 Release Notes (Release Candidate)

## Highlights

- **Preflight gate**: a deterministic Code node validates the packet, assumptions,
  freshness, HTTPS sources, units, market-cap reconciliation, opening balance
  sheet, source tiers and DCF drivers before any paid review runs. Invalid input
  skips all five downstream steps without creating Attempts or model fees.
- **Three-statement + DCF model**: integrated P&L, balance sheet and cash flow;
  bear/base/bull scenarios; perpetuity or exit-multiple terminal value; reverse
  DCF; 5×5 WACC × terminal sensitivity; xlsx workbook artifact.
- **Independent local audit**: the same Python engine is recomputed locally; the
  merge compares cloud/local numbers within 1e-4 and vetoes mismatches. A
  24-check cross-document invariant gate covers packet, model, workbook and audit.
- **Report**: adds model value per share, margin of safety, terminal-value share,
  reverse-DCF implied growth, integrity checks and preflight findings.

## Input contract changes

| Field | Change |
|---|---|
| `identityPacket` | unchanged |
| `financialPacket` | add `marketSnapshot.marketCapUsd`, `sharesOutstanding`, `balanceSheet` |
| `qualitativePacket` | add `sourceTier` (S/A/B/C) to each fact |
| `modelAssumptions` | **new, required**: explicit bear/base/bull DCF drivers |
| `asOf` | **new, optional**: freshness reference |

Old v3 packets without `marketCapUsd` / `modelAssumptions` will be blocked by the
v4 preflight. The v3 template remains available for non-modeling runs.

## Validation

- 78 Node tests, 36 Python tests
- Test server: template v2 `b2342e4b-83d6-4111-854b-d061db9f2d06`
- Final run `96a6542c-c121-4ce0-9091-2bc572e4f638`: preflight ready (229 checks),
  model ready, cloud/local matched, invariant gate 24/24, 17-sheet workbook,
  local audit accepted with 32 verified evidence / 0 rejected.
- Gating run `9464a209-fe37-44fc-abd8-a001b8434119`: invalid row returned
  `ready=false` with 3 findings, 0 artifacts, all five downstream steps skipped.

## Boundary

Research aid only. Not investment advice. The model value is conditional
arithmetic on the supplied assumptions, not a target price, return forecast, or
buy/sell instruction.
