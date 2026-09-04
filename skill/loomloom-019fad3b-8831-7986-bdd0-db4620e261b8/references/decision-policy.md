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
7. Valuation `judgment_state` is `evidence_insufficient` (the LLM could not defend ANY valuation anchor — no owner earnings, no historical P/E range, no comparable multiples).
8. Valuation `judgment_state` is `insufficient_margin_of_safety_verdict` (the LLM explicitly concludes the current price is above a defensible intrinsic value).
9. Unauthorized forecast numbers or target prices are detected in the cloud output.
10. Rejected evidence outweighs verified evidence, or rejected evidence hits 6.

## 3-Tier Valuation Calibration (added in v3)

`judgment_state` is no longer binary. There are four values the cloud LLM may emit, with three distinct downstream behaviors:

- `eligible_for_manual_deep_research` — passes ranking; margin_of_safety_score ≥ 60, valuation_score ≥ 60, no red flag, and the LLM has either explicit owner earnings in the packet or an explicit historical P/E range from a 10-K Item 5 citation.
- `evidence_thin` — **not a veto**; the row is surfaced as a `watchlist` decision so a human can manually anchor valuation. Typical case: current P/E plus qualitative moat evidence, but no normalized owner earnings or 10-K Item 5 historical range supplied. The cloud LLM is expected to prefer this tier over `evidence_insufficient` whenever any defensible anchor is present.
- `insufficient_margin_of_safety` — treated as a hard veto via rule 8; the LLM explicitly states the price is above the intrinsic value anchor. Distinct from the numeric `< 30` veto in rule 6.
- `evidence_insufficient` — hard veto via rule 7; the LLM could defend no anchor. Reserve this for genuinely opaque issuers (recent IPOs with no 10-K history, foreign issuers without US filings, or tickers the local Agent could not source 3 fiscal years of financials for).

The decision-tier mapping is therefore:

| `judgment_state` | Decision tier | `decision_eligible` |
|---|---|---|
| `eligible_for_manual_deep_research` (and no other veto) | `deep_research` if overall ≥ threshold, else `watchlist` | `true` only if `deep_research` |
| `evidence_thin` (and no other veto) | `watchlist` | `false` |
| `insufficient_margin_of_safety` (any score) | `pass` (vetoed) | `false` |
| `evidence_insufficient` (any score) | `pass` (vetoed) | `false` |

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

Rows with `decision_eligible=false` are still surfaced in the report under a separate **Watchlist** section, in this order: `evidence_thin` rows first (these have no veto and only lack a normalized earnings anchor — a human deep dive can resolve them quickly), then `insufficient_margin_of_safety` and `evidence_insufficient` rows. Within each band, sort by overall score descending.

The report must show price and timestamp, fiscal period, verified evidence, contrary evidence, unknowns, veto items, and falsification conditions.
