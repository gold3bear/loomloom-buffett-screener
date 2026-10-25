# Buffett Four-Filters US Equity Screening — CogFoundry TemplateSpec (v3)

> v4 adds a deterministic three-statement + DCF Code node and an xlsx artifact.
> See [`../buffett-four-filters-model.cogfoundry/`](../buffett-four-filters-model.cogfoundry/).

This directory holds the **cloud-side** half of the LoomLoom US Equity Value Screening Skill. It pairs with the local Skill at `../../skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/`.

## What this template does

For each row (one US equity), the template runs **four parallel reviews** under Warren Buffett's four filters, plus a modern Financial Quality supplement:

| Step ID | Buffett filter | Local dimension it maps to |
|---|---|---|
| `stp_buffett_business` | Circle of Competence | `business` |
| `stp_buffett_moat` | Durable Competitive Advantage (moat) + Management | `moat` |
| `stp_buffett_financial` | *(modern supplement)* Financial Quality | `financial` |
| `stp_buffett_valuation` | Attractive Price (Margin of Safety) | `valuation` |

Each step emits one JSON object (wrapped in a ` ```json ... ``` ` fence) shaped to match the local Skill's `merge-public-results.mjs` `classify()` function. The local Skill then applies evidence audit, 9 hard-veto rules, deterministic ranking, and an auditable Markdown report.

## Files

- `template.json` — TemplateSpec v2 (`specVersion: "template-spec/v2"` wrapped at create time)
- `README.md` — this file

## Workflow

1. **Local Agent** collects identity / financial / qualitative packets per ticker (the local Skill at `../../skill/...` does this; see its `SKILL.md`).
2. **Local preflight** validates the packets (HTTPS sources, freshness, unit consistency).
3. **Local Agent** calls `loomloom market quote <this-listing-id>` to see per-task fee.
4. **User confirms** the run.
5. **CogFoundry** runs `template.json` — four parallel reviews, each producing one JSON object.
6. **Local Agent** pulls the run result, pipes it through `merge-public-results.mjs` + `render-report.mjs`.
7. **Local audit** rejects unsourced numbers, broken references, and out-of-input forecasts; ranks; emits Markdown.

## Pricing

`task_fixed_fee: 0.1 USD` per row (CogFoundry Marketplace default for this listing; configurable at publish time).

## Design notes

- Each prompt locks the LLM to a specific output schema with required keys and types. Missing fields will fail the local Skill's shape check.
- All four prompts forbid target prices, future share prices, forecast growth/margins, discount rates, terminal multiples, and probabilities. If a `valuation_red_flag` would tempt the model into such a number, it goes to `forbidden_numeric_claims` instead.
- `validity_basis` requires exactly one price/time reference and one period/date reference; `falsification_conditions` each carry `rerun_required` or `conclusion_invalidated`. These map directly to the local Skill's hard-veto rules in `references/decision-policy.md`.
- `subjectRevisionId` uses the openai-chat text contract. The current revision is `text.basic.openai-chat.v1@2026-08-15.1`. Re-check `loomloom template-spec contracts` before publishing; the revision may have moved.

## Publishing

```bash
# 1. Create the private template (cogfoundry server-side)
loomloom template-spec create template.json --name "Buffett Four-Filters US Equity Screening"

# 2. Run a smoke test with the sample row
loomloom template-spec run <template-id> --input-file sample-input.jsonl

# 3. Submit for Market SkillBot review
loomloom listing publish <template-id> \
  --display-name "US Equity Long-Term Value Batch Screening (Buffett Four Filters)" \
  --description "Parallel research screening for each US equity using Warren Buffett's four filters — circle of competence, durable competitive advantage (moat), able and trustworthy management, and attractive price with margin of safety — plus a modern financial-quality supplement. Research aid only — not investment advice. Beta: combine with the local Skill for evidence audit and human review." \
  --task-fixed-fee 0.1
```

`loomloom login` must be completed first; `loomloom doctor` should report `healthy: true` against `https://loomloom.cogfoundry.ai/loom/v1`.

## Local Skill pairing

Buyers of this SkillBot on CogFoundry Marketplace must also install the local Skill to run the preflight, evidence audit, hard-veto checks, and Markdown report. Installation:

```bash
curl -L https://github.com/gold3bear/loomloom-us-value-screening-skill/releases/latest/download/loomloom-us-value-screening-skill-v2.zip -o /tmp/skill.zip
mkdir -p .codex/skills
unzip -q /tmp/skill.zip -d .codex/skills
```

The local Skill's `SKILL.md` references this Listing ID and tells the Agent how to invoke it through `loomloom market quote` / `loomloom market run`.
