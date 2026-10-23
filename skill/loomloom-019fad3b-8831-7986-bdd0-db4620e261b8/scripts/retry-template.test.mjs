import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(HERE, "..", "..", "..", "templates", "buffett-four-filters-retry.cogfoundry", "template.json");

async function spec() {
  return JSON.parse(await readFile(TEMPLATE, "utf8"));
}

test("retry template has a five-step outer graph and a nine-step loop body", async () => {
  const canonicalSpecV2 = await spec();
  assert.deepEqual(canonicalSpecV2.steps.map((step) => step.stepId), ["stp_preflight", "stp_loop01", "stp_model01", "stp_audit1", "stp_report"]);
  const loop = canonicalSpecV2.steps[1];
  assert.deepEqual(loop.loop.body.map((step) => step.stepId), [
    "stp_promptb", "stp_business1", "stp_promptm", "stp_mgmt01",
    "stp_promptf", "stp_financial1", "stp_promptv", "stp_valuation1", "stp_judge1",
  ]);
  assert.equal(loop.loop.maxIterations, 2);
  assert.deepEqual(loop.loop.control, {
    decision: { stepId: "stp_judge1", portId: "action" },
    checkpoints: [{ stepId: "stp_judge1", portId: "action" }],
  });
  assert.deepEqual(Object.keys(loop.loop.outputs).sort(), ["business", "financial", "management", "valuation"]);
});

test("retry judge exports review strings and audit consumes the loop", async () => {
  const canonicalSpecV2 = await spec();
  const loop = canonicalSpecV2.steps[1];
  const judge = loop.loop.body.find((step) => step.stepId === "stp_judge1");
  for (const key of ["business", "management", "financial", "valuation"]) {
    assert.equal(judge.code.outputs[key].valueType, "string");
    assert.deepEqual(loop.loop.outputs[key], { stepId: "stp_judge1", portId: key });
  }
  const audit = canonicalSpecV2.steps.find((step) => step.stepId === "stp_audit1");
  for (const key of ["business", "management", "financial", "valuation"]) {
    assert.deepEqual(audit.inputBindings[key], { source: "stepOutput", stepId: "stp_loop01", portId: key });
  }
});

test("retry prompt and judge sources fit the Code limit", async () => {
  const canonicalSpecV2 = await spec();
  const loop = canonicalSpecV2.steps[1];
  for (const id of ["stp_promptb", "stp_promptm", "stp_promptf", "stp_promptv", "stp_judge1"]) {
    const step = loop.loop.body.find((candidate) => candidate.stepId === id);
    assert.ok(Buffer.byteLength(step.code.source, "utf8") <= 65536, id);
    assert.ok(step.code.source.includes("def main("), id);
  }
});
