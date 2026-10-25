#!/usr/bin/env node
// Prepare JSONL input for the cogfoundry TemplateSpec.
//
// Two shapes are supported:
//
// * Legacy v3: `tickerPacket` is a newline-joined string of the three packet
//   JSON objects (identity -> financial -> qualitative). The reassembly rules
//   live in `merge-public-results.mjs` (`parseInput` preferred-0 path).
// * v4: when a row has `modelAssumptions` or `asOf`, `tickerPacket` becomes one
//   JSON object containing identityPacket / financialPacket / qualitativePacket,
//   and `modelAssumptions` / `asOf` travel beside it.
//
//
// Input  (--input):  the standard Market-request file produced by
//                    `scripts/prepare-market-input.mjs`
//                    shape: { inputRows: [{identityPacket, financialPacket,
//                                           qualitativePacket}, ...] }
//                    (each value is a JSON-encoded string of the packet)
// Output (--output): one JSONL line per input row, each value
//                    { tickerPacket: "<id JSON>\n<fin JSON>\n<qual JSON>" }
//
// The order MUST match the template prompt's "Reassemble: identity ->
// financial -> qualitative" instruction. Reordering silently breaks every
// source_ref that points into financialPacket or qualitativePacket.

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

function argsOf(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (["--input", "-i"].includes(argv[i])) args.input = argv[++i];
    else if (["--output", "-o"].includes(argv[i])) args.output = argv[++i];
    else if (["--help", "-h"].includes(argv[i])) args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

export function tickerPacketFromRow(row, index) {
  if (!row || typeof row !== "object") {
    throw new Error(`row ${index + 1} is not an object`);
  }
  for (const key of ["identityPacket", "financialPacket", "qualitativePacket"]) {
    if (typeof row[key] !== "string" || !row[key].trim()) {
      throw new Error(`row ${index + 1} is missing or has non-string ${key}`);
    }
    // Each packet must itself be valid JSON; otherwise the template's prompt
    // will receive a malformed inner JSON and the LLM will produce garbage.
    try {
      const parsed = JSON.parse(row[key]);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not a JSON object");
      }
    } catch (cause) {
      throw new Error(`row ${index + 1} ${key} is not valid JSON: ${cause.message}`);
    }
  }
  // The newline-joined form is what merge-public-results.parseInput looks for
  // under the cogfoundry path (preferred 0). Do not use a different separator.
  return [row.identityPacket, row.financialPacket, row.qualitativePacket].join("\n");
}

export function isV4Row(row) {
  return row && (row.modelAssumptions !== undefined || row.asOf !== undefined);
}

// v4 template: tickerPacket is ONE JSON object, not newline-joined segments.
// modelAssumptions and asOf travel beside it as separate template inputs.
export function tickerPacketObjectFromRow(row, index) {
  if (!row || typeof row !== "object") throw new Error(`row ${index + 1} is not an object`);
  const packets = {};
  for (const key of ["identityPacket", "financialPacket", "qualitativePacket"]) {
    if (typeof row[key] !== "string" || !row[key].trim()) throw new Error(`row ${index + 1} is missing or has non-string ${key}`);
    try {
      const parsed = JSON.parse(row[key]);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a JSON object");
      packets[key] = parsed;
    } catch (cause) {
      throw new Error(`row ${index + 1} ${key} is not valid JSON: ${cause.message}`);
    }
  }
  return JSON.stringify(packets);
}

export function v4RowFromRow(row, index) {
  const entry = { tickerPacket: tickerPacketObjectFromRow(row, index) };
  if (row.modelAssumptions !== undefined) {
    entry.modelAssumptions = typeof row.modelAssumptions === "string" ? row.modelAssumptions : JSON.stringify(row.modelAssumptions);
  }
  if (row.asOf !== undefined) entry.asOf = String(row.asOf);
  return entry;
}

export function prepareCogfoundryInput(request) {
  if (!request || typeof request !== "object") throw new Error("input is not an object");
  if (!Array.isArray(request.inputRows)) throw new Error("input is missing inputRows array");
  return request.inputRows.map((row, index) => (isV4Row(row) ? v4RowFromRow(row, index) : { tickerPacket: tickerPacketFromRow(row, index) }));
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "node scripts/prepare-cogfoundry-input.mjs --input <market-request.json> --output <.jsonl>\n"
    );
    return;
  }
  if (!args.input || !args.output) {
    throw new Error("--input and --output are both required");
  }
  const request = JSON.parse(await readFile(args.input, "utf8"));
  const rows = prepareCogfoundryInput(request);
  await writeFile(
    args.output,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8"
  );
  process.stdout.write(`Generated ${rows.length} cogfoundry row(s): ${args.output}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`cogfoundry input preparation error: ${error.message}\n`);
    process.exitCode = 2;
  });
}
