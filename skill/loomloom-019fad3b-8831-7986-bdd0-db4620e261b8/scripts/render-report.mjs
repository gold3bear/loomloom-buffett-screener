#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

function argsOf(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (["--input", "-i"].includes(argv[i])) args.input = argv[++i];
    else if (["--output", "-o"].includes(argv[i])) args.output = argv[++i];
    else if (["--help", "-h"].includes(argv[i])) args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

// M-2: escape Markdown and HTML-sensitive characters to prevent injection / visual spoofing
// in user- or cloud-supplied fields. Backslashes must be escaped first (they are the escape prefix).
function clean(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[*_`]/g, "\\$&")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, " ")
    .trim();
}
function list(values, empty = "none") { return values?.length ? values.map((value) => `- ${clean(typeof value === "string" ? value : JSON.stringify(value))}`).join("\n") : `- ${empty}`; }

function decisionLabel(value) {
  return { deep_research: "Enter human deep research", watchlist: "Watchlist", pass: "Skip this round" }[value] ?? value ?? "unknown";
}

function money(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
}
function pct(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
}
function modelVerdictLabel(value) {
  return {
    margin_of_safety_present: "model value above price by 30% or more",
    at_or_near_model_value: "price within 0-30% above model value",
    price_above_model_value: "price above model value",
    model_not_ready: "model not ready — assumptions incomplete",
    model_incomplete: "model incomplete",
    not_modeled: "no model supplied",
  }[value] ?? value ?? "unknown";
}

function preflightSummary(preflight) {
  if (!preflight) return "";
  if (preflight.ready) {
    const checks = preflight.summary?.checks;
    return `- Cloud preflight: passed${typeof checks === "number" ? ` (${checks} checks)` : ""}\n`;
  }
  const findings = (preflight.findings ?? []).filter((finding) => finding.severity === "error");
  return `### Cloud preflight\n\n- ready: false\n${list(findings.map((finding) => `${finding.code} at ${finding.path}: ${finding.message}`), "no error detail returned")}\n\n`;
}

function modelSection(model, audit) {
  if (!model) return "";
  const lines = ["### Investment model (three-statement + DCF)", ""];
  const baseName = model.baseScenario || "base";
  const base = model.scenarios?.[baseName];
  const summary = base?.summary ?? {};
  const mos = summary.marginOfSafetyPct;
  const verdict = !model.model_ready
    ? "model_not_ready"
    : typeof mos !== "number"
      ? "model_incomplete"
      : mos >= 0.3
        ? "margin_of_safety_present"
        : mos >= 0
          ? "at_or_near_model_value"
          : "price_above_model_value";
  lines.push(`- Model status: ${model.model_ready ? "ready" : "NOT ready"}; engine: ${clean(model.engineVersion)}; units: ${clean(model.units)}`);
  lines.push(`- Verdict: ${clean(modelVerdictLabel(verdict))}`);
  if (model.model_ready) {
    lines.push(`- Base scenario: ${clean(base?.label || baseName)}; model value per share: ${money(summary.valuePerShare)} ${clean(model.currency)}; current price: ${money(model.price)} ${clean(model.currency)}; margin of safety: ${pct(summary.marginOfSafetyPct)}`);
    lines.push(`- Enterprise value: ${money(summary.enterpriseValue)}; equity value: ${money(summary.equityValue)}; net debt: ${money(summary.netDebt)} (negative = net cash)`);
    lines.push(`- Terminal value: ${pct(summary.terminalPctOfEv)} of enterprise value (${clean(summary.terminalAssumption)})`);
    const scenarioOrder = ["bear", "base", "bull"];
    const scenarioLine = Object.entries(model.scenarios ?? {})
      .sort(([left], [right]) => {
        const leftIndex = scenarioOrder.indexOf(left.toLowerCase());
        const rightIndex = scenarioOrder.indexOf(right.toLowerCase());
        return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || left.localeCompare(right);
      })
      .map(([, scenario]) => `${clean(scenario.label)} ${money(scenario.summary?.valuePerShare)}`)
      .join(" | ");
    if (scenarioLine) lines.push(`- Scenario values per share: ${scenarioLine}`);
    if (model.reverseDcf?.solved) lines.push(`- Reverse DCF: the current price implies ${pct(model.reverseDcf.impliedAverageRevenueGrowth)} average explicit-period revenue growth`);
    const assumptions = model.assumptions?.scenarios?.[baseName];
    if (assumptions) {
      const growth = Array.isArray(assumptions.revenueGrowth) ? assumptions.revenueGrowth.map((value) => pct(value)).join(" / ") : "—";
      lines.push(`- Key drivers: WACC ${pct(assumptions.wacc)}; terminal growth ${pct(assumptions.terminalGrowth)}; revenue growth ${growth}; EBIT margin ${pct(Array.isArray(assumptions.ebitMargin) ? assumptions.ebitMargin[0] : assumptions.ebitMargin)}`);
    }
    const checks = (base?.checks ?? []).filter((check) => check.severity === "error");
    const passed = checks.filter((check) => check.passed).length;
    lines.push(`- Integrity checks: ${passed}/${checks.length} passed; accounting and cash-flow ties are recomputed locally`);
    const modelChecks = (model.modelChecks ?? []).filter((check) => check.severity === "error");
    if (modelChecks.length) {
      const modelPassed = modelChecks.filter((check) => check.passed).length;
      lines.push(`- Model invariants: ${modelPassed}/${modelChecks.length} passed (sensitivity center and reverse-DCF reproduction)`);
    }
  } else {
    if (model.missingInputs?.length) lines.push(`- Missing inputs: ${model.missingInputs.map(clean).join(", ")}`);
    if (model.errors?.length) lines.push(`- Model errors: ${model.errors.slice(0, 8).map((error) => `${clean(error.code)} (${clean(error.path)})`).join("; ")}`);
  }
  if (audit && audit.status !== "not_run") {
    const label = { matched: "matched the local recomputation", mismatch: "MISMATCH against the local recomputation", cloud_model_missing: "cloud model output not found; local model attached", local_reference_missing: "no local reference model; cloud output not independently verified" }[audit.status] ?? audit.status;
    lines.push(`- Cloud-vs-local audit: ${clean(label)}${audit.mismatches?.length ? ` — ${audit.mismatches.slice(0, 4).map(clean).join("; ")}` : ""}`);
  }
  if (model.warnings?.length) lines.push(`- Model warnings: ${model.warnings.slice(0, 6).map((warning) => `${clean(warning.code)} (${clean(warning.path)})`).join("; ")}`);
  lines.push(`- Workbook: ${model.model_ready ? "generated (xlsx artifact in the cloud run; local runner writes model.xlsx)" : "not generated"}`);
  lines.push("");
  lines.push("Model values are deterministic outputs of the supplied assumptions. They are not target prices, return forecasts, or buy/sell instructions.");
  return `${lines.join("\n")}\n\n`;
}

function rowSection(row) {
  if (!row.valid) return `## ${row.ticker || `Row ${row.rowIndex + 1}`}: local validation rejected\n\n${list(row.errors, "no error detail returned")}\n\n${preflightSummary(row.cloud_preflight)}${modelSection(row.investment_model, row.model_audit)}`;
  const summaries = row.review_summaries ?? {};
  const evidence = (row.verified_evidence ?? []).map((item) => `${item.evidence_id} | ${item.claim} (${item.source_ref} = ${JSON.stringify(item.source_value)}, ${item.period}, ${item.unit})`);
  const rejected = (row.rejected_evidence ?? []).map((item) => `${item.claim || "unnamed claim"}: ${item.reason}`);
  const falsifiers = (row.falsification_conditions ?? []).map((item) => `${item.condition}; action: ${item.action}; source: ${item.source_ref} = ${JSON.stringify(item.source_value)}`);
  return `## ${row.ticker} | ${clean(row.company_name)}\n\n` +
    `- Decision tier: ${decisionLabel(row.decision)}\n` +
    `- Overall score: ${row.overall_score}/100; confidence: ${row.confidence}\n` +
    `- Current price: ${row.price ?? "unknown"} ${clean(row.price_currency)} (${clean(row.price_as_of) || "timestamp unknown"})\n` +
    `- Fiscal period: ${clean(row.fiscal_period) || "unknown"}; data as of: ${clean(row.data_as_of) || "unknown"}\n` +
    `- Local audit: ${row.audit_status}; hallucination risk: ${row.hallucination_risk}; format: ${row.validationStatus}\n` +
    `${preflightSummary(row.cloud_preflight)}\n` +
    `${modelSection(row.investment_model, row.model_audit)}` +
    `### Four-dimension summary\n\n` +
    `- Business model & circle of competence: ${clean(summaries.business)}\n` +
    `- Moat & capital allocation: ${clean(summaries.moat)}\n` +
    `- Financial quality: ${clean(summaries.financial)}\n` +
    `- Valuation & margin of safety: ${clean(summaries.valuation)}\n\n` +
    `### Verified evidence\n\n${list(evidence)}\n\n` +
    `### Rejected claims\n\n${list(rejected)}\n\n` +
    `### Veto items\n\n${list(row.veto_items)}\n\n` +
    `### Unknowns\n\n${list(row.unknowns)}\n\n` +
    `### Falsification & re-run conditions\n\n${list(falsifiers)}\n`;
}

export function renderReport(report) {
  if (!report || !Array.isArray(report.rows)) throw new Error("input must be a local audit JSON");
  const generatedAt = new Date().toISOString();
  const ranked = report.ranking?.length
    ? `| Rank | Ticker | Overall score | Confidence |\n|---:|---|---:|---|\n${report.ranking.map((item) => `| ${item.rank} | ${item.ticker} | ${item.overall_score} | ${item.confidence} |`).join("\n")}`
    : "No ticker in this batch passed all evidence and veto rules to enter the deep-research ranking.";
  const overview = report.rows.map((row) => {
    const base = row.investment_model?.scenarios?.[row.investment_model?.baseScenario];
    const value = base?.summary?.valuePerShare;
    return `| ${row.ticker || `row${row.rowIndex + 1}`} | ${row.valid ? decisionLabel(row.decision) : "locally rejected"} | ${row.overall_score ?? "—"} | ${row.price ?? "—"} ${clean(row.price_currency)} | ${clean(row.price_as_of) || "—"} | ${value === undefined ? "—" : money(value)} | ${pct(base?.summary?.marginOfSafetyPct)} | ${row.audit_status ?? "—"} |`;
  }).join("\n");
  return `# LoomLoom US Equity Long-Term Value Batch Screening Report\n\n` +
    `> Generated at: ${generatedAt}. This report is research aid only. It is not investment advice and does not include target prices, position sizes, or buy/sell instructions.\n\n` +
    `## Batch summary\n\n` +
    `- Tickers: ${report.summary?.totalRows ?? report.rows.length}\n` +
    `- Locally accepted: ${report.summary?.acceptedRows ?? 0}\n` +
    `- Locally rejected: ${report.summary?.rejectedRows ?? 0}\n` +
    `- Eligible for deep-research ranking: ${report.summary?.decisionEligibleRows ?? 0}\n` +
    `- Modeled rows: ${report.summary?.modeledRows ?? 0}; model-ready rows: ${report.summary?.modelReadyRows ?? 0}; cloud/local model mismatches: ${report.summary?.modelMismatchRows ?? 0}\n\n` +
    `| Ticker | Decision tier | Overall score | Current price | Price timestamp | Model value/share | Model MOS | Local audit |\n|---|---|---:|---:|---|---:|---:|---|\n${overview}\n\n` +
    `## Deep-research priority\n\n${ranked}\n\n` +
    `${report.rows.map(rowSection).join("\n")}\n` +
    `## Use limits\n\n` +
    `The cloud model runs the parallel review; the local program is responsible for evidence matching, hard vetos, and deterministic ranking. Local validation only confirms that conclusions respect the data already provided — it is NOT a substitute for human review of SEC filings, company disclosures, market prices, and accounting conventions.\n\n` +
    `The investment model is a deterministic projection of the assumptions supplied with the packet. If any driver is missing, the model refuses to run rather than defaulting a discount rate or growth rate. A model value is conditional arithmetic, not a target price, and it does not incorporate information that is not in the packet or the assumption file.\n`;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (args.help) return process.stdout.write("node scripts/render-report.mjs --input <local-audit.json> --output <report.md>\n");
  if (!args.input || !args.output) throw new Error("--input and --output are both required");
  const report = JSON.parse(await readFile(args.input, "utf8"));
  await writeFile(args.output, renderReport(report), "utf8");
  process.stdout.write(`Report generated: ${args.output}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { process.stderr.write(`report render error: ${error.message}\n`); process.exitCode = 2; });
