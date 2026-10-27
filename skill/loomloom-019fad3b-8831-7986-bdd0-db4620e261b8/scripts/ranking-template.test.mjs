import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(HERE, "..", "..", "..", "templates", "buffett-cloud-ranking.cogfoundry", "template.json");

test("ranking template is a single deterministic Code step", async () => {
  const spec = JSON.parse(await readFile(TEMPLATE, "utf8"));
  assert.equal(spec.steps.length, 1);
  const step = spec.steps[0];
  assert.equal(step.stepId, "stp_rank01");
  assert.equal(step.executionBinding.kind, "codeProfile");
  assert.deepEqual(Object.keys(spec.templateInputs).sort(), ["rankRows", "topN"]);
  assert.deepEqual(Object.keys(step.code.outputs).sort(), ["ranking", "report"]);
  assert.equal(step.code.outputs.report.mimeType, "text/markdown");
});

test("ranking Code source is current and under the limit", async () => {
  const spec = JSON.parse(await readFile(TEMPLATE, "utf8"));
  const source = await readFile(path.resolve(HERE, "..", "model", "ranking_code.py"), "utf8");
  assert.equal(spec.steps[0].code.source, source);
  assert.ok(Buffer.byteLength(source, "utf8") <= 65536);
  assert.ok(source.includes("def main("));
});
