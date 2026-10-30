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

- 99 Node tests, 54 Python tests
- Test server: template v9 `7ca2a5d6-dbd7-4e4f-85c1-004d1456bd44` (quarantine repair + cloud report)
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
  evidence value mismatch and produced a report explicitly labelled "rejected".
- A v7 ORCL run `36c4e178-4db8-4f60-a9b8-2abd3f848b85` quarantined four bad
  evidence entries, kept 42 verified, returned `accepted=true`, and produced a
  report labelled "accepted" with warnings.
- A v9 NVDA run `c471e654-57c6-4af9-971f-0aa0f693d044` quarantined three
  evidence entries and one trace record, kept 35 verified, returned
  `accepted=true`, and produced a cloud report (score 82 / watchlist).
- Gating run `9464a209-fe37-44fc-abd8-a001b8434119`: invalid row returned
  `ready=false` with 3 findings, 0 artifacts, all five downstream steps skipped.

## Boundary

Research aid only. Not investment advice. The model value is conditional
arithmetic on the supplied assumptions, not a target price, return forecast, or
buy/sell instruction.

## Bounded review retry (experimental)

`templates/buffett-four-filters-retry.cogfoundry/` adds a two-round Loop around
the four reviews. Prompt builders receive the previous round's judge feedback;
the judge accepts when every dimension has valid evidence, otherwise it requests
one retry. The accepted review strings are re-exported through Code ports and
consumed by the outer audit.

Verified on test template `c02a59e5-418b-4827-97a5-303b0cc8be67` v3
`3241d088-9f97-4559-80b1-78ff206db9b2`, run
`82b553b8-4025-4923-9643-007d16562b70`: Loop accepted iteration 1, audit
accepted, 45 verified / 6 quarantined, score 71.

NVDA retry parity: run `fcb051ff-1082-44ec-85c0-1e546b9271a4` also accepted
in iteration 1 (50 verified / 0 quarantined, score 83). The watch-level
estimatedCost was `7.5245912 CNY` for both retry runs, versus about `0.05 CNY`
for the stable v9 runs; this looks like a flat Loop fee and needs billing
confirmation before using the retry template in production.

## Workbook manifest cloud check (v11)

`stp_model01` now emits a third output, `workbookManifest`, read back from the
generated xlsx (sheet names, count, required sheets). `stp_audit1` validates it
and records `audit.workbook`; missing required sheets are a hard error.

This moves the structural sheet check to the cloud without requiring xlsx
artifact input. The full cell-level `check-invariants` remains optional/local.

Test template v11: `e5b0db0c-6eeb-4157-a1d7-8a183274f398`
(definition `ec24383c...`). ORCL run `c2ede575-c01d-4aff-b733-9d5b87afd410`
confirmed `workbook.sheets=17` and `requiredPresent` all true; the run itself
was rejected on evidence quarantine, not on the workbook manifest.

## Cloud ranking template

`templates/buffett-cloud-ranking.cogfoundry/` adds a single Code step that ranks
compact v9 audit rows (score, MOS, evidence, veto) and emits a Markdown artifact.
No LLM or network. Test template `5c639cf5-232e-4a04-9145-251e61ce595d` v1
`bcb3bf36-a8b5-4759-9f55-796ef3860708`, run
`fd023094-64a7-4094-9058-b0a59d4c184d`: 3 valid rows, top 2, ORCL vetoed and
retained.

## Batch extract + rank template

`templates/buffett-cloud-batch.cogfoundry/` reads `run result-rows`, extracts
`stp_audit1` values and emits ranking + report in one Code step. Verified with
template `6653c525-04da-4522-b3a0-0aca9c4dfc94`, version
`ced87ed4-51f4-40f3-9065-ce7ac0715e45`, run
`fccb218b-26c3-47e0-a20e-bd341a3e4154` (one values-only NVDA row, 0 CNY).
Full result-rows with artifacts exceeded the upload row limit; strip artifacts
or split batches.
