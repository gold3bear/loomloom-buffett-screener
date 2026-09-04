# LoomLoom US Equity Long-Term Value Batch Screening

> ## ⚠️ NOT INVESTMENT ADVICE
>
> **This project does not constitute investment, legal, tax, or accounting advice.**
> It is a research aid only. The Skill does not recommend buying, selling, or
> holding any security, does not issue target prices or position sizes, and does
> not weigh in on whether any individual investor should act on the output.
> Past performance is not indicative of future results. You are responsible for
> your own investment decisions and should consult a licensed professional
> before acting on anything the Skill produces.

A Skill for local Agents (Codex / Claude Code / WorkBuddy / etc.) that
performs batch long-term value screening of US equities through
**Warren Buffett's four filters**. The local Agent collects and validates
ticker data, then the LoomLoom public SkillBot runs a parallel research
pass across those four filters, and finally the local Agent audits the
evidence, applies hard vetos, and emits a deterministic Markdown report.

The Skill is distributed through the **CogFoundry** platform
(`https://loomloom.cogfoundry.ai`) and the source-of-truth repo lives at
`gold3bear/loomloom-buffett-screener`. The local Agent only needs the
extracted Skill directory, the `loomloom` CLI, and a CogFoundry credential.

## Investment Philosophy: Buffett's Four Filters

This Skill is built on **Warren Buffett's four filters for wonderful
companies at fair prices** (per his shareholder letters), with one modern
supplement for quantitative discipline:

| Buffett filter | Local dimension | Weight |
|---|---|---:|
| Circle of Competence | `understandability` / `business_model` | 10% / 20% |
| Durable Competitive Advantage (Moat) | `moat` | 20% |
| Able and Trustworthy Management | `management_capital_allocation` | 15% |
| Attractive Price (Margin of Safety) | `valuation_opportunity_cost` | 15% |
| *(modern supplement)* Financial Quality | `financial_quality` | 20% |

The hard-veto rules in `references/decision-policy.md` implement the same
discipline Buffett describes: if a company is outside your circle of
competence, has no durable moat, runs a poor management / capital-
allocation track record, or trades without margin of safety, the row is
dropped from the deep-research queue. **No target prices, no
position sizes, no buy / sell instructions** are ever emitted — the
Skill surfaces what is known, what is not known, and what would
invalidate the verdict, then stops.

## How It Works — Eight-Step Workflow

1. **Readiness check.** `loomloom doctor` for CLI, server, login state.
2. **Read the current public contract.** `loomloom market show <listing-id>`
   for the input schema, model selection, and pricing.
3. **Build the three data packets locally.** `identityPacket`,
   `financialPacket`, `qualitativePacket` per
   [references/data-contract.md](skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/references/data-contract.md).
4. **Local preflight and request generation.** Validate freshness,
   sources, and unit consistency; emit a `Market` request JSON.
5. **Quote and confirm.** Show task count, fees, and balance to the
   user. The paid run only fires after explicit user confirmation, with
   a fresh `client-request-id` for idempotency.
6. **Wait and retrieve.** `loomloom run watch <run-id>` until the four
   parallel reviews complete; pull result rows.
7. **Local audit, merge, and report.** Evidence audit (source_ref must
   resolve into the input row, source_value must match the atomic fact
   exactly), 9 hard vetos, deterministic ranking, Markdown report.
8. **Deliver.** Report, audit JSON, run ID, order ID, data and price
   cutoffs, actual fees. Decision tier per row is one of `deep_research`,
   `watchlist`, `pass`, or `rejected`.

Full workflow is documented in
[SKILL.md](skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/SKILL.md).

## Decision Tiers

The cloud LLM emits one of four `judgment_state` values per row; the
local audit maps these to a tier the human reader can act on:

| `judgment_state` | Decision tier | Meaning |
|---|---|---|
| `eligible_for_manual_deep_research` | `deep_research` (or `watchlist` if overall is below the threshold) | Margin-of-safety score ≥ 60, valuation score ≥ 60, and the LLM has either explicit owner earnings in the packet or an explicit historical P/E range from a 10-K Item 5 citation. |
| `evidence_thin` | `watchlist` | Current P/E plus qualitative moat evidence is present, but no normalized earnings anchor. **Not a veto.** Surfaces the row as a watchlist decision so a human can manually anchor valuation. |
| `insufficient_margin_of_safety` | `pass` (vetoed) | The LLM explicitly concludes that the current price is above a defensible intrinsic value. |
| `evidence_insufficient` | `pass` (vetoed) | The LLM could defend no anchor at all. Reserve for genuinely opaque issuers. |

The `evidence_thin` tier is what makes the Skill useful in practice: a
well-known company at a fair-to-rich valuation is *not* the same signal
as a structurally weak business, and the report should say so.

## Hard Boundaries

- **Always read the current Listing and public input schema before
  executing. Run only through the Market path.**
- Never reveal, infer, or package cloud-side private prompts, step
  IDs, model settings, template definitions, or internal mappings.
- Never write the LoomLoom token into the Skill, data files, logs, or
  reports.
- Local preparation, validation, quoting, and report generation do
  **NOT** authorize paid execution.
- Every real run must first fetch a server quote, show the user task
  count, currency, and fees, and obtain explicit confirmation for
  that run.
- After user confirmation, any change in tickers, data, files, Listing,
  or quote requires re-validation, re-quote, and re-confirmation.
- **Every fact in a packet must carry a provenance triple** — source
  URL, as-of date, and source tier (S = SEC EDGAR / company IR, A =
  MarketWatch / Yahoo Finance, B = secondary news, C = never). C-tier
  sources are not evidence. A fact without all three goes to
  `unknowns` — never into an evidence-bearing field.

## Data Discipline

Every fact in a packet carries a **provenance triple** with a tier:

- **S — primary.** SEC EDGAR (10-K / 10-Q / 8-K) and the company
  investor-relations press release.
- **A — quote.** MarketWatch, Yahoo Finance, large quote aggregators.
- **B — secondary.** Bloomberg, Reuters, FT, WSJ.
- **C — never.** Reddit, forums, Wikipedia, Substack. Never used as
  evidence.

The local Agent runs five cross-checks before any data is handed off to
preflight:

1. Market cap reconciliation: `price * shares` within ±2% of
   `marketCapUsd`.
2. Annual-history array lengths: `fiscalYearEnd` / `revenue` /
   `netIncome` / `freeCashFlow` all the same length.
3. Latest 10-K vs IR press release: same to the dollar.
4. Source vs. period: every fact's `date` inside the freshness window.
5. Packet structure: three top-level keys, no `tickerPacket.`
   misnaming.

Freshness thresholds are enforced:

- `financialPacket.marketSnapshot.price` ≤ 7 days
- `identityPacket.dataAsOf` ≤ 45 days
- 10-K filing ≤ 18 months since the 10-K's fiscal year end
- 10-Q filing ≤ 6 months since the 10-Q's period end

The full execution manual — six-step collection flow, source-aware
copy discipline, failure-mode playbook, walkthrough with a real SEC
data example, and the placeholder-fabrication anti-pattern — is in
[SKILL.md section 3](skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/SKILL.md#3-build-the-data-packets-locally).

## Install

The Skill ships as a single directory. The exact directory name
(`loomloom-019fad3b-8831-7986-bdd0-db4620e261b8`) must be preserved.

### One-shot install (for the Agent)

Paste the following to your Agent:

> Please open https://github.com/gold3bear/loomloom-buffett-screener,
> download the latest `loomloom-buffett-screener-v3.zip` from Releases,
> and extract the directory `loomloom-019fad3b-8831-7986-bdd0-db4620e261b8`
> into the Agent's local Skills directory, preserving every file and
> folder beneath it. Installation is a local file operation only — do
> NOT create any LoomLoom cloud task. Then read the extracted `SKILL.md`,
> verify that the `loomloom` CLI is available, and run `loomloom doctor`.
> If credentials are not configured, ask me to supply my own CogFoundry
> API key. Do not write the key into the Skill, the repo, the logs, or
> any report.

### Manual install

```bash
curl -L \
  https://github.com/gold3bear/loomloom-buffett-screener/releases/latest/download/loomloom-buffett-screener-v3.zip \
  -o /tmp/loomloom-buffett-screener-v3.zip

mkdir -p ~/.codex/skills
unzip -q /tmp/loomloom-buffett-screener-v3.zip -d ~/.codex/skills
```

After install, the path below must exist:

```text
~/.codex/skills/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/SKILL.md
```

### Configure the LoomLoom CLI

```bash
git clone https://github.com/Cogfoundry-labs/loomloom.git
# Or the Gitee mirror if GitHub is unreachable in your network:
# git clone https://gitee.com/cogfoundry/loomloom.git
```

Configure your own CogFoundry credentials (do **NOT** commit them):

```bash
loomloom login
# Browser-based login persists the credential in:
#   ~/Library/Application Support/loomloom/config.json (macOS)
#   %APPDATA%\loomloom\config.json       (Windows)
# or in env vars:
#   export LOOMLOOM_SERVER='https://loomloom.cogfoundry.ai/loom/v1'
#   export LOOMLOOM_TOKEN='<your CogFoundry key>'

loomloom doctor
```

After `doctor` passes, read the installed Skill's `SKILL.md` and start
a research run by providing tickers, a watchlist, or a standardized
financial metrics table.

## Validated Behaviour

The Skill has been validated end-to-end with five sample runs across
eight real-data tickers (NVDA, AAPL, COST, BRK.B, JPM, PG, MSFT, INTC).
Key results:

- **0 / 8 hard vetoes** under the v3 three-tier calibration. Every row
  is either in the deep-research queue, in the watchlist, or the LLM
  explicitly concluded the price is above intrinsic value.
- **0 hallucinated evidence** across all 8 tickers, 172 evidence
  records verified end-to-end through the local audit.
- **INTC** is the known weak case: the cloud LLM times out on the
  Intel 10-K + 4-way prompt because the packet is too long for the
  configured model. This is a model / packet-length issue, not a Skill
  bug; the workaround is to pre-trim the Intel packet to 3 fiscal
  years without the qualitativePacket.unknowns field.

Total out-of-pocket cost across the validation runs: **USD 1.44**.

## Repository Layout

```text
README.md                                                          This file
LICENSE                                                            MIT
index.html                                                         Static product page
docs/                                                              Page assets + English tutorial
skill/
  loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/                    The Skill (reviewable)
    SKILL.md                                                       Authoritative contract for the local Agent
    loomloom-skill.json                                            Listing metadata
    agents/openai.yaml                                             Agent-side model hint
    references/
      data-contract.md                                             Per-field schema + freshness thresholds
      decision-policy.md                                           Hard veto rules + ranking criteria
    scripts/
      preflight.mjs + .test.mjs                                    Local validation
      prepare-market-input.mjs + .test.mjs                         Packet -> Market request
      prepare-cogfoundry-input.mjs + .test.mjs                     Market request -> cogfoundry wire shape
      merge-public-results.mjs + .test.mjs                         Local evidence audit + 9 hard vetos
      render-report.mjs                                            Markdown report
templates/
  buffett-four-filters.cogfoundry/                                 CogFoundry private template
    template.json                                                  4-way parallel review prompt spec
    README.md                                                      TemplateSpec authoring notes
```

## License

This repository is released under the [MIT License](LICENSE). Use
remains subject to the LoomLoom Terms of Service and any third-party
data-source restrictions.
