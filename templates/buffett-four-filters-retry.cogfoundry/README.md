# Buffett Four-Filters + DCF — bounded review retry

This is a separate experimental template. It does not replace the stable 8-step
template in `../buffett-four-filters-model.cogfoundry/`.

## What changes

The four review steps run inside a **two-round Loop**:

```text
stp_preflight
  -> stp_loop01
       body:
         prompt builder (business) -> business review
         prompt builder (moat)     -> management review
         prompt builder (financial)-> financial review
         prompt builder (valuation)-> valuation review
         judge (Code)
       control: decision + checkpoints
  -> stp_model01
  -> stp_audit1
  -> stp_report
```

Each prompt builder receives the ticker packet plus the Loop's `feedback` state.
On a failed round, the judge writes validation errors into `feedback`; the next
round's prompts include:

```text
PREVIOUS ROUND FEEDBACK (fix these issues; do not repeat them):
...
```

The judge checks:

- every review parses as JSON and has the expected dimension;
- required score fields are 0-100;
- at least one evidence record resolves to an atomic packet leaf with a matching
  `source_value`.

If all four reviews pass, the judge accepts. If not, round 0 returns `continue`;
round 1 accepts the candidate anyway so the outer audit can reject it with
explicit findings instead of producing no result.

## Loop contract

```json
"control": {
  "decision": {"stepId": "stp_judge1", "portId": "action"},
  "checkpoints": [{"stepId": "stp_judge1", "portId": "action"}]
}
```

`maxIterations` is 2, so the worst case reruns four reviews once.

The judge re-exports the four review strings through Code ports. The outer audit
consumes those Code values, not raw Loop model outputs; this avoids the validator
error `code text input ... requires a declared model text output dependency`.

## Model choice

Loop body reviews use a fixed model (`ali/qwen-plus-latest`) because the cost
topology requires a static model ID inside a Loop. The DCF/model step is
unaffected and still uses the outer template inputs.

## Verified run

- Template: `c02a59e5-418b-4827-97a5-303b0cc8be67`
- Version: v3 `3241d088-9f97-4559-80b1-78ff206db9b2`
- Run: `82b553b8-4025-4923-9643-007d16562b70`
- Loop: `accepted`, 1 iteration
- Cloud audit: `accepted=true`, score 71, `watchlist`
- Evidence: 45 verified / 6 quarantined
- Artifacts: workbook + report
- NVDA run `fcb051ff-1082-44ec-85c0-1e546b9271a4`: accepted iteration 1,
  50 verified / 0 quarantined, score 83
- Watch-level estimatedCost was `7.5245912 CNY` for both retry runs, versus
  about `0.05 CNY` for stable v9; confirm billing before production use

## Known limits

- The body model is fixed; `modelChoice` cannot be used inside the Loop cost
  topology.
- A retry reruns all four reviews, not just the failing dimension.
- The report still runs for a rejected audit and labels it rejected.
- Workbook structural validation remains local because Code artifact inputs do
  not accept xlsx in this environment.
