#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { preflight, rowsOf } from "./preflight.mjs";

function argsOf(argv) {
  const args = { pretty: false, requireModel: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (["--packets", "-p"].includes(argv[i])) args.packets = argv[++i];
    else if (["--assumptions", "-a"].includes(argv[i])) args.assumptions = argv[++i];
    else if (["--model", "-m"].includes(argv[i])) args.model = argv[++i];
    else if (["--audit", "-u"].includes(argv[i])) args.audit = argv[++i];
    else if (["--xlsx", "-x"].includes(argv[i])) args.xlsx = argv[++i];
    else if (argv[i] === "--as-of") args.asOf = argv[++i];
    else if (argv[i] === "--require-model") args.requireModel = true;
    else if (["--output", "-o"].includes(argv[i])) args.output = argv[++i];
    else if (argv[i] === "--pretty") args.pretty = true;
    else if (["--help", "-h"].includes(argv[i])) args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function check(id, severity, passed, detail) {
  return { id, severity, passed: Boolean(passed), detail: String(detail ?? "") };
}

function sameText(left, right) {
  return String(left ?? "").trim() === String(right ?? "").trim();
}

function closeNumber(left, right, relative = 1e-6) {
  if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) <= Math.max(1e-9, Math.abs(right) * relative);
}

function packetFor(payload, ticker) {
  const rows = rowsOf(payload);
  if (!ticker) return rows[0] ?? null;
  return rows.find((row) => {
    const identity = asObject(row?.identityPacket) ?? row ?? {};
    return String(identity.ticker ?? row?.ticker ?? "").toUpperCase() === ticker;
  }) ?? null;
}

function sharesOf(packet) {
  const financial = asObject(packet?.financialPacket) ?? {};
  const balanceSheet = asObject(financial.balanceSheet) ?? {};
  const market = asObject(financial.marketSnapshot) ?? {};
  return balanceSheet.sharesOutstanding ?? financial.sharesOutstanding ?? market.sharesOutstanding;
}

async function workbookCheck(xlsx) {
  const checks = [];
  if (!xlsx) return checks;
  if (!existsSync(xlsx)) {
    checks.push(check("workbook.exists", "error", false, `workbook not found: ${xlsx}`));
    return checks;
  }
  const bytes = await readFile(xlsx);
  checks.push(check("workbook.signature", "error", bytes.length > 1000 && bytes.subarray(0, 2).toString() === "PK", `xlsx zip signature, ${bytes.length} bytes`));
  const listing = spawnSync("unzip", ["-l", xlsx], { encoding: "utf8" });
  if (listing.error || listing.status !== 0) {
    checks.push(check("workbook.sheets", "warning", true, "unzip unavailable; sheet names not inspected"));
    return checks;
  }
  const sheets = (listing.stdout.match(/xl\/worksheets\/sheet\d+\.xml/g) ?? []).length;
  for (const required of ["xl/workbook.xml", "xl/styles.xml"]) {
    checks.push(check(`workbook.${required}`, "error", listing.stdout.includes(required), `${required} present`));
  }
  checks.push(check("workbook.minSheets", "error", sheets >= 5, `${sheets} worksheet XML parts`));
  return checks;
}

export function checkInvariants({ packets, assumptions = null, model = null, audit = null, xlsx = null, asOf, requireModel = false } = {}) {
  const checks = [];
  const ticker = String(model?.ticker ?? "").toUpperCase();

  const preflightReport = preflight(packets, { asOf, assumptions, requireModel });
  for (const row of preflightReport.rows) {
    const failures = row.issues.filter((issue) => issue.severity === "error");
    checks.push(
      check(
        `packet.preflight.${row.ticker || row.rowIndex}`,
        "error",
        row.valid,
        failures.length ? failures.map((issue) => `${issue.code}@${issue.path}`).join("; ") : "all packet and model-input checks passed",
      ),
    );
    for (const issue of row.issues.filter((entry) => entry.severity === "warning")) {
      checks.push(check(`packet.warning.${row.ticker || row.rowIndex}.${issue.code}`, "warning", true, `${issue.path}: ${issue.message}`));
    }
  }

  if (!model) {
    checks.push(check("model.present", "error", !requireModel, requireModel ? "no model supplied and --require-model is set" : "model not supplied; skipped model invariants"));
  } else {
    const packet = packetFor(packets, ticker);
    const identity = asObject(packet?.identityPacket) ?? {};
    const financial = asObject(packet?.financialPacket) ?? {};
    const market = asObject(financial.marketSnapshot) ?? {};
    const modelAssumptions = asObject(model.assumptions) ?? {};
    const scenarios = asObject(model.scenarios) ?? {};
    const baseName = String(model.baseScenario ?? "base");
    const base = asObject(scenarios[baseName]) ?? {};
    const summary = asObject(base.summary) ?? {};

    checks.push(check("model.ready", "error", model.model_ready === true, `model_ready=${model.model_ready}; errors=${(model.errors ?? []).length}`));
    checks.push(check("model.packetFound", "error", Boolean(packet), packet ? `matched ${ticker}` : `no packet row for ${ticker}`));
    checks.push(check("model.tickerMatchesPacket", "error", sameText(ticker, identity.ticker), `model=${ticker}, packet=${identity.ticker ?? ""}`));
    checks.push(check("model.priceMatchesPacket", "error", closeNumber(model.price, market.price), `model=${model.price}, packet=${market.price}`));
    checks.push(check("model.priceAsOfMatchesPacket", "error", sameText(model.priceAsOf, market.asOf), `model=${model.priceAsOf ?? ""}, packet=${market.asOf ?? ""}`));
    checks.push(
      check(
        "model.asOfMatchesPacket",
        "error",
        sameText(model.asOf, modelAssumptions.asOf) || sameText(model.asOf, identity.dataAsOf),
        `model=${model.asOf ?? ""}, assumptions=${modelAssumptions.asOf ?? ""}, packet=${identity.dataAsOf ?? ""}`,
      ),
    );
    checks.push(check("model.currencyMatchesPacket", "error", !market.currency || sameText(model.currency, market.currency), `model=${model.currency ?? ""}, packet=${market.currency ?? ""}`));
    checks.push(check("model.sharesMatchesPacket", "error", closeNumber(modelAssumptions.sharesOutstanding, sharesOf(packet), 1e-6), `model=${modelAssumptions.sharesOutstanding}, packet=${sharesOf(packet)}`));

    checks.push(check("model.baseScenarioPresent", "error", Boolean(base && base.summary), `baseScenario=${baseName}`));
    const finiteFields = ["valuePerShare", "enterpriseValue", "equityValue", "marginOfSafetyPct", "netDebt"];
    const badFields = finiteFields.filter((field) => typeof summary[field] === "number" && !Number.isFinite(summary[field]));
    const missingFields = finiteFields.filter((field) => summary[field] === undefined);
    checks.push(check("model.baseSummaryFinite", "error", badFields.length === 0 && missingFields.length === 0, badFields.length || missingFields.length ? `bad=${badFields.join(",")} missing=${missingFields.join(",")}` : "all summary fields finite"));

    const opening = asObject(model.openingBalanceSheet) ?? {};
    const openingNetDebt = Number(opening.debt ?? 0) - Number(opening.cash ?? 0);
    const bridgeFailures = Object.entries(scenarios).filter(([, scenario]) => {
      const entry = asObject(scenario?.summary) ?? {};
      return !closeNumber(entry.netDebt, openingNetDebt, 1e-6) || !closeNumber(entry.equityValue, Number(entry.enterpriseValue ?? 0) - openingNetDebt, 1e-6);
    });
    checks.push(
      check(
        "model.equityBridgeUsesOpeningNetDebt",
        "error",
        bridgeFailures.length === 0,
        bridgeFailures.length
          ? `scenarios ${bridgeFailures.map(([name]) => name).join(", ")} do not use opening net debt ${openingNetDebt}`
          : `all scenarios use opening net debt ${openingNetDebt}`,
      ),
    );

    const scenarioChecks = Object.entries(scenarios).flatMap(([name, scenario]) => (scenario?.checks ?? []).map((entry) => ({ ...entry, scenario: name })));
    const failedScenarioChecks = scenarioChecks.filter((entry) => entry.severity === "error" && !entry.passed);
    checks.push(check("model.scenarioChecksPassed", "error", failedScenarioChecks.length === 0, failedScenarioChecks.length ? failedScenarioChecks.map((entry) => `${entry.scenario}.${entry.name}`).join("; ") : `${scenarioChecks.length} scenario checks passed`));

    const modelChecks = (model.modelChecks ?? []).filter((entry) => entry.severity === "error");
    const failedModelChecks = modelChecks.filter((entry) => !entry.passed);
    checks.push(check("model.modelChecksPassed", "error", modelChecks.length > 0 && failedModelChecks.length === 0, modelChecks.length ? (failedModelChecks.length ? failedModelChecks.map((entry) => entry.name).join("; ") : `${modelChecks.length} model invariants passed`) : "modelChecks missing"));

    const grid = model.sensitivity?.valuesPerShare;
    const shapeOk = Array.isArray(grid) && grid.length === 5 && grid.every((row) => Array.isArray(row) && row.length === 5);
    checks.push(check("model.sensitivityShape", "error", shapeOk, shapeOk ? "5x5 grid" : "expected 5 rows x 5 columns"));
    const center = shapeOk ? grid[2][2] : null;
    checks.push(check("model.sensitivityCenter", "error", closeNumber(center, summary.valuePerShare, 1e-6), `center=${center}, base=${summary.valuePerShare}`));

    if (model.reverseDcf?.solved) {
      checks.push(check("model.reverseDcf", "error", closeNumber(model.reverseDcf.impliedValuePerShare, model.price, 0.01), `implied=${model.reverseDcf.impliedValuePerShare}, price=${model.price}`));
    } else {
      checks.push(check("model.reverseDcf", "warning", true, `not solved: ${model.reverseDcf?.reason ?? "unsolved"}`));
    }
  }

  if (audit) {
    checks.push(check("audit.valid", "error", audit.valid === true, `valid=${audit.valid}`));
    checks.push(check("audit.modelMismatch", "error", (audit.summary?.modelMismatchRows ?? 0) === 0, `${audit.summary?.modelMismatchRows ?? 0} mismatched row(s)`));
    const mismatched = (audit.rows ?? []).filter((row) => row.model_audit?.status === "mismatch");
    checks.push(check("audit.rowsNoMismatch", "error", mismatched.length === 0, mismatched.length ? mismatched.map((row) => row.ticker).join(", ") : "no row-level model mismatch"));
    if (requireModel) {
      const unmodeled = (audit.rows ?? []).filter((row) => row.valid && !row.investment_model);
      checks.push(check("audit.requireModel", "error", unmodeled.length === 0, unmodeled.length ? `unmodeled: ${unmodeled.map((row) => row.ticker).join(", ")}` : "every accepted row has a model"));
    }
  }

  return workbookCheck(xlsx).then((workbookChecks) => {
    checks.push(...workbookChecks);
    const failedErrors = checks.filter((entry) => entry.severity === "error" && !entry.passed).length;
    const failedWarnings = checks.filter((entry) => entry.severity === "warning" && !entry.passed).length;
    return {
      schemaVersion: "loomloom-invariant-report/v1",
      passed: failedErrors === 0,
      summary: { total: checks.length, errors: checks.filter((entry) => entry.severity === "error").length, warnings: checks.filter((entry) => entry.severity === "warning").length, failedErrors, failedWarnings },
      checks,
    };
  });
}

async function readJsonOrNull(path) {
  if (!path) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (args.help) {
    return process.stdout.write(
      "node scripts/check-invariants.mjs --packets <packets.json> [--assumptions a.json] [--model model.json] [--audit audit.json] [--xlsx model.xlsx] [--require-model] [--as-of YYYY-MM-DD] [--output invariant.json] [--pretty]\n",
    );
  }
  if (!args.packets) throw new Error("--packets is required");
  const report = await checkInvariants({
    packets: JSON.parse(await readFile(args.packets, "utf8")),
    assumptions: await readJsonOrNull(args.assumptions),
    model: await readJsonOrNull(args.model),
    audit: await readJsonOrNull(args.audit),
    xlsx: args.xlsx,
    asOf: args.asOf,
    requireModel: args.requireModel,
  });
  const output = `${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`;
  if (args.output) await writeFile(args.output, output, "utf8");
  else process.stdout.write(output);
  const failed = report.checks.filter((entry) => entry.severity === "error" && !entry.passed);
  process.stderr.write(
    `invariants: ${report.passed ? "PASS" : "FAIL"} | ${report.summary.errors - report.summary.failedErrors}/${report.summary.errors} error checks, ` +
      `${report.summary.warnings - report.summary.failedWarnings}/${report.summary.warnings} warnings` +
      `${failed.length ? ` | failed: ${failed.map((entry) => entry.id).slice(0, 8).join(", ")}` : ""}\n`,
  );
  process.exitCode = report.passed ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { process.stderr.write(`invariant error: ${error.message}\n`); process.exitCode = 2; });
