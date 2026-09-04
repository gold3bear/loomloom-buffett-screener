import test from "node:test";
import assert from "node:assert/strict";
import { prepareCogfoundryInput, tickerPacketFromRow } from "./prepare-cogfoundry-input.mjs";

const sampleRow = {
  identityPacket: JSON.stringify({
    ticker: "AAPL",
    companyName: "Apple Inc.",
    industry: "Technology Hardware",
    dataAsOf: "2026-09-01",
    fiscalPeriod: "FY2025",
    sources: ["https://www.sec.gov/"],
  }),
  financialPacket: JSON.stringify({
    marketSnapshot: { price: 220.5, currency: "USD", asOf: "2026-09-01", pe: 28.4 },
    annualHistory: {
      fiscalYearEnd: ["2023-09-30", "2024-09-28", "2025-09-27"],
      revenue: [383285, 391035, 416161],
      netIncome: [96995, 93736, 112010],
      freeCashFlow: [99584, 108807, 98767],
    },
    unknowns: [],
  }),
  qualitativePacket: JSON.stringify({
    businessModel: [{ fact: "Apple sells iPhones, Macs, services and wearables", source: "https://www.apple.com/investor/", date: "2026-09-01" }],
    moatEvidence: [],
    managementCulture: [],
    capitalAllocation: [],
    riskFactors: [],
    contraryEvidence: [],
    unknowns: [],
  }),
};

test("reassembles the three packets in identity -> financial -> qualitative order, joined by newlines", () => {
  const joined = tickerPacketFromRow(sampleRow, 0);
  // Order check: identity JSON first, financial middle, qualitative last.
  const idIdx = joined.indexOf('"ticker":"AAPL"');
  const finIdx = joined.indexOf('"price":220.5');
  const qualIdx = joined.indexOf("iPhones, Macs, services");
  assert.ok(idIdx >= 0 && finIdx >= 0 && qualIdx >= 0, "all three inner fragments present");
  assert.ok(idIdx < finIdx, "identityPacket precedes financialPacket");
  assert.ok(finIdx < qualIdx, "financialPacket precedes qualitativePacket");
  // Exactly two newline separators.
  assert.equal((joined.match(/\n/g) || []).length, 2, "exactly two newlines separate the three packets");
  // Each segment must be independently parseable as JSON.
  const segments = joined.split("\n");
  assert.equal(segments.length, 3);
  for (const seg of segments) {
    const obj = JSON.parse(seg);
    assert.equal(typeof obj, "object");
  }
});

test("prepareCogfoundryInput wraps each row in { tickerPacket: ... }", () => {
  const out = prepareCogfoundryInput({ inputRows: [sampleRow] });
  assert.equal(out.length, 1);
  assert.equal(typeof out[0].tickerPacket, "string");
  // The wrapper is the only key; no leftover identityPacket / financialPacket keys
  // would silently confuse a downstream consumer that expects a flat shape.
  assert.deepEqual(Object.keys(out[0]), ["tickerPacket"]);
});

test("rejects a row whose identityPacket is missing", () => {
  const bad = { ...sampleRow };
  delete bad.identityPacket;
  assert.throws(() => tickerPacketFromRow(bad, 0), /missing or has non-string identityPacket/);
});

test("rejects a row whose financialPacket is not a valid JSON string", () => {
  const bad = { ...sampleRow, financialPacket: "{not json" };
  assert.throws(() => tickerPacketFromRow(bad, 0), /financialPacket is not valid JSON/);
});

test("rejects when the request has no inputRows", () => {
  assert.throws(() => prepareCogfoundryInput({}), /missing inputRows array/);
});

test("preserves a multi-row order, so the i-th line maps to the i-th input row", () => {
  const nvdaFinancial = JSON.stringify({
    marketSnapshot: { price: 228.45, currency: "USD", asOf: "2026-09-03", pe: 28.7 },
    annualHistory: {
      fiscalYearEnd: ["2024-01-28", "2025-01-26", "2026-01-25"],
      revenue: [60922, 130497, 215938],
      netIncome: [29760, 72880, 120067],
      freeCashFlow: [27021, 51060, 96575],
    },
    unknowns: [],
  });
  const row2 = {
    ...sampleRow,
    identityPacket: JSON.stringify({ ...JSON.parse(sampleRow.identityPacket), ticker: "NVDA" }),
    financialPacket: nvdaFinancial,
  };
  const out = prepareCogfoundryInput({ inputRows: [sampleRow, row2] });
  assert.equal(out.length, 2);
  assert.ok(out[0].tickerPacket.includes('"ticker":"AAPL"'));
  assert.ok(out[1].tickerPacket.includes('"ticker":"NVDA"'));
  // No cross-row leakage.
  assert.ok(!out[0].tickerPacket.includes("NVDA"));
  assert.ok(!out[1].tickerPacket.includes('"price":220.5'));
  assert.ok(out[1].tickerPacket.includes('"price":228.45'));
});
