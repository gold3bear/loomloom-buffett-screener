#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { explicitCurrency, preflight, rowsOf } from "./preflight.mjs";

function argsOf(argv) {
  const args = { pretty: false, asOf: new Date().toISOString().slice(0, 10) };
  for (let i = 0; i < argv.length; i += 1) {
    if (["--input", "-i"].includes(argv[i])) args.input = argv[++i];
    else if (["--output", "-o"].includes(argv[i])) args.output = argv[++i];
    else if (argv[i] === "--as-of") args.asOf = argv[++i];
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
      return { identityPacket: JSON.stringify(identity), financialPacket: JSON.stringify(financial), qualitativePacket: JSON.stringify(qualitative) };
    }),
  };
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (args.help) return process.stdout.write("node scripts/prepare-market-input.mjs --input <packets.json> --output <request.json> [--as-of YYYY-MM-DD] [--pretty]\n");
  if (!args.input || !args.output) throw new Error("--input and --output are both required");
  const payload = JSON.parse(await readFile(args.input, "utf8"));
  const request = prepareRequest(payload, { asOf: args.asOf });
  await writeFile(args.output, `${JSON.stringify(request, null, args.pretty ? 2 : 0)}\n`, "utf8");
  process.stdout.write(`Generated ${request.inputRows.length} Market request row(s): ${args.output}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => {
  // Exit 1 on preflight validation failure; exit 2 on system / parameter error.
  if (/preflight failed/.test(error.message)) process.exitCode = 1;
  else { process.stderr.write(`request preparation error: ${error.message}\n`); process.exitCode = 2; }
});
