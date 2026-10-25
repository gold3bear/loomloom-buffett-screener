#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_PATH = path.resolve(HERE, "..", "model", "valuation_model.py");

function argsOf(argv) {
  const args = { pretty: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (["--packets", "-p"].includes(argv[i])) args.packets = argv[++i];
    else if (["--assumptions", "-a"].includes(argv[i])) args.assumptions = argv[++i];
    else if (["--out", "-o"].includes(argv[i])) args.out = argv[++i];
    else if (["--xlsx", "-x"].includes(argv[i])) args.xlsx = argv[++i];
    else if (argv[i] === "--python") args.python = argv[++i];
    else if (argv[i] === "--no-pretty") args.pretty = false;
    else if (["--help", "-h"].includes(argv[i])) args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

export function runModel({ packets, assumptions, out, xlsx, python, pretty = true }) {
  if (!packets || !assumptions || !out) throw new Error("packets, assumptions, and out are required");
  for (const [label, file] of [["packets", packets], ["assumptions", assumptions]]) {
    if (!existsSync(file)) throw new Error(`${label} file does not exist: ${file}`);
  }
  if (!existsSync(ENGINE_PATH)) throw new Error(`model engine not found: ${ENGINE_PATH}`);
  const interpreter = python || process.env.PYTHON || "python3";
  const argv = [ENGINE_PATH, "--packets", packets, "--assumptions", assumptions, "--out", out];
  if (xlsx) argv.push("--xlsx", xlsx);
  if (pretty) argv.push("--pretty");
  const result = spawnSync(interpreter, argv, { encoding: "utf8" });
  if (result.error) throw new Error(`could not start ${interpreter}: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", interpreter };
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (args.help) {
    return process.stdout.write(
      "node scripts/run-model.mjs --packets <packets.json> --assumptions <assumptions.json> --out <model.json> [--xlsx model.xlsx] [--python python3]\n",
    );
  }
  if (!args.packets || !args.assumptions || !args.out) throw new Error("--packets, --assumptions, and --out are required");
  const result = runModel(args);
  if (result.stderr) process.stderr.write(result.stderr);
  const model = JSON.parse(await readFile(args.out, "utf8"));
  const base = model.scenarios?.[model.baseScenario]?.summary ?? {};
  process.stdout.write(
    `Model ${model.model_ready ? "ready" : "NOT ready"} for ${model.ticker}: ` +
      `base value/share ${base.valuePerShare ?? "—"} ${model.currency}, ` +
      `price ${model.price ?? "—"}, MOS ${typeof base.marginOfSafetyPct === "number" ? (base.marginOfSafetyPct * 100).toFixed(2) + "%" : "—"}` +
      `${args.xlsx ? `, workbook ${args.xlsx}` : ""}\n`,
  );
  if (!model.model_ready) {
    for (const issue of (model.errors ?? []).slice(0, 10)) process.stdout.write(`  ${issue.code} ${issue.path}: ${issue.message}\n`);
    for (const pathName of (model.missingInputs ?? []).slice(0, 10)) process.stdout.write(`  missing: ${pathName}\n`);
  }
  process.exitCode = result.status === 0 ? 0 : 2;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { process.stderr.write(`model error: ${error.message}\n`); process.exitCode = 2; });
