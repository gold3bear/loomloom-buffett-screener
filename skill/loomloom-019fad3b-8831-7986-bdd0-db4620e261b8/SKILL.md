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
- **Every fact in a packet must carry a provenance triple: source URL, as-of date, and source tier (S = SEC EDGAR / company IR, A = MarketWatch / Yahoo Finance quote, B = secondary news, C = never). C-tier sources are not evidence.** A fact without all three is treated as unverified and goes to `unknowns` — never into an evidence-bearing field. See [section 3.1](#31-hard-rule-every-number-traces-to-a-source-url) for the full provenance discipline.

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

The cloud step only reads what you put in. Garbage in, garbage out — and the four-dimension review cannot repair a packet that is missing sources, mixing GAAP with non-GAAP, or silently padded with placeholder numbers. This section is the execution manual: where to fetch each fact, how to copy it without error, how to cross-check before you hand off to preflight, and how to refuse to invent data when the source is unavailable.

#### 3.1 Hard rule: every number traces to a source URL

A number in a packet without a source URL goes to `unknowns` — never into an evidence-bearing field. The Skill will detect and report ungrounded numerics, but a downstream user should not have to read the report to discover the data was fabricated. If you cannot fetch a primary source for a fact, either retry, escalate to the user, or write the fact to `unknowns` with a one-line note explaining what blocked the fetch. Never round, never smooth, never estimate, never "ballpark".

**Provenance triple — every fact carries three pieces of metadata:**

1. **Source URL** — an HTTPS link that resolved at fetch time. The local audit and the cloud review will both reject evidence that points to a non-resolving or un-fetched URL.
2. **As-of date** — the date the source published the fact, or the `asOf` timestamp on the quote page (not the time you fetched the page). See the freshness thresholds in 3.7.
3. **Source tier** — one of: **S** = SEC EDGAR (10-K / 10-Q / 8-K) or company investor-relations press release, **A** = MarketWatch / Yahoo Finance / large quote aggregator, **B** = secondary news (Bloomberg / Reuters / FT / WSJ), **C** = forums / blogs / Wikipedia / Substack (never used as evidence). The full tier table is in 3.3.

A fact with all three is verified. A fact missing any of the three is treated as unverified, moved to `unknowns`, and never cited by the cloud review. The downstream reader should be able to check the source URL, the as-of date, and the tier for every fact in the report without re-asking the local Agent.

#### 3.2 One packet per ticker

- `identityPacket` — ticker, company name, industry, data-as-of date, fiscal period, HTTPS source URLs.
- `financialPacket` — current price and timestamp, three fiscal years of revenue / net income / free cash flow, balance sheet, capital returns, share count, valuation facts.
- `unknowns` lives in both `financialPacket` and `qualitativePacket` and is always the destination for unverified items.
- `qualitativePacket` — business model, moat evidence, management, capital allocation, risks, contrary evidence, unknowns.

The full per-field schema is in [references/data-contract.md](references/data-contract.md); this section is about the *act of populating* it, not the schema.

#### 3.3 Data-source priority

Use the highest-priority source that is actually available for the field you are filling. Do not skip a tier if it is reachable; do not invent a tier-3 figure when tier-1 is missing.

| Tier | Source | What to pull from it |
|---|---|---|
| **S — primary** | SEC EDGAR (`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=10-Q`) | Latest 10-K and 10-Q, the 10-K Item 1A risk factors, the 10-K Item 6 selected financial data, the 10-Q balance sheet |
| **S — primary** | Company investor relations (e.g. `https://nvidianews.nvidia.com/news/financial-news` for NVDA) | Most recent quarterly press release, the earnings call transcript, the capital return disclosure |
| **A — quote** | MarketWatch or Yahoo Finance quote page | Current price, market cap, shares outstanding, trailing P/E. Always read the as-of timestamp from the page, not the page-load time |
| **B — secondary** | Bloomberg, Reuters, FT, WSJ | Use only when tier-S and tier-A are both unreachable. Re-verify any number before it enters a packet |
| **C — never** | Reddit, forums, Wikipedia, personal blogs, Substack | Not a source. If you find a fact only at tier-C, it goes to `unknowns` |

#### 3.4 Six-step per-ticker collection flow

For every ticker in the batch, do the following in order. Do not skip steps to save time — the cross-checks in step 5 are what catch the kinds of errors that turn a 79/100 score into a fabricated-data red flag downstream.

1. **Resolve the SEC CIK.** Open the SEC EDGAR company search at `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company={ticker}&type=10-K&dateb=&owner=include&count=10`. Capture the CIK (10-digit zero-padded), the filing dates of the latest 10-K and 10-Q, and the filing URLs.
2. **Pull the 10-K Item 6 / Item 8 selected financial data and Item 1A risk factors.** This is the canonical source for the three-year annual history, gross margin trend, and risk-factor prose. Save the URL.
3. **Pull the most recent 10-Q and the most recent earnings press release from IR.** For the press release, prefer the "Financial Results" entry on the IR news page; the press release is the only place that has the freshly-stated quarterly numbers with a stated period ("quarter ended YYYY-MM-DD"). Save both URLs.
4. **Pull the current quote.** From MarketWatch or Yahoo Finance, capture price, market cap, shares outstanding, and trailing P/E together with the quote's as-of timestamp. Note the timestamp on the source page itself, not on the time you fetched the page.
5. **Compose the three packets.** Every number gets `source` (URL), `date` (ISO date the source was published or the as-of for quotes), and `sourceType` (e.g. `SEC 10-K filing`, `Company IR press release`, `Market quote`). For `qualitativePacket.*` arrays, the `fact` must be a single atomic statement — split combined claims into separate entries.
6. **Cross-check before handing off to preflight** (see 3.6).

#### 3.5 Source-aware copy discipline

These are the rules that make the difference between a packet that passes local audit on the first try and one that has 35/41 rejected evidence.

- **Units are non-negotiable.** Revenue, net income, free cash flow go in `USD millions` with the unit declared on the array or on the packet. Never write a single number without a unit somewhere visible to the auditor.
- **GAAP stays GAAP; non-GAAP stays non-GAAP.** If the company reports a non-GAAP EPS, the GAAP number goes into the packet and the non-GAAP value goes into `unknowns` with a one-line note. Do not mix them in the same array.
- **One period per fact.** A fact dated `2026-08-28` does not double as a fact for the trailing twelve months. If a derived value (e.g. TTM revenue) is required, compute it explicitly and note the formula.
- **Period labels are full.** `FY2027 Q2 (quarter ended 2026-07-26)` is acceptable. `Q2` alone is not.
- **No rounding at the packet layer.** Copy the number from the source verbatim, including cents if the source shows them and trailing zeros if the source omits them. The cloud review does not need rounded numbers; the local audit rejects rounded numbers because they no longer match the source byte-for-byte.
- **Quote timestamp beats fetch timestamp.** If the MarketWatch page says the price is as of `2026-09-03 20:00 UTC`, that is the timestamp the packet records. Do not substitute the moment you made the API call.
- **Do not summarize multi-element facts into one bullet.** A "moat" fact that bundles CUDA, gross margin, and a customer count is three facts, not one. Split.

#### 3.6 Cross-check before handoff (mandatory)

Run all five checks. Any failure goes to `unknowns` with a one-line note; the packet is not allowed to silently fail a check.

1. **Market cap reconciliation.** `price * sharesOutstanding` must be within ±2% of `marketCapUsd` as quoted. A 5%+ gap means one of the three numbers is wrong or stale; re-fetch and re-verify.
2. **Annual-history array lengths.** `fiscalYearEnd`, `revenue`, `netIncome`, `freeCashFlow` must all have the same length. A mismatch is almost always a missed year.
3. **Latest 10-K vs IR press release.** The FY-revenue figure on the IR press release must equal the FY-revenue figure in the 10-K to the dollar. If the press release was issued before the 10-K was filed, the 10-K is canonical and the press-release value goes to `unknowns`.
4. **Sources vs. period.** Every fact in `qualitativePacket.*` carries a `date`. The date must be inside the freshness window (see 3.7) for that field type. A risk-factor fact dated 18 months ago is stale and must be refreshed or downgraded to `unknowns`.
5. **Packet structure.** Each row has exactly three top-level keys: `identityPacket`, `financialPacket`, `qualitativePacket`. `tickerPacket` is the cloud-input wrapper key (used by the cogfoundry TemplateSpec) and must not appear as a key inside any of the three packets. The local audit treats a `tickerPacket.<field>` reference as a path that does not resolve, and any evidence pointing to one will be rejected.

#### 3.7 Freshness thresholds (enforced)

These are not guidelines; they are the thresholds the preflight script will block on. Treat them as release blockers.

| Field | Maximum age | Action on exceed |
|---|---:|---|
| `financialPacket.marketSnapshot.price` | 7 days | Hard fail in preflight; re-quote before running |
| `financialPacket.marketSnapshot.asOf` | 7 days | Hard fail in preflight |
| `identityPacket.dataAsOf` | 45 days | Hard fail in preflight |
| `qualitativePacket.*.date` (most facts) | 550 days | Soft fail; downgrade the entry or refresh |
| Source URL on a 10-K filing | 18 months since the 10-K's fiscal year end | Refresh or move to `unknowns`; do not present a stale 10-K as current |
| Source URL on a 10-Q filing | 6 months since the 10-Q's period end | Refresh or move to `unknowns` |

If a quote page shows a price older than 7 days, do not "make do" — the local preflight will block the run.

#### 3.8 Failure-mode playbook

- **No SEC CIK found.** Try the SEC EDGAR full-text company search at `https://efts.sec.gov/LATEST/search-index?q=%22{ticker}%22&forms=10-K`. If still nothing, ask the user to confirm the ticker is correct or that the company files with the SEC at all (some foreign issuers and OTC names do not).
- **Foreign issuer without US filings (e.g. ADR-only).** The tier-S filings may not exist. Fall back to the company's home-country regulator and add the URL to the `sources` array with a note. Move balance-sheet and segment-level fields to `unknowns` if the regulator does not publish in English.
- **SEC vs IR disagreement.** Default to SEC as canonical. Put the IR value in `unknowns` with one line: "IR press release dated YYYY-MM-DD said X; 10-K filed YYYY-MM-DD said Y; 10-K is canonical".
- **Quote page is reachable but stale.** Re-fetch once. If still stale, do not run — escalate to the user.
- **Company has no investor-relations page (rare for public US issuers).** Capture what is reachable; move the rest to `unknowns`. The cloud review can still work with a sparse packet, but the local audit will produce a `confidence: low` row and a `rejected` or `pass` decision with no deep-research eligibility.

#### 3.9 Walkthrough: NVDA real-data run (2026-09-04)

This is what a correct packet looks like end to end. The audit passed 51/51 evidence with `hallucination_risk: low`; the four-dimension score was 79/100.

1. EDGAR full-text → CIK `0001045810`, latest 10-K filed 2026-02-26 (FY2026, period end 2026-01-25), latest 10-Q filed within 6 months.
2. 10-K Item 6: FY2026 revenue `215,938` USD millions, net income `120,067`, free cash flow `96,575`, GAAP gross margin `71.1%`. Risk factors: hyperscaler concentration, China export controls, AI capex cycle.
3. IR press release Q4 FY2026 + Q2 FY2027 most recent. Q2 FY2027: revenue `96,221`, net income `59,688`, free cash flow `21,341`, period "quarter ended 2026-07-26".
4. MarketWatch quote: price `228.45` USD, as-of `2026-09-03T20:00:00Z`, TTM P/E `28.7`, market cap `5.41e12`, shares outstanding `24.1e9`.
5. Compose packets: `identityPacket` lists the EDGAR browse URL, IR news URL, and MarketWatch quote URL in `sources`. `financialPacket.annualHistory` carries the three-year array. `qualitativePacket.businessModel` carries the segment-list fact with `sourceType: "Company IR press release"`. `contraryEvidence` carries the TPU/Trainium and AMD/Intel competitive facts sourced to MarketWatch analyst commentary.
6. Cross-check: `228.45 * 24.1e9 ≈ 5.506e12` vs quoted `5.41e12` — within ±2% (the 1.7% gap is the legitimate book-vs-quote drift). Array lengths all 3. 10-K vs IR agrees. All `date` fields inside freshness window. No `tickerPacket.` prefix anywhere.

#### 3.10 Anti-pattern: the placeholder-fabrication run

Earlier in this Skill's history a placeholder run was sent through the cloud with `price: 125, pe: 65, revenue: [60922, 130497, 165000], netIncome: [..., 95000], freeCashFlow: [..., 70000]`. None of those numbers had a source URL on the page that was reachable. The local audit rejected 35/41 evidence, marked `hallucination_risk: high`, and the report was useless to a downstream reader who had no way to tell which lines were real. The cloud was not at fault; the packet was.

Lesson for the local Agent:

- Do not pad a packet with round numbers to "make the schema work". Empty arrays are honest; round numbers are a lie that the audit will eventually surface.
- If you cannot fetch a primary source, write the fact to `unknowns` and tell the user which fact and which source you tried.
- A row with 3 verified evidence and a clean `unknowns` list is more valuable than a row with 30 evidence and one fabricated number. The downstream user trusts the small one.

#### 3.11 Handoff checklist

Before invoking `scripts/prepare-market-input.mjs`, confirm:

- [ ] Every `source` URL is an HTTPS link that resolved at fetch time.
- [ ] Every `date` field is inside the freshness window in 3.7.
- [ ] Every `unit` is declared on the field or on the packet.
- [ ] GAAP / non-GAAP / TTM / as-reported are kept separate.
- [ ] All five cross-checks in 3.6 passed; failures moved to `unknowns`.
- [ ] The `unknowns` arrays are non-empty for any fact you could not verify. An empty `unknowns` on a real-world packet is a smell, not a feature.
- [ ] The MarketWatch / Yahoo `asOf` is a timestamp on the source page, not the time you fetched it.

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
