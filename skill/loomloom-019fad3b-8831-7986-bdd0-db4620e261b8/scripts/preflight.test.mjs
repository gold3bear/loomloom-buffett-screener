import test from "node:test";
import assert from "node:assert/strict";
import { preflight } from "./preflight.mjs";
import { prepareRequest } from "./prepare-market-input.mjs";

function packet() {
  return {
    ticker: "AAPL",
    identityPacket: { ticker: "AAPL", companyName: "Apple Inc.", industry: "Technology", dataAsOf: "2026-07-29", fiscalPeriod: "FY2025", sources: ["https://www.sec.gov/example"] },
    financialPacket: { marketSnapshot: { price: 200, currency: "USD", pe: 30, asOf: "2026-07-29" }, annualHistory: { fiscalYearEnd: ["2023-09-30", "2024-09-28", "2025-09-27"], revenue: [100, 110, 120] }, unknowns: [] },
    qualitativePacket: Object.fromEntries(
      ["businessModel", "moatEvidence", "managementCulture", "capitalAllocation", "riskFactors"]
        .map((key) => [key, [{ fact: `${key} fact`, source: "https://www.sec.gov/example", date: "2026-07-29", sourceTier: "S" }]])
        .concat([["contraryEvidence", []], ["unknowns", []]]),
    ),
  };
}

test("complete packet passes and converts to public Market rows", () => {
  const input = [packet()];
  assert.equal(preflight(input, { asOf: "2026-07-29" }).valid, true);
  const request = prepareRequest(input, { asOf: "2026-07-29" });
  assert.equal(request.inputRows.length, 1);
  assert.equal(JSON.parse(request.inputRows[0].identityPacket).ticker, "AAPL");
  assert.deepEqual(Object.keys(request.inputRows[0]).sort(), ["financialPacket", "identityPacket", "qualitativePacket"]);
});

test("stale price blocks execution", () => {
  const input = packet();
  input.financialPacket.marketSnapshot.asOf = "2026-07-01";
  const report = preflight([input], { asOf: "2026-07-29" });
  assert.equal(report.valid, false);
  assert.ok(report.rows[0].issues.some(({ code }) => code === "STALE_DATA"));
});

test("missing PE is degraded when unknown is documented", () => {
  const input = packet();
  input.financialPacket.marketSnapshot.pe = null;
  input.financialPacket.unknowns = ["PE not meaningful: company is loss-making this period"];
  const report = preflight([input], { asOf: "2026-07-29" });
  assert.equal(report.valid, true);
});

test("history period mismatch blocks execution", () => {
  const input = packet();
  input.financialPacket.annualHistory.revenue.pop();
  const report = preflight([input], { asOf: "2026-07-29" });
  assert.equal(report.valid, false);
  assert.ok(report.rows[0].issues.some(({ code }) => code === "HISTORY_LENGTH_MISMATCH"));
});

test("explicit USD units safely normalize a missing snapshot currency", () => {
  const input = packet();
  delete input.financialPacket.marketSnapshot.currency;
  input.financialPacket.units = "USD millions except ratios";
  const report = preflight([input], { asOf: "2026-07-29" });
  assert.equal(report.valid, true);
  assert.equal(report.rows[0].status, "degraded");
  const request = prepareRequest([input], { asOf: "2026-07-29" });
  assert.equal(JSON.parse(request.inputRows[0].financialPacket).marketSnapshot.currency, "USD");
});

function modelAssumptions() {
  const scenario = {
    years: 5,
    revenueGrowth: [0.04, 0.04, 0.04, 0.035, 0.035],
    ebitMargin: [0.32, 0.32, 0.32, 0.32, 0.32],
    taxRate: 0.21,
    daPctRevenue: 0.03,
    capexPctRevenue: 0.035,
    nwcPctRevenue: 0.10,
    interestRateOnDebt: 0.04,
    debtRepaymentPct: 0.05,
    wacc: 0.085,
    terminalMethod: "perpetuity",
    terminalGrowth: 0.025,
  };
  return { schemaVersion: "loomloom-model-assumptions/v1", asOf: "2026-07-29", baseScenario: "base", scenarios: { base: scenario }, sources: [{ field: "scenarios.base.wacc", value: "0.085", source: "user", date: "2026-07-29" }] };
}

function modelPacket() {
  const input = packet();
  input.financialPacket.balanceSheet = {
    cash: 30000, currentAssets: 145000, currentLiabilities: 80000, shortTermDebt: 10000,
    netPPE: 95000, otherAssets: 5000, totalDebt: 100000, otherLiabilities: 15000,
    equity: 60000, sharesOutstanding: 14800,
  };
  input.financialPacket.marketSnapshot.marketCapUsd = 200 * 14800;
  return input;
}

test("model assumptions plus a balance sheet pass preflight", () => {
  const report = preflight([modelPacket()], { asOf: "2026-07-29", assumptions: modelAssumptions(), requireModel: true });
  assert.equal(report.valid, true);
  assert.equal(report.rows[0].status, "ready");
});

test("require-model blocks a packet without assumptions", () => {
  const report = preflight([modelPacket()], { asOf: "2026-07-29", requireModel: true });
  assert.equal(report.valid, false);
  assert.ok(report.rows[0].issues.some(({ code }) => code === "MODEL_ASSUMPTIONS_MISSING"));
});

test("missing assumptions are only a warning when the model is optional", () => {
  const report = preflight([modelPacket()], { asOf: "2026-07-29" });
  assert.equal(report.valid, true);
  assert.ok(report.rows[0].issues.some(({ code, severity }) => code === "MODEL_ASSUMPTIONS_MISSING" && severity === "warning"));
});

test("a missing DCF driver blocks the model", () => {
  const assumptions = modelAssumptions();
  delete assumptions.scenarios.base.wacc;
  const report = preflight([modelPacket()], { asOf: "2026-07-29", assumptions, requireModel: true });
  assert.equal(report.valid, false);
  assert.ok(report.rows[0].issues.some(({ code }) => code === "MODEL_DRIVER_MISSING"));
  assert.ok(report.rows[0].issues.some(({ code }) => code === "MODEL_NOT_READY"));
});

test("a balance sheet missing shares blocks the model", () => {
  const input = modelPacket();
  delete input.financialPacket.balanceSheet.sharesOutstanding;
  const report = preflight([input], { asOf: "2026-07-29", assumptions: modelAssumptions(), requireModel: true });
  assert.equal(report.valid, false);
  assert.ok(report.rows[0].issues.some(({ code }) => code === "MODEL_SHARES_MISSING"));
});

test("market cap mismatch blocks the model", () => {
  const input = modelPacket();
  input.financialPacket.marketSnapshot.marketCapUsd = 200 * 14800 * 1.05;
  const report = preflight([input], { asOf: "2026-07-29", assumptions: modelAssumptions(), requireModel: true });
  assert.equal(report.valid, false);
  assert.ok(report.rows[0].issues.some(({ code }) => code === "MODEL_MARKET_CAP_MISMATCH"));
});

test("missing market cap blocks the model", () => {
  const input = modelPacket();
  delete input.financialPacket.marketSnapshot.marketCapUsd;
  const report = preflight([input], { asOf: "2026-07-29", assumptions: modelAssumptions(), requireModel: true });
  assert.equal(report.valid, false);
  assert.ok(report.rows[0].issues.some(({ code }) => code === "MODEL_MARKET_CAP_MISSING"));
});

test("C-tier evidence blocks the row", () => {
  const input = modelPacket();
  input.qualitativePacket.moatEvidence[0].sourceTier = "C";
  const report = preflight([input], { asOf: "2026-07-29", assumptions: modelAssumptions(), requireModel: true });
  assert.equal(report.valid, false);
  assert.ok(report.rows[0].issues.some(({ code }) => code === "TIER_C_NOT_EVIDENCE"));
});

test("prepareRequest carries modelAssumptions and asOf for a v4 row", () => {
  const input = modelPacket();
  input.asOf = "2026-07-29";
  const request = prepareRequest([input], { asOf: "2026-07-29", assumptions: modelAssumptions(), requireModel: true });
  const row = request.inputRows[0];
  assert.deepEqual(Object.keys(row).sort(), ["asOf", "financialPacket", "identityPacket", "modelAssumptions", "qualitativePacket"]);
  assert.equal(typeof row.modelAssumptions, "string");
  assert.equal(JSON.parse(row.modelAssumptions).scenarios.base.years, 5);
  assert.equal(row.asOf, "2026-07-29");
});

test("prepareRequest resolves assumptions by ticker for a batch", () => {
  const request = prepareRequest([modelPacket()], { asOf: "2026-07-29", assumptions: { AAPL: modelAssumptions() }, requireModel: true });
  assert.equal(typeof request.inputRows[0].modelAssumptions, "string");
});
