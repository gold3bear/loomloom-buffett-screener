# US Value Screen — Cloud Batch Extract + Rank

Input `run result-rows` JSON, extract the v9 audit values, rank and render a batch
Markdown report. **No LLM, no network.**

## Input

```text
resultRows: JSON from `loomloom run result-rows <run-id> --output json`
topN:       integer, 1..100
```

The Code reads `stp_audit1/audit` and `stp_audit1/model` (or `stp_model01/model`)
from each row. Missing audit rows are skipped.

## Output

- `ranking` — normalized rows, rank, summary;
- `report` — Markdown artifact.

## Verified run

- template: `6653c525-04da-4522-b3a0-0aca9c4dfc94`
- version: `ced87ed4-51f4-40f3-9065-ce7ac0715e45`
- run: `fccb218b-26c3-47e0-a20e-bd341a3e4154`
- one NVDA values-only row: extracted, ranked, report generated
- cost: Code-only, 0 CNY

## Input size limit

A full `result-rows` containing artifacts (314 KB) was rejected by the upload
row limit. A values-only row (55 KB) worked. For large batches, pass rows with
only `values` (strip artifacts/inputJson) or split the batch.
