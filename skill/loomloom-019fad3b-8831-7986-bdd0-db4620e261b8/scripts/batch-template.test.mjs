import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(HERE, "..", "..", "..", "templates", "buffett-cloud-batch.cogfoundry", "template.json");

test("batch template extracts result-rows and ranks in one Code step", async () => {
  const spec = JSON.parse(await readFile(TEMPLATE, "utf8"));
  assert.equal(spec.steps.length, 1);
  const step = spec.steps[0];
  assert.equal(step.stepId, "stp_batch01");
  assert.deepEqual(Object.keys(spec.templateInputs).sort(), ["resultRows", "topN"]);
  assert.deepEqual(Object.keys(step.code.outputs).sort(), ["ranking", "report"]);
  assert.equal(step.code.outputs.report.mimeType, "text/markdown");
});

test("batch Code source is current", async () => {
  const spec = JSON.parse(await readFile(TEMPLATE, "utf8"));
  const source = await readFile(path.resolve(HERE, "..", "model", "ranking_code.py"), "utf8");
  assert.equal(spec.steps[0].code.source, source);
});
