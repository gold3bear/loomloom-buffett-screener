---
name: "loomloom-019fad3b-8831-7986-bdd0-db4620e261b8"
description: "Batch research long-term value of US equities. The local Agent collects and validates ticker identity, financial valuation, business quality and risk evidence; the LoomLoom public SkillBot performs parallel cloud review; the local Agent then runs evidence audit, hard vetos, deterministic ranking, and a Markdown report. Use when the user provides a US stock ticker, a watchlist (CSV/Excel/JSON), a standardized financial metrics table, asks for value-investing screening, batch comparison, or a re-run after price or filing updates."
---

# US Equity Long-Term Value Batch Screening

Turn the user's ticker list or table into an auditable data packet, run it through LoomLoom's parallel cloud research, then validate, merge, and produce a research report locally. Research aid only — not investment advice. We never output target prices, position sizes, or buy/sell instructions.

## Investment Philosophy: Buffett's Four Filters

This Skill is built on **Warren Buffett's four filters for wonderful companies at fair prices** (per his shareholder letters), with two modern supplements for quantitative discipline:

| Buffett filter | Local dimension | Weight |
|---|---|---:|
| Circle of Competence | `understandability` / `business_model` | 10% / 20% |
| Durable Competitive Advantage (Moat) | `moat` | 20% |
| Able and Trustworthy Management | `management_capital_allocation` | 15% |
| Attractive Price (Margin of Safety) | `valuation_opportunity_cost` | 15% |
| *(modern supplement)* Financial Quality | `financial_quality` | 20% |

The hard-veto rules in `references/decision-policy.md` implement the same discipline Buffett describes: if a company is outside your circle of competence, has no durable moat, runs a poor management/capital-allocation track record, or trades without margin of safety, the row is dropped from the deep-research queue.

## Hard Boundaries

- Public Listing: `019fad3b-8831-7986-bdd0-db4620e261b8`.
- Always read the current Listing and public input schema before executing. Run only through the Market path.
- Never reveal, infer, or package cloud-side private prompts, step IDs, model settings, template definitions, or internal mappings.
- Never write the LoomLoom token into the Skill, data files, logs, or reports.
- Local preparation, validation, quoting, and report generation do NOT authorize paid execution.
- Every real run must first fetch a server quote, show the user task count, currency, and fees, and obtain explicit confirmation for that run.
- After user confirmation, any change in tickers, data, files, Listing, or quote requires re-validation, re-quote, and re-confirmation.

## User Entry Points

Accept any of the following:

- A ticker list, e.g. "analyze AAPL, COST, UAL".
- A CSV, Excel, or JSON watchlist.
- A standardized financial metrics table the user already has.
- Three pre-built JSON data packets.

Do not ask end users to hand-author `identityPacket`, `financialPacket`, or `qualitativePacket`. If a blocker is missing, ask one question at a time. When the user permits local retrieval and the source is reachable, the local Agent should fill in the gap.

## Install LoomLoom CLI

The cloud steps (readiness check, public-contract read, quote, run) require the `loomloom` CLI. Install it if missing.

### One-shot install prompt

Paste the following to your AI assistant (Claude Code / Codex / OpenClaw / WorkBuddy / etc.) or run it manually:

> Please install LoomLoom in this project: source is https://github.com/Cogfoundry-ai/loomloom or https://gitee.com/cogfoundry/loomloom. Server: https://loomloom.shengsuanyun.com/loom/v1. Token is `<replace with your own ShengSuanyun key>`. After installing, run `loomloom doctor` once to verify.

### Manual install steps

1. **Request a key**: visit https://console.shengsuanyun.com/user/keys to get a ShengSuanyun API key.
2. **Clone the repo**:
   ```bash
   git clone https://gitee.com/cogfoundry/loomloom.git
   # or GitHub (if accessible):
   # git clone https://github.com/Cogfoundry-ai/loomloom.git
   ```
3. **Run the installer**: enter the cloned directory and follow its README.
4. **Configure environment variables** (add to `~/.zshrc` or `~/.bashrc`):
   ```bash
   export LOOMLOOM_SERVER='https://loomloom.shengsuanyun.com/loom/v1'
   export LOOMLOOM_TOKEN='<your ShengSuanyun key>'
   ```
5. **Verify**:
   ```bash
   source ~/.zshrc   # or open a new terminal
   loomloom doctor
   ```
   Once `doctor` passes, the cloud steps of this Skill are ready.

## End-to-end Workflow

### 1. Readiness check

On first use or when auth, service, or network errors appear, run `loomloom doctor` to check the CLI, HTTPS server, and login state. If the `loomloom` command is missing, follow the [Install LoomLoom CLI](#install-loomloom-cli) section above. Do not auto-run `doctor` for ordinary business-input errors.

### 2. Read the current public contract

Run:

```bash
loomloom market show 019fad3b-8831-7986-bdd0-db4620e261b8 --output json
```

Collect fields only from the current public input schema. Stop if the Listing is unavailable, permission is denied, or the version is not executable. Never substitute templates or bypass the Market.

### 3. Build the data packets locally

One packet per ticker:

- `identityPacket`: ticker, company name, industry, data-as-of date, fiscal period, HTTPS source URLs.
- `financialPacket`: current price and timestamp, historical financials, cash flow, capital returns, balance sheet, share count, and valuation facts.
- `qualitativePacket`: business model, moat evidence, management, capital allocation, risks, contrary evidence, unknowns.

Prefer SEC filings, company IR materials, and verifiable primary sources. Management self-reporting must be tagged with its source; items that cannot be independently confirmed go to `unknowns`. Keep GAAP and adjusted figures separate. See the full constraints in [data-contract.md](references/data-contract.md).

### 4. Local preflight and request generation

Run preflight first:

```bash
node scripts/preflight.mjs --input <packets.json> --output <preflight.json> --pretty
```

Exit code `1` means a hard failure — do not quote or run. Fix and regenerate the Market request:

```bash
node scripts/prepare-market-input.mjs --input <packets.json> --output <market-request.json> --pretty
```

Show the user a per-ticker summary: data-as-of, price timestamp, source coverage, unknowns, and degradations. Do not display large internal JSON blocks.

### 5. Quote and confirm

Inputs are already programmatic, so use the JSON Market flow:

```bash
loomloom market quote 019fad3b-8831-7986-bdd0-db4620e261b8 --input-file <market-request.json> --output json
```

Show the server response to the user: task count, per-task creator fee, estimated pre-authorization total, currency, balance status, and whether model / API fees are returned separately. Never guess missing fields, and never convert currency on your own.

Wait for explicit confirmation in the current conversation. After confirmation, generate a fresh `client-request-id` for the run:

```bash
loomloom market run 019fad3b-8831-7986-bdd0-db4620e261b8 \
  --input-file <market-request.json> --confirm --client-request-id <id> --output json
```

### 6. Wait and retrieve

Save the returned `runTransactionId` and `runId`. Use `loomloom run watch <run-id>` to wait; when done, pull the full result set:

```bash
loomloom run result-rows <run-id> --output json > <result-rows.json>
```

On partial failure, keep the successful rows. Any paid re-run for failed items must re-quote and re-confirm.

### 7. Local audit, merge, and report

The local merger identifies the four research dimensions by the public output JSON's field shapes, without depending on or leaking private step IDs:

```bash
node scripts/merge-public-results.mjs \
  --input <result-rows.json> --output <local-audit.json> --pretty

node scripts/render-report.mjs \
  --input <local-audit.json> --output <report.md>
```

Only rows whose evidence paths resolve to the input row, whose `source_value` matches the atomic fact exactly, whose price and fiscal period are valid, and which trigger no hard veto enter the ranking. Rejected evidence never feeds conclusions. See [decision-policy.md](references/decision-policy.md) for the full rules.

### 8. Deliver

Deliver the report, audit JSON, run ID, order ID, data and price cutoffs, and actual fees (if the service returns them). Use the following decision tiers:

- `deep_research` — worth a human deep dive.
- `watchlist` — observe; wait for better data or price.
- `pass` — not in this round.
- `rejected` — local structural or evidence check failed; not ranked.

The user may append tickers or update filings/prices for a re-run; any input change re-triggers preflight and re-quote.

## Resource Routing

- Preparing or auditing input → read [references/data-contract.md](references/data-contract.md).
- Merging, explaining ranking, or handling validation failures → read [references/decision-policy.md](references/decision-policy.md).
- Run local tests: `node --test scripts/*.test.mjs`.
- After editing the Skill, validate the directory with `skill-creator`'s `quick_validate.py`.
