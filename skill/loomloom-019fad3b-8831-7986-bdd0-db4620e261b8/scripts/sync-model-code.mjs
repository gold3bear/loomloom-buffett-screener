#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_PATH = path.resolve(HERE, "..", "model", "valuation_model.py");
export const CLOUD_ENGINE_PATH = path.resolve(HERE, "..", "model", "valuation_model.cloud.py");
export const PREFLIGHT_PATH = path.resolve(HERE, "..", "model", "preflight_code.py");
const MAX_CODE_BYTES = 65536;
export const DEFAULT_TEMPLATE = path.resolve(HERE, "..", "..", "..", "templates", "buffett-four-filters-model.cogfoundry", "template.json");

// Every codeProfile step must appear here. The sync refuses to leave a code step
// unmanaged, so a newly added node cannot silently ship an empty source.
export const CODE_SOURCES = {
  stp_preflight: PREFLIGHT_PATH,
  stp_model01: CLOUD_ENGINE_PATH,
};

function argsOf(argv) {
  const args = { template: DEFAULT_TEMPLATE, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (["--template", "-t"].includes(argv[i])) args.template = argv[++i];
    else if (argv[i] === "--check") args.check = true;
    else if (["--help", "-h"].includes(argv[i])) args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

export function codeSteps(template) {
  const spec = template?.canonicalSpecV2 ?? template;
  const steps = (spec?.steps ?? []).filter((candidate) => candidate?.executionBinding?.kind === "codeProfile");
  if (!steps.length) throw new Error("template has no codeProfile step");
  for (const step of steps) {
    if (!step.code) throw new Error(`${step.stepId} has no code block`);
    if (!CODE_SOURCES[step.stepId]) throw new Error(`${step.stepId} is a codeProfile step without a registered source`);
  }
  return steps;
}

export function templateBody(template) {
  return `${JSON.stringify(template, null, 2)}\n`;
}

export async function syncTemplate({ templatePath = DEFAULT_TEMPLATE, write = true } = {}) {
  const raw = await readFile(templatePath, "utf8");
  const template = JSON.parse(raw);
  const entries = [];
  let anyChanged = false;

  for (const step of codeSteps(template)) {
    const source = await readFile(CODE_SOURCES[step.stepId], "utf8");
    const sourceBytes = Buffer.byteLength(source, "utf8");
    if (sourceBytes > MAX_CODE_BYTES) {
      throw new Error(`${step.stepId} source is ${sourceBytes} bytes, over the ${MAX_CODE_BYTES}-byte Code limit`);
    }
    const previous = step.code.source ?? "";
    const changed = previous !== source;
    anyChanged ||= changed;
    step.code.source = source;
    entries.push({
      stepId: step.stepId,
      changed,
      sourceBytes,
      sourcePath: CODE_SOURCES[step.stepId],
      sha256: createHash("sha256").update(source).digest("hex"),
    });
  }

  if (write && anyChanged) await writeFile(templatePath, templateBody(template), "utf8");
  const modelEntry = entries.find((entry) => entry.stepId === "stp_model01") ?? entries[entries.length - 1];
  return {
    templatePath,
    changed: anyChanged,
    steps: entries,
    stepId: modelEntry.stepId,
    sourceBytes: modelEntry.sourceBytes,
    sha256: modelEntry.sha256,
  };
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (args.help) return process.stdout.write("node scripts/sync-model-code.mjs [--template <template.json>] [--check]\n");
  const result = await syncTemplate({ templatePath: args.template, write: !args.check });
  for (const entry of result.steps) {
    const verb = args.check ? (entry.changed ? "DRIFT" : "current") : entry.changed ? "injected" : "current";
    process.stdout.write(`${verb}: ${entry.stepId} ${entry.sourceBytes} bytes, sha256 ${entry.sha256}\n`);
  }
  if (args.check && result.changed) {
    process.stderr.write("one or more code steps differ from their source files; run sync-model-code.mjs to update the template\n");
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { process.stderr.write(`sync error: ${error.message}\n`); process.exitCode = 2; });
