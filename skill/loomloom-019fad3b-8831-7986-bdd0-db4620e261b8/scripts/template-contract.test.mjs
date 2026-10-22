import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(HERE, "..", "..", "..", "templates", "buffett-four-filters-model.cogfoundry", "template.json");
const STEP_ID = /^stp_[a-z0-9]{6,10}$/;
const INPUT_KEY = /^[a-z][A-Za-z0-9_]{0,63}$/;

async function spec() {
  const parsed = JSON.parse(await readFile(TEMPLATE, "utf8"));
  return parsed.canonicalSpecV2 ?? parsed;
}

test("template is a canonical v2 spec", async () => {
  const canonical = await spec();
  assert.ok(canonical.meta.name);
  assert.ok(canonical.templateInputs);
  assert.ok(canonical.workbook.instructions.length > 0);
});

test("step ids and input keys match the platform grammar", async () => {
  const canonicalSpecV2 = await spec();
  for (const step of canonicalSpecV2.steps) {
    assert.match(step.stepId, STEP_ID, step.stepId);
    assert.ok(step.displayName, step.stepId);
    assert.ok(step.executionBinding, step.stepId);
  }
  for (const key of Object.keys(canonicalSpecV2.templateInputs)) assert.match(key, INPUT_KEY, key);
  assert.equal(new Set(canonicalSpecV2.steps.map((step) => step.stepId)).size, canonicalSpecV2.steps.length);
});

test("capability steps keep a profile and model selection", async () => {
  const canonicalSpecV2 = await spec();
  const capabilitySteps = canonicalSpecV2.steps.filter((step) => step.executionBinding.kind === "capabilityProfile");
  assert.equal(capabilitySteps.length, 4);
  for (const step of capabilitySteps) {
    assert.ok(step.executionBinding.profileId, step.stepId);
    assert.ok(step.modelSelection, step.stepId);
    assert.ok(step.modelSelection.defaultModelId, step.stepId);
    assert.ok(step.inputBindings.prompt, step.stepId);
  }
});

test("code step has matching inputs/bindings and no model selection", async () => {
  const canonicalSpecV2 = await spec();
  const codeSteps = canonicalSpecV2.steps.filter((candidate) => candidate.executionBinding.kind === "codeProfile");
  assert.equal(codeSteps.length, 2);
  const step = codeSteps.find((candidate) => candidate.stepId === "stp_model01");
  assert.ok(step);
  assert.equal(step.code.language, "python");
  assert.equal(step.code.entrypoint, "main");
  assert.equal(step.modelSelection, undefined);
  assert.deepEqual(Object.keys(step.code.inputs).sort(), Object.keys(step.inputBindings).sort());
  for (const [key, input] of Object.entries(step.code.inputs)) {
    assert.equal(input.required, true, key);
    assert.equal(input.nullable, false, key);
    assert.equal(input.kind, "value", key);
    assert.equal(input.valueType, "string", key);
    assert.equal(step.inputBindings[key].source, "templateInput", key);
    assert.ok(canonicalSpecV2.templateInputs[step.inputBindings[key].inputKey], key);
  }
  assert.deepEqual(Object.keys(step.code.outputs).sort(), ["model", "workbook"]);
  assert.equal(step.code.outputs.workbook.kind, "artifact");
  assert.equal(step.code.outputs.workbook.mimeType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(step.code.outputs.model.kind, "value");
  assert.equal(step.code.outputs.model.valueType, "object");
  assert.ok(step.code.outputs.model.schema);
});

test("sample row keys reference declared template inputs", async () => {
  const canonicalSpecV2 = await spec();
  for (const sample of canonicalSpecV2.workbook.sampleRows) {
    for (const key of Object.keys(sample.values)) assert.ok(canonicalSpecV2.templateInputs[key], key);
  }
});

test("code source is the compact cloud engine and fits the Code limit", async () => {
  const canonicalSpecV2 = await spec();
  const step = canonicalSpecV2.steps.find((candidate) => candidate.stepId === "stp_model01");
  const cloud = await readFile(path.resolve(HERE, "..", "model", "valuation_model.cloud.py"), "utf8");
  assert.equal(step.code.source, cloud);
  assert.ok(Buffer.byteLength(step.code.source, "utf8") <= 65536);
  const probe = spawnSync(process.env.PYTHON || "python3", ["-c", "import sys; compile(sys.stdin.read(), '<template>', 'exec')"], { input: step.code.source, encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  assert.ok(step.code.source.includes("def main("));
  assert.ok(step.code.source.includes("def write_xlsx("));
});

test("the v4 template keeps the v3 four-review prompts", async () => {
  const canonicalSpecV2 = await spec();
  const prompts = canonicalSpecV2.steps.filter((step) => step.executionBinding.kind === "capabilityProfile").map((step) => JSON.stringify(step.inputBindings.prompt));
  for (const marker of ["Circle of Competence", "Durable Competitive Advantage", "Financial Quality", "Margin of Safety"]) {
    assert.ok(prompts.some((prompt) => prompt.includes(marker)), marker);
  }
});

test("preflight gate is wired as a boolean when-condition", async () => {
  const canonicalSpecV2 = await spec();
  const preflight = canonicalSpecV2.steps.find((step) => step.stepId === "stp_preflight");
  assert.ok(preflight);
  assert.equal(preflight.executionBinding.kind, "codeProfile");
  assert.deepEqual(Object.keys(preflight.code.inputs).sort(), ["asOf", "assumptions", "tickerPacket"]);
  assert.equal(preflight.code.inputs.asOf.nullable, false);
  assert.deepEqual(Object.keys(preflight.code.outputs).sort(), ["findings", "ready", "summary"]);
  assert.equal(preflight.code.outputs.ready.valueType, "boolean");
  assert.equal(preflight.inputBindings.asOf.fallbackValue, "");
  const gated = canonicalSpecV2.steps.filter((step) => step.stepId !== "stp_preflight");
  assert.equal(gated.length, 5);
  for (const step of gated) {
    assert.deepEqual(step.dependsOn, ["stp_preflight"], step.stepId);
    assert.deepEqual(step.when, { stepId: "stp_preflight", portId: "ready", equals: true }, step.stepId);
  }
  const source = await readFile(path.resolve(HERE, "..", "model", "preflight_code.py"), "utf8");
  assert.equal(preflight.code.source, source);
  assert.ok(Buffer.byteLength(preflight.code.source, "utf8") <= 65536);
});
