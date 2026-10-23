# v4 Release Notes (Release Candidate)

## Highlights

- **Preflight gate**: a deterministic Code node validates the packet, assumptions,
  freshness, HTTPS sources, units, market-cap reconciliation, opening balance
  sheet, source tiers and DCF drivers before any paid review runs. Invalid input
  skips all five downstream steps without creating Attempts or model fees.
- **Three-statement + DCF model**: integrated P&L, balance sheet and cash flow;
  bear/base/bull scenarios; perpetuity or exit-multiple terminal value; reverse
  DCF; 5×5 WACC × terminal sensitivity; xlsx workbook artifact.
- **Cloud audit + optional local recompute**: `stp_audit1` resolves evidence
  paths, checks narrative numbers, scores the four dimensions and validates model
  self-checks. Local scripts remain for optional independent recomputation and a
  25-check cross-document gate; they are no longer required for the cloud report.
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

- 92 Node tests, 44 Python tests
- Test server: template v6 `3c6c1fc2-3c25-49fb-9d98-67c0485cbaa0` (cloud audit + report)
- Final NVDA run `1aa64499-6e2e-404e-b36b-7027d128d614`: preflight ready (246 checks),
  model ready, cloud/local matched, invariant gate 25/25, 17-sheet workbook,
  local audit accepted with 31 verified evidence / 5 rejected. Two narrative
  numbers were flagged: FCF/NI `1.03x` vs packet `0.66x`, and "net cash" vs the
  current net debt.
- The equity bridge now uses opening net debt; the old terminal-net-debt values
  (AAPL `137.68`, NVDA `140.03`) are superseded by AAPL `122.81` and NVDA `114.52`.
- The four review prompts now carry a source-ref allowlist: existing leaf paths
  only, no `unknowns[i]` or object citations. The cloud audit enforces it too;
  prompt-only hardening did not eliminate every bad citation.
- A v6 ORCL run `8872d2db-ca56-4ac1-a2d8-574aef0fac52` correctly rejected one
  evidence value mismatch and produced a report explicitly labelled "rejected",
  proving the cloud gate and report artifact work together.
- Gating run `9464a209-fe37-44fc-abd8-a001b8434119`: invalid row returned
  `ready=false` with 3 findings, 0 artifacts, all five downstream steps skipped.

## Boundary

Research aid only. Not investment advice. The model value is conditional
arithmetic on the supplied assumptions, not a target price, return forecast, or
buy/sell instruction.
