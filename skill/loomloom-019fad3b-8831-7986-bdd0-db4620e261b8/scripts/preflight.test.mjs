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
        .map((key) => [key, [{ fact: `${key} fact`, source: "https://www.sec.gov/example", date: "2026-07-29" }]])
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
