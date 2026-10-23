import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeResults } from "./merge-public-results.mjs";
import { renderReport } from "./render-report.mjs";
import { runModel } from "./run-model.mjs";
import { syncTemplate } from "./sync-model-code.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const TEMPLATE = path.join(REPO_ROOT, "templates", "buffett-four-filters-model.cogfoundry", "template.json");

const input = {
  identityPacket: { ticker: "AAPL", companyName: "Apple Inc.", fiscalPeriod: "FY2025", dataAsOf: "2026-09-01" },
  financialPacket: { marketSnapshot: { price: 200, currency: "USD", asOf: "2026-09-01", pe: 25 }, metrics: { revenue: 100, fcf: 20, debt: 10, pe: 25 } },
  qualitativePacket: {},
};

function evidence(claim, source_ref, source_value) {
  return [{ claim, source_ref, source_value, period: "FY2025", unit: "USD" }];
}

function reviews() {
  return [
    { business_model_score: 80, understandability_score: 80, circle_of_competence: "pass", evidence_records: evidence("revenue", "financialPacket.metrics.revenue", 100), positive_points: [], contrary_points: [], unknowns: [], summary: "Clear business" },
    { moat_score: 80, management_culture_score: 80, capital_allocation_score: 80, evidence_records: evidence("fcf", "financialPacket.metrics.fcf", 20), positive_points: [], contrary_points: [], governance_red_flags: [], unknowns: [], summary: "Stable moat" },
    { financial_quality_score: 80, cash_flow_quality_score: 80, balance_sheet_score: 80, evidence_records: evidence("debt", "financialPacket.metrics.debt", 10), positive_points: [], contrary_points: [], accounting_red_flags: [], survival_risks: [], unknowns: [], summary: "Healthy" },
    {
      valuation_score: 80, margin_of_safety_score: 80, judgment_state: "eligible_for_manual_deep_research",
      evidence_records: evidence("pe", "financialPacket.metrics.pe", 25),
      validity_basis: [
        { claim: "price", source_ref: "financialPacket.marketSnapshot.price", source_value: 200, period: "2026-09-01", unit: "USD" },
        { claim: "period", source_ref: "identityPacket.fiscalPeriod", source_value: "FY2025", period: "FY2025", unit: "text" },
      ],
      falsification_conditions: [
        { condition: "price", source_ref: "financialPacket.marketSnapshot.price", source_value: 200, period: "2026-09-01", unit: "USD", action: "rerun_required" },
        { condition: "period", source_ref: "identityPacket.fiscalPeriod", source_value: "FY2025", period: "FY2025", unit: "text", action: "conclusion_invalidated" },
      ],
      positive_points: [], contrary_points: [], valuation_red_flags: [], forbidden_numeric_claims: [], unknowns: [], summary: "Open to research",
    },
  ];
}

function model(overrides = {}) {
  return {
    schemaVersion: "loomloom-investment-model/v1",
    engineVersion: "1.1.0",
    ticker: "AAPL",
    companyName: "Apple Inc.",
    asOf: "2026-09-01",
    price: 200,
    currency: "USD",
    units: "USD millions",
    model_ready: true,
    baseScenario: "base",
    missingInputs: [],
    errors: [],
    warnings: [],
    assumptions: { scenarios: { base: { wacc: 0.085, terminalGrowth: 0.025, revenueGrowth: [0.04, 0.04, 0.04], ebitMargin: [0.3, 0.3, 0.3] } } },
    scenarios: { base: { label: "Base", summary: { valuePerShare: 250, enterpriseValue: 1000, equityValue: 900, marginOfSafetyPct: 0.2 }, checks: [{ name: "balanceSheetBalances", severity: "error", passed: true, detail: "ok" }] } },
    sensitivity: { valuesPerShare: [[240, 250], [230, 240]] },
    reverseDcf: { solved: true, impliedAverageRevenueGrowth: 0.06 },
    ...overrides,
  };
}

function payload({ cloudModel } = {}) {
  const artifacts = reviews().map((value, index) => ({ opaqueId: `artifact-${index}`, inlineText: JSON.stringify(value) }));
  if (cloudModel) artifacts.push({ opaqueId: "model", inlineText: JSON.stringify(cloudModel) });
  return {
    rows: [{
      rowIndex: 0,
      status: "completed",
      inputJson: JSON.stringify(Object.fromEntries(Object.entries(input).map(([key, value]) => [key, JSON.stringify(value)]))),
      artifacts,
    }],
  };
}

test("attaches the local model and marks the verdict", () => {
  const report = mergeResults(payload(), { models: { AAPL: model() } });
  const row = report.rows[0];
  assert.equal(row.investment_model.ticker, "AAPL");
  assert.equal(row.model_verdict, "at_or_near_model_value");
  assert.equal(row.model_audit.status, "cloud_model_missing");
  assert.equal(report.summary.modeledRows, 1);
  assert.equal(report.summary.modelMismatchRows, 0);
});

test("matches cloud and local model outputs", () => {
  const report = mergeResults(payload({ cloudModel: model() }), { models: { AAPL: model() } });
  assert.equal(report.rows[0].model_audit.status, "matched");
  assert.ok(!report.rows[0].veto_items.includes("model_recompute_mismatch"));
});

test("vetoes a cloud model that disagrees with the local recomputation", () => {
  const cloud = model({ scenarios: { base: { label: "Base", summary: { valuePerShare: 300, enterpriseValue: 1000, equityValue: 900, marginOfSafetyPct: 0.2 }, checks: [] } } });
  const report = mergeResults(payload({ cloudModel: cloud }), { models: { AAPL: model() } });
  assert.equal(report.rows[0].model_audit.status, "mismatch");
  assert.ok(report.rows[0].veto_items.includes("model_recompute_mismatch"));
  assert.equal(report.rows[0].decision, "pass");
});

test("require-model vetoes a row without a model", () => {
  const report = mergeResults(payload(), { requireModel: true });
  assert.ok(report.rows[0].veto_items.includes("model_required_but_missing"));
  assert.equal(report.rows[0].model_verdict, "not_modeled");
});

test("a model far below the price contradicts an eligible valuation verdict", () => {
  const cheap = model({ scenarios: { base: { label: "Base", summary: { valuePerShare: 80, enterpriseValue: 1000, equityValue: 900, marginOfSafetyPct: -0.6 }, checks: [] } } });
  const report = mergeResults(payload(), { models: { AAPL: cheap } });
  assert.ok(report.rows[0].veto_items.includes("model_contradicts_valuation_verdict"));
  assert.equal(report.rows[0].model_verdict, "price_above_model_value");
});

test("report includes the investment model section", () => {
  const report = mergeResults(payload(), { models: { AAPL: model() } });
  const markdown = renderReport(report);
  assert.ok(markdown.includes("### Investment model (three-statement + DCF)"));
  assert.ok(markdown.includes("250.00"));
  assert.ok(markdown.includes("Model values are deterministic outputs"));
});

test("v4 template is a canonical v2 spec with a codeProfile step", async () => {
  const raw = await readFile(TEMPLATE, "utf8");
  const parsed = JSON.parse(raw);
  const spec = parsed.canonicalSpecV2 ?? parsed;
  assert.ok(spec.meta && Array.isArray(spec.steps) && spec.workbook);
  assert.equal(spec.steps.length, 8);
  const codeSteps = spec.steps.filter((step) => step.executionBinding.kind === "codeProfile");
  assert.equal(codeSteps.length, 4);
  const codeStep = codeSteps.find((step) => step.stepId === "stp_model01");
  assert.ok(codeStep);
  assert.deepEqual(Object.keys(codeStep.code.inputs).sort(), ["assumptions", "tickerPacket"]);
  assert.deepEqual(Object.keys(codeStep.code.outputs).sort(), ["model", "workbook"]);
  assert.equal(codeStep.code.outputs.workbook.kind, "artifact");
  assert.deepEqual(Object.keys(codeStep.inputBindings).sort(), ["assumptions", "tickerPacket"]);
  assert.equal(codeStep.inputBindings.assumptions.inputKey, "modelAssumptions");
  assert.ok(codeStep.code.source.includes("def main("));
  const preflight = codeSteps.find((step) => step.stepId === "stp_preflight");
  assert.ok(preflight);
  assert.deepEqual(Object.keys(preflight.code.inputs).sort(), ["asOf", "assumptions", "tickerPacket"]);
  assert.deepEqual(Object.keys(preflight.code.outputs).sort(), ["findings", "ready", "summary"]);
  assert.equal(preflight.inputBindings.asOf.inputKey, "asOf");
  assert.equal(preflight.inputBindings.asOf.fallbackValue, "");
  const gated = spec.steps.filter((candidate) => ["stp_business", "stp_management", "stp_financial", "stp_valuation", "stp_model01"].includes(candidate.stepId));
  assert.equal(gated.length, 5);
  for (const step of gated) {
    assert.deepEqual(step.dependsOn, ["stp_preflight"]);
    assert.deepEqual(step.when, { stepId: "stp_preflight", portId: "ready", equals: true });
  }
  const audit = spec.steps.find((step) => step.stepId === "stp_audit1");
  assert.ok(audit);
  assert.equal(audit.executionBinding.kind, "codeProfile");
  assert.deepEqual(Object.keys(audit.code.outputs).sort(), ["accepted", "audit", "findings", "model"]);
  assert.equal(audit.inputBindings.model.source, "stepOutput");
  assert.equal(audit.inputBindings.business.portId, "output");
  assert.deepEqual(audit.when, { stepId: "stp_preflight", portId: "ready", equals: true });
  const report = spec.steps.find((step) => step.stepId === "stp_report");
  assert.ok(report);
  assert.deepEqual(report.dependsOn, ["stp_audit1"]);
  assert.equal(report.when, undefined);
  assert.equal(report.code.outputs.report.kind, "artifact");
  assert.equal(report.code.outputs.report.mimeType, "text/markdown");
  const sample = spec.workbook.sampleRows[0].values;
  const assumptions = JSON.parse(sample.modelAssumptions);
  assert.ok(assumptions.scenarios.base);
  assert.ok(JSON.parse(sample.tickerPacket).financialPacket.balanceSheet);
  assert.equal(sample.asOf, "2026-09-02");
});

test("template code source is in sync with the engine", async () => {
  const result = await syncTemplate({ templatePath: TEMPLATE, write: false });
  assert.equal(result.changed, false);
  assert.equal(result.steps.length, 4);
  assert.equal(result.steps.find((entry) => entry.stepId === "stp_model01").changed, false);
  assert.equal(result.steps.find((entry) => entry.stepId === "stp_preflight").changed, false);
  assert.equal(result.steps.find((entry) => entry.stepId === "stp_audit1").changed, false);
  assert.equal(result.steps.find((entry) => entry.stepId === "stp_report").changed, false);
  assert.ok(result.sourceBytes > 10000);
});

test("local runner produces a ready model and workbook", async (t) => {
  const probe = spawnSync(process.env.PYTHON || "python3", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) return t.skip("python3 is not available");
  const directory = await mkdtemp(path.join(tmpdir(), "loomloom-model-"));
  try {
    const out = path.join(directory, "model.json");
    const xlsx = path.join(directory, "model.xlsx");
    const result = runModel({
      packets: path.join(SKILL_ROOT, "model", "fixtures", "aapl-packets.json"),
      assumptions: path.join(SKILL_ROOT, "model", "fixtures", "aapl-assumptions.json"),
      out,
      xlsx,
    });
    assert.equal(result.status, 0, result.stderr);
    const built = JSON.parse(await readFile(out, "utf8"));
    assert.equal(built.model_ready, true);
    assert.equal(built.ticker, "AAPL");
    assert.ok(built.scenarios.base.summary.valuePerShare > 0);
    const bytes = await readFile(xlsx);
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("finds a cloud model nested under result outputs", () => {
  const envelope = payload();
  envelope.rows[0].outputs = { stp_model01: { model: model() } };
  const report = mergeResults(envelope, { models: { AAPL: model() } });
  assert.equal(report.rows[0].model_audit.status, "matched");
});

test("surfaces cloud preflight findings on a blocked row", () => {
  const envelope = payload();
  envelope.rows[0].values = [
    { stepId: "stp_preflight", portId: "ready", value: false },
    { stepId: "stp_preflight", portId: "findings", value: [{ code: "MARKET_CAP_MISSING", severity: "error", path: "financialPacket.marketSnapshot.marketCapUsd", message: "marketCapUsd is required" }] },
    { stepId: "stp_preflight", portId: "summary", value: { ticker: "AAPL", checks: 10, errors: 1, warnings: 0, ready: false } },
  ];
  const report = mergeResults(envelope, {});
  const row = report.rows[0];
  assert.equal(row.valid, false);
  assert.equal(row.cloud_preflight.ready, false);
  assert.ok(row.errors.some((error) => error.includes("MARKET_CAP_MISSING")));
  assert.equal(report.summary.preflightBlockedRows, 1);
});

test("narrative numbers that contradict the packet set audit warn", () => {
  const envelope = payload();
  const financial = JSON.parse(envelope.rows[0].artifacts[2].inlineText);
  financial.summary = "The stock trades at a P/E of 999x.";
  envelope.rows[0].artifacts[2].inlineText = JSON.stringify(financial);
  const report = mergeResults(envelope, {});
  const row = report.rows[0];
  assert.equal(row.valid, true);
  assert.equal(row.audit_status, "warn");
  assert.equal(row.narrative_checks.length, 1);
  assert.equal(row.narrative_checks[0].code, "NARRATIVE_PE_CONFLICT");
  assert.equal(report.summary.narrativeConflictRows, 1);
});

test("strict narrative turns a numeric contradiction into a veto", () => {
  const envelope = payload();
  const financial = JSON.parse(envelope.rows[0].artifacts[2].inlineText);
  financial.summary = "The stock trades at a P/E of 999x.";
  envelope.rows[0].artifacts[2].inlineText = JSON.stringify(financial);
  const report = mergeResults(envelope, { strictNarrative: true });
  const row = report.rows[0];
  assert.equal(row.valid, true);
  assert.equal(row.audit_status, "vetoed");
  assert.ok(row.veto_items.includes("narrative_number_conflict"));
  assert.equal(row.decision, "pass");
});
