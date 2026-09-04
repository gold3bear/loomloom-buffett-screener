#!/usr/bin/env node
// Prepare JSONL input for the cogfoundry TemplateSpec ("Buffett Four-Filters
// US Equity Screening"). The cogfoundry template does not consume the standard
// Market inputRows shape ({identityPacket, financialPacket, qualitativePacket}
// per row); it expects a single `tickerPacket` string that joins the three
// packet JSON objects with newlines, in identityPacket -> financialPacket ->
// qualitativePacket order. The reassembly rules live in
// `merge-public-results.mjs` (`parseInput` preferred-0 path).
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

export function prepareCogfoundryInput(request) {
  if (!request || typeof request !== "object") throw new Error("input is not an object");
  if (!Array.isArray(request.inputRows)) throw new Error("input is missing inputRows array");
  return request.inputRows.map((row, index) => ({
    tickerPacket: tickerPacketFromRow(row, index),
  }));
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "node scripts/prepare-cogfoundry-input.mjs --input <market-request.json> --output <cogfoundry.jsonl>\n"
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
