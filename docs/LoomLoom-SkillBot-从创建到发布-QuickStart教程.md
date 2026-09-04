# Ship a LoomLoom SkillBot end-to-end with Codex — no code required

## Case study: a Buffett-style US equity screening SkillBot

Picking stocks is a long-running pain point for many investors: among tens of thousands of US equities, how do you narrow the field quickly to a small set that is worth deeper research?

The goal of this case study is to move that work into office-context Agents such as WorkBuddy, Codex, Claude Code, and OpenClaw. The user only supplies ticker codes, a CSV/Excel file, or a standardized financial metrics table; the Agent performs the batch screening.

The mechanism: a local Agent first prepares auditable, verifiable facts for each ticker; then LoomLoom runs a parallel batch review in the cloud; finally a local validator rejects unsourced, unverifiable, or input-exceeding conclusions and outputs a research priority that is reproducible and falsifiable.

Humans do not write code. They only do four things:

1. Describe the problem to be solved.
2. Choose the product approach.
3. Provide business materials or authorize the Agent to collect public materials.
4. Explicitly confirm the high-impact operations: create, paid run, publish.

Everything else — workflow design, TemplateSpec, scripts, tests, cloud calls, GitHub and the website — is done by Codex.

Case study deliverables:

- LoomLoom Market Listing: `019fad3b-8831-7986-bdd0-db4620e261b8`
- GitHub source: [gold3bear/loomloom-us-value-screening-skill](https://github.com/gold3bear/loomloom-us-value-screening-skill)
- GitHub Release: [v2.0.0](https://github.com/gold3bear/loomloom-us-value-screening-skill/releases/tag/v2.0.0)
- Product page: [GitHub Pages](https://gold3bear.github.io/loomloom-us-value-screening-skill/)

> This case study is research aid only. It is not investment advice and produces no target prices, position sizes, or buy/sell instructions.

---

## Step 0 — Install LoomLoom and run `doctor`

### What you tell Codex

> Please install LoomLoom in this project: source is https://github.com/Cogfoundry-labs/loomloom or https://gitee.com/cogfoundry/loomloom. Server: https://loomloom.shengsuanyun.com/loom/v1. Token is `<replace with your own ShengSuanyun key>`. After install, run `loomloom doctor` once to verify.

### What Codex does

- Prefers GitHub for the install; falls back to Gitee if GitHub is unreachable.
- Points the Server to `https://loomloom.shengsuanyun.com/loom/v1`.
- Stores your ShengSuanyun token securely without writing the real value into the tutorial, the logs, or the report.
- Runs `loomloom doctor --output json`.
- Checks the CLI, Server, platform availability, and credential wiring.
- If anything is wrong, Codex diagnoses from the `doctor` output and fixes it before moving on.

> Note: the same install prompt is published on the [LoomLoom website](https://www.shengsuanyun.com/loomloom). Always keep the token as a placeholder in tutorials and replace it with your own at runtime.

---

## Step 1 — Tell Codex the pain point

### What you tell Codex

> I want a Buffett-style US equity value screening tool. I will feed in dozens or hundreds of tickers and want the cloud to call LLMs in batch to surface the companies that are worth deeper research. Final results must be evidence-backed and reviewable. No buy/sell advice.

### What Codex does

Codex first turns the fuzzy idea into a product goal:

- One row = one ticker.
- Inputs can be ticker codes, CSV, Excel, or a standardized financial metrics table.
- The cloud reviews business model, moat, capital allocation, financial quality, and valuation in parallel.
- The local Agent is responsible for data preparation, evidence audit, hard vetos, and reporting.
- The final output is a research priority, never a "buy" recommendation.

Codex also identifies the safety boundaries: prices must carry a timestamp, financial data must carry a period, and every key conclusion must trace back to its original source.

---

## Step 2 — Choose between a standard preset and a custom build

### What you tell Codex

> Pick the standard preset. End users only fill in tickers or financial data; the research method and review dimensions are baked into the template.

### What Codex does

Codex pins the usage mode to "standard preset":

- End users do not need to understand prompts, step IDs, or model parameters.
- The research framework is fixed in the template.
- Every ticker uses the same evidence definition.
- Each ticker is processed independently, suitable for batch execution.
- The fixed research dimensions can run in parallel on the cloud.

The key here: when the number of tickers is dynamic, the template treats one row as one ticker instead of generating arbitrary steps dynamically.

---

## Step 3 — Define the input data

### What you tell Codex

> Use the standardized financial metrics table. One row per ticker, with revenue, profit, free cash flow, ROE, debt, valuation, etc. The local Agent can supplement identity, price timestamp, business model, moat, management, and risk evidence.

### What Codex does

Codex organizes the input into three packets:

- `identityPacket`: ticker, company name, industry, data-as-of date, fiscal period, and sources.
- `financialPacket`: price timestamp, historical financials, cash flow, capital returns, balance sheet, share count, and valuation.
- `qualitativePacket`: business model, moat, management, capital allocation, risks, contrary evidence, and unknowns.

Codex prefers SEC filings, company IR materials, and other verifiable primary sources, and it keeps GAAP and adjusted figures separate.

Humans do not hand-author these JSONs. Codex generates them from tickers or a table.

---

## Step 4 — Have Codex design the LoomLoom workflow

### What you tell Codex

> Based on the goals above, design a TemplatePlan. Each ticker needs parallel multi-dimensional review, then aggregation into a structured result. Show me the business plan first; do not create a cloud template yet.

### What Codex does

Codex first outputs a business-language TemplatePlan that covers:

- Template name and goal.
- What a single row represents.
- User input fields.
- Responsibility of each research step.
- Which steps run in parallel and which aggregate.
- Intermediate and final outputs.
- Failure handling for upstream steps.
- Default model and usage.

Codex only designs here — it does not create a remote template.

This is the first important confirmation point. Codex only moves on once you accept the TemplatePlan.

---

## Step 5 — Generate and validate the TemplateSpec

### What you tell Codex

> TemplatePlan confirmed. Generate a TemplateSpec and check it locally. If the check passes, tell me the result first — do not create a cloud template directly.

### What Codex does

Codex:

1. Reads the TemplateSpec spec shipped with the current LoomLoom CLI.
2. Queries the currently available models instead of guessing model IDs.
3. Generates the TemplateSpec.
4. Checks field types, input transport, dependencies, and output structure.
5. Runs local `template-spec check`.
6. Reports the template's purpose and the check result in business language.

If the check fails, Codex fixes and re-runs — humans never edit the JSON by hand.

Creating a remote template is a persistent operation, so Codex must wait for confirmation again.

---

## Step 6 — Confirm creating the private template

### What you tell Codex

> Confirmed, create the private template.

### What Codex does

Codex runs the template creation and saves the returned:

- `template_id`
- `version_id`
- template name and the current version state.

Future changes never overwrite history; Codex creates a new version and saves a fresh `version_id`.

---

## Step 7 — Test with real tickers

### What you tell Codex

> Test AAPL, COST, and UAL first. The local Agent prepares the data, runs validation and quoting, shows me the fees, then waits for confirmation.

### What Codex does

Codex:

1. Collects or arranges identity, price, financial, and business evidence for the three tickers.
2. Aligns the data-as-of and fiscal period.
3. Tags anything that cannot be confirmed as unknown.
4. Runs the local preflight.
5. Generates the LoomLoom request.
6. Fetches the server quote.
7. Shows task count, currency, estimated cost, balance status, and the major data risks.
8. Stops and waits for your confirmation.

Fetching a quote is not authorization to run. Even if you say "go test it", Codex still surfaces the current quote first.

---

## Step 8 — Confirm the paid run

### What you tell Codex

> Confirmed, run at the quoted price.

### What Codex does

Codex generates a new `client-request-id` for this confirmation, then:

- Submits the cloud run.
- Saves `runTransactionId` and `runId`.
- Waits for completion.
- Pulls the full result.
- Keeps successful rows and failed items.
- Queries the actual cost or transaction state.
- Delivers the run result.

If tickers, data, files, Listing, or quote change after the confirmation, Codex reminds you:

> The input changed after confirmation, so the estimate and confirmation need to be redone.

It never reuses an old confirmation to run new input.

---

## Step 9 — Have Codex add a local hard validator

### What you tell Codex

> Cloud output cannot become a conclusion on its own. Implement a local hard validator that rejects unsourced numbers, broken references, stale prices, mismatched fiscal periods, missing research dimensions, and any input-external target price. Support re-run after a fix.

### What Codex does

Codex writes and tests local scripts:

- `preflight.mjs` — pre-run data hard validation
- `prepare-market-input.mjs` — generate the public Market input
- `merge-public-results.mjs` — clean up the cloud format and audit evidence
- `render-report.mjs` — produce the final Markdown report
- matching automated tests

v2 test coverage includes:

- References that cannot map back to the original input
- Missing research dimensions
- Unauthorized target prices
- Stale prices
- Fiscal-period mismatches
- Documented unknowns downgraded instead of fabricated
- JSON cleanup inside Markdown code fences
- Price, evidence, and falsification conditions in the report

The Skill now passes **34 / 34** local tests. Humans do not write or edit test code.

---

## Step 10 — Produce the research report

### What you tell Codex

> Synthesize the cloud output and the local audit into a complete report, preserving price timestamp, evidence, vetos, unknowns, and conclusion-invalidation conditions.

### What Codex does

Codex buckets the tickers into:

- `deep_research` — worth a human deep dive
- `watchlist` — keep observing
- `pass` — skip this round
- `rejected` — local structure or evidence check failed; not ranked

The final report is a research priority, not a buy/sell recommendation. Every conclusion names the new fact that would invalidate it.

---

## Step 11 — Publish to the LoomLoom Market

### What you tell Codex

> Publish the successfully run private template version to the public Market SkillBot at ¥0.2 per task. Explain what will happen first; wait for my confirmation before publishing.

### What Codex does

Codex first confirms:

- Target private template and version.
- The version has run successfully at least once.
- Public display name.
- Per-task price.
- After publish the Listing goes into review — it is not guaranteed to go live immediately.

Codex waits for your explicit "publish" confirmation, submits the Market review, and saves the `reviewRequestId`. It can then poll the review and Listing status.

Publish, price change, version switch, unlist, relist, and review withdrawal all require fresh explicit confirmation.

---

## Step 12 — Generate the local Agent Skill

### What you tell Codex

> Install the public SkillBot as a Codex-compatible local Skill, including the data preparation, hard validation, result merge, and report generation we just built. Preview the install first, then wait for my confirmation.

### What Codex does

Codex first runs an install preview and shows:

- The generated Skill name.
- Source Listing ID.
- How the Skill binds to the Market Listing.
- Target Agent.
- The full install directory.
- The major input fields.
- Every real run still requires quote + confirmation.

Only after you confirm does Codex write the local files.

The generated directory must use the `loomloom-` prefix and exactly match the `skillName` returned by the preview. It should not be renamed casually.

Installing the local Skill does NOT create a paid cloud task.

---

## Step 13 — Verify the Skill from scratch in WorkBuddy

### Why this step matters

After a Skill is installed locally, you must verify that the full end-to-end flow works — from LoomLoom CLI readiness, through data prep, to cloud call and local audit. The cleanest way is to start from scratch: uninstall the existing `loomloom` binary, follow SKILL.md to install it again, and run a real-ticker screening end to end.

This step surfaces two classes of issue:

1. **Is the SKILL.md install guide self-contained?** — A fresh environment with only SKILL.md available must be able to install the LoomLoom CLI.
2. **Compatibility between local scripts and real cloud payloads** — Passing mock-data tests in development does NOT mean real cloud responses will pass.

### What you tell WorkBuddy

> I want to verify this Skill from scratch. First uninstall the local `loomloom` binary, then run `loomloom-us-value-screening` to see whether SKILL.md's install guide can lead you to reinstall the LoomLoom CLI and run a complete AAPL/COST/UAL screening.

### What WorkBuddy does

WorkBuddy:

1. **Uninstalls the LoomLoom CLI**: removes the existing `loomloom` binary and confirms `which loomloom` returns nothing.
2. **Runs the Skill**: invokes `loomloom-us-value-screening` and reads the workflow definition in SKILL.md.
3. **Readiness check**: notices `loomloom` is missing and follows SKILL.md to clone the repo, run the installer, and set up environment variables.
4. **Runs `doctor`**: confirms CLI, Server connectivity, and credential wiring.
5. **Executes the full screening**: walks through the 8-step workflow for AAPL/COST/UAL — packet construction, preflight, quote, confirmation, cloud run, local audit, report.

### Three real bugs surfaced during this case

When WorkBuddy fed real cloud responses into the local audit script, three compatibility gaps that the development fixtures never hit came up:

**Issue 1 — `inputJson` `steps` shape was not parseable**

The cloud returned `inputJson` using a nested `steps` structure, where each step's `prompt` field embeds the IDENTITY / FINANCIAL / QUALITATIVE three JSON packets as text. The local merger `merge-public-results.mjs` only supported a flat top-level `{identityPacket, financialPacket, qualitativePacket}` shape.

Result: all three tickers' input data failed to parse; local audit rejected everything.

Fix: added `stepsToInput()` and `extractPacketFromPrompt()`. They auto-detect the `steps` shape and extract the three packet JSONs from the prompt by label. `parseInput()` now handles both shapes.

**Issue 2 — `source_value` strict matching wrongly rejected evidence**

The local validator compared `source_value` against the input via strict `JSON.stringify` equality. But the cloud LLM sometimes:

- Wrote only the derived result in `source_value` rather than the full formula (e.g. input was `"61166/76448 = 80.0%"`, cloud wrote just `"80.0%"`)
- Or the reverse: input was a formula and cloud wrote only the result

Result: UAL was rejected as "reference cannot be mapped to original input" because multiple `source_value` strings were not byte-equal.

Fix: `same()` now has a three-layer loose-match pass:

1. **Substring containment** — the input value is a substring of `source_value`, or vice versa.
2. **Formula-result extraction** — when one side has `= result` form, the part after the last `=` is compared with the other side.
3. **Numeric token boundary match** — a number appearing as a standalone token in the string is considered a match.

**Issue 3 — Multi-`=` formulas broke extraction**

Derived-metric formulas often contain several `=` signs (e.g. `"7837/(966.58*443.2) = 7837/428552 = 1.83%"`). The Issue 2 first-cut used `/=\s*(.+?)\s*$/` and grabbed everything after the first `=`, still failing to match the cloud's plain `"1.83%"`.

Fix: switched to `/=\s*([^=]+?)\s*$/` to extract the part after the **last** `=`.

### Verification outcome

After the fixes, every test and the real cloud data pass:

| Metric | Before fixes | After fixes |
|---|---|---|
| Rejected rows | 1 (UAL) | 0 |
| Rejected evidence | 3+ | 0 |
| Pre-processing script needed | Yes (a temporary Python script) | No |
| Test pass rate | 12 / 12 | 34 / 34 |

All three tickers pass audit. The remaining veto items are business decisions (AAPL valuation too rich, COST weak balance sheet, UAL evidence insufficient for a valuation judgment), not data-format issues. The raw cloud output is now processed directly, with no extra pre-processing script.

> The real value of this step: a from-scratch install proves that SKILL.md's install guide is complete, while real cloud data exposes the gaps between local scripts and cloud shape. Mock data never triggers these issues — only a real cloud response does.

---

## Step 14 — Package and publish to GitHub

### What you tell Codex

> Create a public GitHub repository under the MIT license. The repo holds the front-end page and reviewable source; the Skill ZIP goes into a GitHub Release. Do not commit the ZIP as ordinary source.

### What Codex does

Codex:

1. Verifies and installs the GitHub CLI.
2. Walks you through a GitHub login.
3. Creates an isolated Git repository.
4. Organizes README, LICENSE, the page, the poster, and the Skill source.
5. Runs the full test suite.
6. Commits and pushes `main`.
7. Creates a GitHub Release.
8. Uploads the ZIP as a release asset.
9. Verifies the release asset summary.
10. Confirms the repository contains source only.

This case's repo:

<https://github.com/gold3bear/loomloom-us-value-screening-skill>

---

## Step 15 — Build the GitHub Pages product page

### What you tell Codex

> Design a dedicated front-end page for this Skill and publish it via GitHub Pages. The mobile first viewport MUST show the "Download Skill" button. The download link must point to the latest release.

### What Codex does

Codex:

- Brand theme and page copy.
- Responsive HTML / CSS / JavaScript.
- Poster and above-the-fold structure.
- Desktop and mobile screenshot review.
- CTA visibility and horizontal-overflow check.
- GitHub Pages configuration.
- Release download-link verification.
- Page update and re-deploy.

Two real issues surfaced during this case:

1. The mobile poster landed above the title, pushing the CTA off the first viewport.
2. After the ZIP moved to the Release, the page still pointed at the site root, breaking the download.

Codex fixed both with screenshot diagnosis, responsive tweaks, and the stable Release URL.

Final page:

<https://gold3bear.github.io/loomloom-us-value-screening-skill/>

---

## Step 16 — Write a user-paste-ready QuickStart prompt

### What you tell Codex

> Reference the Skill's real flow to produce a prompt that end users can paste into WorkBuddy, Codex, Claude Code, or OpenClaw. It must check the install first, then run preflight, quote, confirm, cloud call, and local audit.

### What Codex does

Codex generates a paragraph like the following and embeds it behind a copy button on the page:

```text
First check whether this Skill is installed:
https://github.com/gold3bear/loomloom-us-value-screening-skill

If it is not yet installed, download and install it from the GitHub Release. Then use the installed "US Equity Long-Term Value Batch Screening" Skill and strictly follow its SKILL.md.

Analyze the US tickers I provide, or the CSV/Excel/standard financial metrics table I upload. First check that the LoomLoom CLI is ready; if it is not, follow the Skill's install guide, install the CLI, and run `loomloom doctor`.

Next, locally prepare, fill, and validate the data, then run preflight. Once preflight passes, generate the Market request and fetch the server quote. Show me the task count, currency, estimated cost, data-as-of time, and the main risks. Wait for my explicit confirmation in the current conversation before calling the cloud.

When the run completes, perform local evidence audit, hard-veto review, and ranking, then deliver an auditable Markdown report. Do not output target prices, position sizes, or buy/sell instructions.
```

---

## The full set of human input lines

If you compress the whole project to its shortest, the human mainly said:

1. "I want a Buffett-style US equity batch screening tool."
2. "Pick the standard preset."
3. "Use the standardized financial metrics table; the local Agent supplements the data."
4. "TemplatePlan confirmed; generate and check the TemplateSpec."
5. "Confirmed, create the private template."
6. "Test AAPL, COST, UAL; quote first, then confirm."
7. "Confirmed, run at this quote."
8. "Implement the local hard validator and re-test."
9. "Confirmed, publish to the public Market SkillBot at ¥0.2 / task."
10. "Confirmed, install the local Skill."
11. "Verify the Skill from scratch: uninstall loomloom, reinstall, run a full AAPL/COST/UAL screening."
12. "Package the ZIP and create a public MIT GitHub repository."
13. "Create the product page and publish to GitHub Pages."

None of these lines asked the human to write code.

---

## Everything Codex carried in the background

Codex handled:

- Business-need clarification.
- TemplatePlan and TemplateSpec.
- Model and input-contract checks.
- Cloud template creation and version management.
- Ticker data preparation.
- Quote and confirmation gates.
- LoomLoom cloud execution and result retrieval.
- Local validator, parser, and report generator.
- Automated tests.
- Agent Skill design, install, and packaging.
- From-scratch install-guide validation and cloud-compatibility fix.
- Git, GitHub CLI, repository, Release, and Pages.
- Poster, page, responsive UI, and screenshot review.
- README, QuickStart, and tutorial docs.

---

## Human confirmation points that must remain

"No code required" is not "Codex can do everything without confirmation." The following actions still require human confirmation:

- Creating or upgrading a remote template.
- Running paid tasks at the server's quoted price.
- Re-quoting after the input changes.
- Publishing, changing price, or switching the Market Listing version.
- Unlisting, relisting, or withdrawing a review.
- Installing or uninstalling a local Skill.
- Creating a public GitHub repository and publishing content.

These confirmations are a product safety mechanism, not a technical barrier.

---

## Final conclusion

With Codex, non-engineers can turn a business idea into a complete LoomLoom product:

```text
business idea
→ TemplatePlan
→ TemplateSpec
→ private template test
→ Market SkillBot
→ local Agent Skill
→ from-scratch verification + cloud-compat fix
→ local validator
→ GitHub Release
→ GitHub Pages
→ user-paste-ready prompt
```

The truly reusable method of this case:

> LoomLoom handles parallel cloud batch research. Codex turns business language into workflow and code. The local Agent owns data, evidence, fees, confirmation, and judgment boundaries.

Humans do not have to code. They only need to articulate the goal and make the right choices before high-impact operations.
