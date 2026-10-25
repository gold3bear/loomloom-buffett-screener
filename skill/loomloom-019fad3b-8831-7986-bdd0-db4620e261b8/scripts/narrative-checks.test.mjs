import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkNarrative, metricsOf } from "./narrative-checks.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const packet = JSON.parse(readFileSync(path.join(HERE, "..", "model", "fixtures", "nvda-packets.json"), "utf8"));
const metrics = metricsOf(packet);
const reviews = (summary) => ({ financial: { summary } });

test("metrics use the latest TTM and the current balance sheet", () => {
  assert.equal(metrics.shares, 24100);
  assert.ok(Math.abs(metrics.ttmFcfToNi - 0.6585) < 0.001);
  assert.ok(Math.abs(metrics.annualFcfToNi - 0.8052) < 0.001);
  assert.equal(metrics.netCash, 22443 - 33366);
  assert.ok(Math.abs(metrics.pe - 26.52) < 0.01);
});

test("flags an FCF/NI multiple that contradicts the packet", () => {
  const findings = checkNarrative(reviews("Free cash flow is 1.6x net income."), packet);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "NARRATIVE_FCF_NI_CONFLICT");
});

test("accepts a TTM FCF/NI percentage that matches the packet", () => {
  assert.deepEqual(checkNarrative(reviews("FCF/NI = 66% in the latest twelve months."), packet), []);
});

test("uses the FY2026 annual ratio when the text names FY2026", () => {
  assert.deepEqual(checkNarrative(reviews("FCF/NI = 80% in FY2026."), packet), []);
});

test("flags a direction claim that contradicts the ratio", () => {
  const findings = checkNarrative(reviews("FY2026 free cash flow exceeds net income (FCF/NI = 80%)."), packet);
  assert.ok(findings.some((entry) => entry.code === "NARRATIVE_FCF_NI_CONFLICT"));
});

test("flags stale net cash when the packet has net debt", () => {
  const findings = checkNarrative(reviews("The company has a net cash position of $2.1 billion."), packet);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "NARRATIVE_NET_CASH_CONFLICT");
});

test("accepts the current net debt", () => {
  assert.deepEqual(checkNarrative(reviews("Net debt is $10.9 billion."), packet), []);
});

test("flags a stale P/E", () => {
  const findings = checkNarrative(reviews("The stock trades at a P/E of 44.9x."), packet);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "NARRATIVE_PE_CONFLICT");
});

test("accepts current shares and flags a wrong share count", () => {
  assert.deepEqual(checkNarrative(reviews("There are 24.3 billion shares outstanding."), packet), []);
  const findings = checkNarrative(reviews("There are 30 billion shares outstanding."), packet);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "NARRATIVE_SHARES_CONFLICT");
});

test("flags an FCF/NI multiple written with an x suffix", () => {
  const findings = checkNarrative(reviews("FCF/NI = 1.03x TTM."), packet);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "NARRATIVE_FCF_NI_CONFLICT");
});
