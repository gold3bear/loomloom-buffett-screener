#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { explicitCurrency, preflight, rowsOf } from "./preflight.mjs";

function argsOf(argv) {
  const args = { pretty: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (["--input", "-i"].includes(argv[i])) args.input = argv[++i];
    else if (["--output", "-o"].includes(argv[i])) args.output = argv[++i];
    else if (argv[i] === "--as-of") args.asOf = argv[++i];
    else if (["--assumptions", "-a"].includes(argv[i])) args.assumptions = argv[++i];
    else if (argv[i] === "--require-model") args.requireModel = true;
    else if (argv[i] === "--pretty") args.pretty = true;
    else if (["--help", "-h"].includes(argv[i])) args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function packetObject(value, label, index) {
  if (typeof value === "string") {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`row ${index + 1}: ${label} is not a JSON object`);
    return parsed;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`row ${index + 1} is missing ${label}`);
  return structuredClone(value);
}

function assumptionsFor(all, ticker) {
  if (!all) return null;
  if (all.scenarios) return all;
  const key = String(ticker ?? "").toUpperCase();
  return all[key] ?? all[key.toLowerCase()] ?? null;
}

export function prepareRequest(payload, options = {}) {
  const report = preflight(payload, options);
  if (!report.valid) throw new Error(`preflight failed: ${report.summary.blockedRows} row(s) blocked`);
  return {
    inputRows: rowsOf(payload).map((row, index) => {
      const identity = packetObject(row.identityPacket, "identityPacket", index);
      const financial = packetObject(row.financialPacket, "financialPacket", index);
      const qualitative = packetObject(row.qualitativePacket, "qualitativePacket", index);
      const currency = explicitCurrency(financial);
      if (financial.marketSnapshot && !financial.marketSnapshot.currency && currency) financial.marketSnapshot.currency = currency;

      const entry = { identityPacket: JSON.stringify(identity), financialPacket: JSON.stringify(financial), qualitativePacket: JSON.stringify(qualitative) };
      const assumptions = row.modelAssumptions ?? assumptionsFor(options.assumptions, identity.ticker);
      if (assumptions) entry.modelAssumptions = typeof assumptions === "string" ? assumptions : JSON.stringify(assumptions);
      // asOf is an explicit public input row field; options.asOf remains the
      // local freshness check date and must not leak into legacy rows.
      if (row.asOf) entry.asOf = String(row.asOf);
      return entry;
    }),
  };
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (args.help) return process.stdout.write("node scripts/prepare-market-input.mjs --input <packets.json> --output <request.json> [--assumptions <assumptions.json>] [--require-model] [--as-of YYYY-MM-DD] [--pretty]\n");
  if (!args.input || !args.output) throw new Error("--input and --output are both required");
  const payload = JSON.parse(await readFile(args.input, "utf8"));
  const assumptions = args.assumptions ? JSON.parse(await readFile(args.assumptions, "utf8")) : null;
  const request = prepareRequest(payload, { asOf: args.asOf, assumptions, requireModel: Boolean(args.requireModel) });
  await writeFile(args.output, `${JSON.stringify(request, null, args.pretty ? 2 : 0)}\n`, "utf8");
  process.stdout.write(`Generated ${request.inputRows.length} Market request row(s): ${args.output}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => {
  // Exit 1 on preflight validation failure; exit 2 on system / parameter error.
  if (/preflight failed/.test(error.message)) process.exitCode = 1;
  else { process.stderr.write(`request preparation error: ${error.message}\n`); process.exitCode = 2; }
});
