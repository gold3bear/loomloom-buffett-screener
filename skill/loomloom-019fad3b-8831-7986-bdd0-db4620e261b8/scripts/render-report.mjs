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

function rowSection(row) {
  if (!row.valid) return `## ${row.ticker || `Row ${row.rowIndex + 1}`}: local validation rejected\n\n${list(row.errors, "no error detail returned")}\n`;
  const summaries = row.review_summaries ?? {};
  const evidence = (row.verified_evidence ?? []).map((item) => `${item.evidence_id} | ${item.claim} (${item.source_ref} = ${JSON.stringify(item.source_value)}, ${item.period}, ${item.unit})`);
  const rejected = (row.rejected_evidence ?? []).map((item) => `${item.claim || "unnamed claim"}: ${item.reason}`);
  const falsifiers = (row.falsification_conditions ?? []).map((item) => `${item.condition}; action: ${item.action}; source: ${item.source_ref} = ${JSON.stringify(item.source_value)}`);
  return `## ${row.ticker} | ${clean(row.company_name)}\n\n` +
    `- Decision tier: ${decisionLabel(row.decision)}\n` +
    `- Overall score: ${row.overall_score}/100; confidence: ${row.confidence}\n` +
    `- Current price: ${row.price ?? "unknown"} ${clean(row.price_currency)} (${clean(row.price_as_of) || "timestamp unknown"})\n` +
    `- Fiscal period: ${clean(row.fiscal_period) || "unknown"}; data as of: ${clean(row.data_as_of) || "unknown"}\n` +
    `- Local audit: ${row.audit_status}; hallucination risk: ${row.hallucination_risk}; format: ${row.validationStatus}\n\n` +
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
  const overview = report.rows.map((row) => `| ${row.ticker || `row${row.rowIndex + 1}`} | ${row.valid ? decisionLabel(row.decision) : "locally rejected"} | ${row.overall_score ?? "—"} | ${row.price ?? "—"} ${clean(row.price_currency)} | ${clean(row.price_as_of) || "—"} | ${row.audit_status ?? "—"} |`).join("\n");
  return `# LoomLoom US Equity Long-Term Value Batch Screening Report\n\n` +
    `> Generated at: ${generatedAt}. This report is research aid only. It is not investment advice and does not include target prices, position sizes, or buy/sell instructions.\n\n` +
    `## Batch summary\n\n` +
    `- Tickers: ${report.summary?.totalRows ?? report.rows.length}\n` +
    `- Locally accepted: ${report.summary?.acceptedRows ?? 0}\n` +
    `- Locally rejected: ${report.summary?.rejectedRows ?? 0}\n` +
    `- Eligible for deep-research ranking: ${report.summary?.decisionEligibleRows ?? 0}\n\n` +
    `| Ticker | Decision tier | Overall score | Current price | Price timestamp | Local audit |\n|---|---|---:|---:|---|---|\n${overview}\n\n` +
    `## Deep-research priority\n\n${ranked}\n\n` +
    `${report.rows.map(rowSection).join("\n")}\n` +
    `## Use limits\n\n` +
    `The cloud model runs the parallel review; the local program is responsible for evidence matching, hard vetos, and deterministic ranking. Local validation only confirms that conclusions respect the data already provided — it is NOT a substitute for human review of SEC filings, company disclosures, market prices, and accounting conventions.\n`;
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
