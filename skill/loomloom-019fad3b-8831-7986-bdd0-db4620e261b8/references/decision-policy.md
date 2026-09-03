# Decision and Local Audit Rules

## Buffett's Four Filters — Mapping to Local Dimensions

This Skill implements Warren Buffett's four filters for "wonderful companies at fair prices" (per his shareholder letters), with two modern quantitative supplements. Every row is scored on these six dimensions; hard-veto rules enforce the spirit of the filters.

| Buffett filter | Local dimension | Weight | What it measures |
|---|---|---:|---|
| Circle of Competence | `understandability` | 10% | Can a normal investor explain how the company makes money? |
| Circle of Competence (deep) | `business_model` | 20% | Is the business model durable and intelligible? |
| Durable Competitive Advantage | `moat` | 20% | Is there structural pricing power, switching cost, or scale moat? |
| Able & Trustworthy Management | `management_capital_allocation` | 15% | Honest, competent operators with shareholder-friendly capital allocation? |
| *(modern supplement)* Financial Quality | `financial_quality` | 20% | ROIC, free cash flow, balance sheet, accounting red flags? |
| Attractive Price (Margin of Safety) | `valuation_opportunity_cost` | 15% | Margin of safety vs. owner earnings, with stated opportunity cost? |

The local row has a single `circle_of_competence` enum (`pass` / `uncertain` / `fail`) — `fail` is a hard veto.

## Scoring Order

Run veto and evidence-quality checks first, then apply weighted scoring. The score is for research priority only; it is NOT a return forecast, buy probability, or investment recommendation.

## Evidence Discipline

- Each cloud evidence record must contain `claim`, a complete `source_ref`, an atomic `source_value`, `period`, and `unit`.
- `source_ref` must start with `identityPacket`, `financialPacket`, or `qualitativePacket` and must resolve inside the row's input.
- `source_value` must match the input's original value exactly. Arrays, objects, and recomputed summaries are NOT atomic evidence.
- Markdown code fences around JSON may be removed locally, but the row must be tagged `normalized`.
- Rows with unsourced numbers, unparseable JSON, ticker mismatches, missing dimensions, or failures are `rejected`.
- The cloud is not allowed to fabricate target prices, future share prices, forecast growth, forecast margins, discount rates, terminal multiples, probabilities, or industry multiples.

## Hard Veto Rules

Any of the following prevents a row from entering `deep_research`:

1. `circle_of_competence` is `fail`.
2. Any of the four research dimensions lacks verifiable evidence.
3. Survival risk co-occurs with a weak balance sheet.
4. Major governance red flags co-occur with a low management / capital allocation score.
5. Accounting red flags co-occur with a low financial quality score.
6. Margin of safety score is below 30.
7. Valuation judgment state is not `eligible_for_manual_deep_research`.
8. Unauthorized forecast numbers or target prices are detected in the cloud output.
9. Rejected evidence outweighs verified evidence, or rejected evidence hits 6.

## Valuation Falsifiability Requirements

The valuation review must supply:

- Two `validity_basis` entries. One binds to price or price timestamp; the other binds to fiscal period, latest operating update end, or data-as-of date.
- Two to four `falsification_conditions`.
- Each condition includes a complete evidence path, original value, period, unit, and an `action` of `rerun_required` or `conclusion_invalidated`.

Missing any of these fields rejects the entire row. Narrative prose does NOT substitute for them.

## Ranking

Rank only rows with `decision_eligible=true`, comparing in order:

1. Veto count (fewer wins).
2. Confidence (`high` > `medium` > `low`).
3. Overall score.
4. Per-dimension scores: business model, moat, financial quality, valuation.
5. Ticker (alphabetical) for deterministic stability.

The report must show price and timestamp, fiscal period, verified evidence, contrary evidence, unknowns, veto items, and falsification conditions.
