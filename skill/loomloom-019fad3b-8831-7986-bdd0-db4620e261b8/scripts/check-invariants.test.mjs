import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkInvariants } from "./check-invariants.mjs";
import { runModel } from "./run-model.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, "..");
const PACKETS = path.join(SKILL_ROOT, "model", "fixtures", "aapl-packets.json");
const ASSUMPTIONS = path.join(SKILL_ROOT, "model", "fixtures", "aapl-assumptions.json");
const AS_OF = "2026-09-02";

async function buildFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "loomloom-invariants-"));
  const modelPath = path.join(directory, "model.json");
  const xlsxPath = path.join(directory, "model.xlsx");
  const result = runModel({ packets: PACKETS, assumptions: ASSUMPTIONS, out: modelPath, xlsx: xlsxPath });
  if (result.status !== 0) throw new Error(result.stderr || "model build failed");
  const model = JSON.parse(await readFile(modelPath, "utf8"));
  return { directory, modelPath, xlsxPath, model };
}

const pythonAvailable = spawnSync(process.env.PYTHON || "python3", ["--version"], { encoding: "utf8" }).status === 0;

test("a complete packet + ready model + workbook passes the gate", async (t) => {
  if (!pythonAvailable) return t.skip("python3 is not available");
  const fixture = await buildFixture();
  try {
    const report = await checkInvariants({
      packets: JSON.parse(await readFile(PACKETS, "utf8")),
      assumptions: JSON.parse(await readFile(ASSUMPTIONS, "utf8")),
      model: fixture.model,
      xlsx: fixture.xlsxPath,
      asOf: AS_OF,
      requireModel: true,
    });
    assert.equal(report.passed, true, JSON.stringify(report.checks.filter((entry) => !entry.passed)));
    assert.equal(report.summary.failedErrors, 0);
    const ids = new Set(report.checks.map((entry) => entry.id));
    for (const id of ["packet.preflight.AAPL", "model.sensitivityCenter", "model.modelChecksPassed", "workbook.signature", "workbook.minSheets"]) {
      assert.ok(ids.has(id), id);
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("a ticker mismatch fails the cross-document check", async (t) => {
  if (!pythonAvailable) return t.skip("python3 is not available");
  const fixture = await buildFixture();
  try {
    const model = { ...fixture.model, ticker: "MSFT" };
    const report = await checkInvariants({
      packets: JSON.parse(await readFile(PACKETS, "utf8")),
      assumptions: JSON.parse(await readFile(ASSUMPTIONS, "utf8")),
      model,
      asOf: AS_OF,
      requireModel: true,
    });
    assert.equal(report.passed, false);
    assert.ok(report.checks.some((entry) => entry.id === "model.tickerMatchesPacket" && !entry.passed));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("a failed model invariant fails the gate", async (t) => {
  if (!pythonAvailable) return t.skip("python3 is not available");
  const fixture = await buildFixture();
  try {
    const model = structuredClone(fixture.model);
    model.modelChecks[0].passed = false;
    const report = await checkInvariants({
      packets: JSON.parse(await readFile(PACKETS, "utf8")),
      assumptions: JSON.parse(await readFile(ASSUMPTIONS, "utf8")),
      model,
      asOf: AS_OF,
      requireModel: true,
    });
    assert.equal(report.passed, false);
    assert.ok(report.checks.some((entry) => entry.id === "model.modelChecksPassed" && !entry.passed));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("a missing model fails when the model is required", async () => {
  const report = await checkInvariants({
    packets: JSON.parse(await readFile(PACKETS, "utf8")),
    assumptions: JSON.parse(await readFile(ASSUMPTIONS, "utf8")),
    asOf: AS_OF,
    requireModel: true,
  });
  assert.equal(report.passed, false);
  assert.ok(report.checks.some((entry) => entry.id === "model.present" && !entry.passed));
});

test("audit model mismatches fail the gate", async (t) => {
  if (!pythonAvailable) return t.skip("python3 is not available");
  const fixture = await buildFixture();
  try {
    const audit = {
      valid: true,
      summary: { modelMismatchRows: 1 },
      rows: [{ ticker: "AAPL", valid: true, investment_model: fixture.model, model_audit: { status: "mismatch" } }],
    };
    const report = await checkInvariants({
      packets: JSON.parse(await readFile(PACKETS, "utf8")),
      assumptions: JSON.parse(await readFile(ASSUMPTIONS, "utf8")),
      model: fixture.model,
      audit,
      asOf: AS_OF,
      requireModel: true,
    });
    assert.equal(report.passed, false);
    assert.ok(report.checks.some((entry) => entry.id === "audit.modelMismatch" && !entry.passed));
    assert.ok(report.checks.some((entry) => entry.id === "audit.rowsNoMismatch" && !entry.passed));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
