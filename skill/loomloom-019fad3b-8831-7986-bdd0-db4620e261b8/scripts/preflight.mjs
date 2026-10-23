#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;
const QUAL_GROUPS = ["businessModel", "moatEvidence", "managementCulture", "capitalAllocation", "riskFactors", "contraryEvidence", "unknowns"];
const FACT_GROUPS = QUAL_GROUPS.slice(0, 5);

function argsOf(argv) {
  const args = { asOf: new Date().toISOString().slice(0, 10), pretty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (["--input", "-i"].includes(value)) args.input = argv[++i];
    else if (["--output", "-o"].includes(value)) args.output = argv[++i];
    else if (value === "--as-of") args.asOf = argv[++i];
    else if (["--assumptions", "-a"].includes(value)) args.assumptions = argv[++i];
    else if (value === "--require-model") args.requireModel = true;
    else if (value === "--pretty") args.pretty = true;
    else if (["--help", "-h"].includes(value)) args.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.asOf) || Number.isNaN(Date.parse(`${args.asOf}T00:00:00Z`))) throw new Error("--as-of must be a valid YYYY-MM-DD date");
  return args;
}

function issue(code, message, severity = "error", path = "$") {
  return { code, severity, path, message };
}

function objectPacket(value, label, issues) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}
  issues.push(issue("PACKET_NOT_JSON_OBJECT", `${label} must be a JSON object`, "error", label));
  return {};
}

export function explicitCurrency(financial) {
  const match = String(financial?.units ?? "").trim().match(/^(USD|CNY|EUR|GBP|JPY|HKD)\b/);
  return match?.[1] ?? "";
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}/.test(String(value ?? "")) && !Number.isNaN(Date.parse(String(value)));
}

function ageDays(value, asOf) {
  return Math.floor((Date.parse(`${asOf}T23:59:59Z`) - Date.parse(String(value))) / 86400000);
}

function checkDate(value, path, maxDays, asOf, issues, severity = "error") {
  if (!validDate(value)) issues.push(issue("INVALID_DATE", `${path} must be a valid date`, "error", path));
  else if (ageDays(value, asOf) > maxDays) issues.push(issue("STALE_DATA", `${path} is older than ${maxDays} days from the check date`, severity, path));
  else if (ageDays(value, asOf) < -1) issues.push(issue("FUTURE_DATA", `${path} is later than the check date`, "error", path));
}

function checkHistory(history, issues) {
  if (!history || typeof history !== "object" || Array.isArray(history)) {
    issues.push(issue("MISSING_ANNUAL_HISTORY", "financialPacket.annualHistory must be an object", "error", "financialPacket.annualHistory"));
    return;
  }
  const periods = history.fiscalYearEnd;
  if (!Array.isArray(periods) || periods.length < 3 || !periods.every(validDate)) {
    issues.push(issue("INVALID_FISCAL_PERIODS", "annualHistory.fiscalYearEnd must contain at least 3 valid periods", "error", "financialPacket.annualHistory.fiscalYearEnd"));
    return;
  }
  for (const [key, values] of Object.entries(history)) {
    if (key !== "fiscalYearEnd" && Array.isArray(values) && values.length !== periods.length) {
      issues.push(issue("HISTORY_LENGTH_MISMATCH", `annualHistory.${key} length must match fiscalYearEnd`, "error", `financialPacket.annualHistory.${key}`));
    }
  }
}

function checkQualitative(packet, asOf, issues) {
  for (const key of QUAL_GROUPS) {
    if (!Array.isArray(packet[key])) issues.push(issue("MISSING_QUALITATIVE_GROUP", `qualitativePacket.${key} must be an array`, "error", `qualitativePacket.${key}`));
  }
  for (const key of FACT_GROUPS) {
    for (const [index, item] of (packet[key] ?? []).entries()) {
      const path = `qualitativePacket.${key}[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        issues.push(issue("INVALID_QUALITATIVE_FACT", `${path} must be a fact object`, "error", path));
        continue;
      }
      if (!String(item.fact ?? "").trim()) issues.push(issue("FACT_MISSING", `${path}.fact must not be empty`, "error", `${path}.fact`));
      if (!String(item.source ?? "").trim()) issues.push(issue("FACT_SOURCE_MISSING", `${path}.source must not be empty`, "error", `${path}.source`));
      checkDate(item.date, `${path}.date`, 550, asOf, issues, "warning");
    }
  }
}

const MODEL_SCENARIO_FIELDS = ["years", "revenueGrowth", "ebitMargin", "taxRate", "daPctRevenue", "capexPctRevenue", "nwcPctRevenue", "interestRateOnDebt", "debtRepaymentPct", "wacc", "terminalMethod"];

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assumptionsFor(all, ticker) {
  if (!all) return null;
  if (all.scenarios) return all;
  return all[ticker] ?? all[ticker.toUpperCase()] ?? null;
}

const SOURCE_TIERS = new Set(["S", "A", "B", "C"]);
const TIER_GROUPS = ["businessModel", "moatEvidence", "managementCulture", "capitalAllocation", "riskFactors", "contraryEvidence"];

function checkSourceTiers(qualitative, issues) {
  for (const group of TIER_GROUPS) {
    const items = qualitative?.[group];
    if (!Array.isArray(items)) continue;
    for (const [index, item] of items.entries()) {
      const path = `qualitativePacket.${group}[${index}].sourceTier`;
      const tier = String(item?.sourceTier ?? item?.tier ?? "").trim().toUpperCase();
      if (!tier) issues.push(issue("SOURCE_TIER_MISSING", "add sourceTier S/A/B/C so tier gating is explicit", "warning", path));
      else if (!SOURCE_TIERS.has(tier)) issues.push(issue("SOURCE_TIER_INVALID", "sourceTier must be one of S, A, B, C", "error", path));
      else if (tier === "C") issues.push(issue("TIER_C_NOT_EVIDENCE", "C-tier sources cannot carry evidence", "error", path));
    }
  }
}

function checkModelInputs(financial, assumptions, requireModel, issues) {
  const severity = (required) => (required ? "error" : "warning");
  if (!assumptions) {
    issues.push(issue("MODEL_ASSUMPTIONS_MISSING", "no model assumptions supplied; set --assumptions (or --require-model to block)", severity(requireModel), "modelAssumptions"));
    return;
  }
  const scenarios = assumptions.scenarios;
  if (!plainObject(scenarios) || !Object.keys(scenarios).length) {
    issues.push(issue("MODEL_SCENARIOS_MISSING", "model assumptions must contain at least one scenario", "error", "modelAssumptions.scenarios"));
    return;
  }
  let scenarioErrors = 0;
  for (const [name, scenario] of Object.entries(scenarios)) {
    if (!plainObject(scenario)) {
      issues.push(issue("MODEL_SCENARIO_INVALID", `${name} must be an object`, "error", `modelAssumptions.scenarios.${name}`));
      scenarioErrors += 1;
      continue;
    }
    for (const field of MODEL_SCENARIO_FIELDS) {
      if (scenario[field] === undefined || scenario[field] === null) {
        issues.push(issue("MODEL_DRIVER_MISSING", `${name}.${field} is required; the model has no automatic defaults`, "error", `modelAssumptions.scenarios.${name}.${field}`));
        scenarioErrors += 1;
      }
    }
    const years = Number(scenario.years);
    if (!Number.isInteger(years) || years < 1 || years > 10) {
      issues.push(issue("MODEL_YEARS_INVALID", `${name}.years must be an integer between 1 and 10`, "error", `modelAssumptions.scenarios.${name}.years`));
      scenarioErrors += 1;
    }
    for (const field of ["revenueGrowth", "ebitMargin"]) {
      const series = scenario[field];
      if (Array.isArray(series) && Number.isInteger(years) && series.length !== years) {
        issues.push(issue("MODEL_SERIES_LENGTH", `${name}.${field} length must equal years (${years})`, "error", `modelAssumptions.scenarios.${name}.${field}`));
        scenarioErrors += 1;
      }
    }
    const wacc = Number(scenario.wacc);
    if (!(wacc > 0.005 && wacc <= 0.5)) {
      issues.push(issue("MODEL_WACC_INVALID", `${name}.wacc must be between 0.005 and 0.5`, "error", `modelAssumptions.scenarios.${name}.wacc`));
      scenarioErrors += 1;
    }
    if (scenario.terminalMethod === "perpetuity") {
      const growth = Number(scenario.terminalGrowth);
      if (!Number.isFinite(growth) || growth <= -0.5 || growth >= 0.25) {
        issues.push(issue("MODEL_TERMINAL_GROWTH_INVALID", `${name}.terminalGrowth must be between -0.5 and 0.25`, "error", `modelAssumptions.scenarios.${name}.terminalGrowth`));
        scenarioErrors += 1;
      } else if (Number.isFinite(wacc) && wacc <= growth + 0.005) {
        issues.push(issue("MODEL_WACC_NOT_ABOVE_TERMINAL", `${name}.wacc must exceed terminalGrowth by at least 0.5 percentage points`, "error", `modelAssumptions.scenarios.${name}.wacc`));
        scenarioErrors += 1;
      }
    } else if (scenario.terminalMethod === "exitMultiple") {
      if (!(Number(scenario.exitMultiple) > 0)) {
        issues.push(issue("MODEL_EXIT_MULTIPLE_INVALID", `${name}.exitMultiple must be positive`, "error", `modelAssumptions.scenarios.${name}.exitMultiple`));
        scenarioErrors += 1;
      }
    } else {
      issues.push(issue("MODEL_TERMINAL_METHOD_INVALID", `${name}.terminalMethod must be 'perpetuity' or 'exitMultiple'`, "error", `modelAssumptions.scenarios.${name}.terminalMethod`));
      scenarioErrors += 1;
    }
  }
  if (!Array.isArray(assumptions.sources) || !assumptions.sources.length) {
    issues.push(issue("MODEL_ASSUMPTIONS_WITHOUT_SOURCES", "assumptions.sources should name the owner and date of every driver", "warning", "modelAssumptions.sources"));
  }

  const bs = plainObject(financial?.balanceSheet) ? financial.balanceSheet : financial ?? {};
  const shares = bs.sharesOutstanding ?? financial?.sharesOutstanding ?? financial?.marketSnapshot?.sharesOutstanding;
  if (requireModel) {
    const price = Number(financial?.marketSnapshot?.price);
    const marketCap = Number(financial?.marketSnapshot?.marketCapUsd);
    if (!(marketCap > 0)) {
      issues.push(issue("MODEL_MARKET_CAP_MISSING", "marketSnapshot.marketCapUsd is required for the ±2% reconciliation", "error", "financialPacket.marketSnapshot.marketCapUsd"));
    } else if (Number(shares) > 0 && Number(price) > 0) {
      const delta = Math.abs(price * Number(shares) - marketCap) / marketCap;
      if (delta > 0.02) issues.push(issue("MODEL_MARKET_CAP_MISMATCH", `price * shares differs from marketCapUsd by ${(delta * 100).toFixed(2)}%`, "error", "financialPacket.marketSnapshot.marketCapUsd"));
    }
  }
  const equity = bs.equity ?? bs.totalEquity ?? bs.shareholdersEquity ?? bs.stockholdersEquity;
  const nwc = bs.nwc ?? bs.netWorkingCapital;
  const hasWorkingCapital = nwc !== undefined || (bs.currentAssets !== undefined && bs.currentLiabilities !== undefined);
  const ppe = bs.netPPE ?? bs.ppeNet ?? bs.propertyPlantAndEquipmentNet;
  if (!(Number(shares) > 0)) issues.push(issue("MODEL_SHARES_MISSING", "balanceSheet.sharesOutstanding is required for per-share model values", "error", "financialPacket.balanceSheet.sharesOutstanding"));
  if (equity === undefined) issues.push(issue("MODEL_EQUITY_MISSING", "balanceSheet.equity is required", "error", "financialPacket.balanceSheet.equity"));
  if (!hasWorkingCapital) issues.push(issue("MODEL_NWC_MISSING", "supply balanceSheet.netWorkingCapital, or currentAssets and currentLiabilities", "error", "financialPacket.balanceSheet.netWorkingCapital"));
  if (ppe === undefined && bs.totalAssets === undefined) issues.push(issue("MODEL_PPE_MISSING", "supply balanceSheet.netPPE or totalAssets", "error", "financialPacket.balanceSheet.netPPE"));
  if (scenarioErrors) issues.push(issue("MODEL_NOT_READY", "the model will refuse to run until the driver errors above are fixed", "error", "modelAssumptions"));
}

function checkRow(raw, rowIndex, asOf, modelOptions = {}) {
  const issues = [];
  const identity = objectPacket(raw?.identityPacket, "identityPacket", issues);
  const financial = objectPacket(raw?.financialPacket, "financialPacket", issues);
  const qualitative = objectPacket(raw?.qualitativePacket, "qualitativePacket", issues);
  const ticker = String(raw?.ticker ?? identity.ticker ?? "").trim().toUpperCase();
  if (!TICKER.test(ticker)) issues.push(issue("INVALID_TICKER", "ticker format is invalid", "error", "ticker"));
  if (raw?.ticker && String(identity.ticker ?? "").trim().toUpperCase() !== ticker) issues.push(issue("TICKER_MISMATCH", "row ticker does not match identityPacket.ticker", "error", "ticker"));
  if (!String(identity.companyName ?? "").trim()) issues.push(issue("COMPANY_NAME_MISSING", "identityPacket.companyName must not be empty", "error", "identityPacket.companyName"));
  if (!String(identity.fiscalPeriod ?? "").trim()) issues.push(issue("FISCAL_PERIOD_MISSING", "identityPacket.fiscalPeriod must not be empty", "error", "identityPacket.fiscalPeriod"));
  checkDate(identity.dataAsOf, "identityPacket.dataAsOf", 45, asOf, issues);
  if (!Array.isArray(identity.sources) || !identity.sources.some((source) => /^https:\/\//.test(String(source)))) {
    issues.push(issue("SOURCES_MISSING", "identityPacket.sources must contain at least one HTTPS source", "error", "identityPacket.sources"));
  }

  const snapshot = financial.marketSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    issues.push(issue("MISSING_MARKET_SNAPSHOT", "financialPacket.marketSnapshot must be an object", "error", "financialPacket.marketSnapshot"));
  } else {
    checkDate(snapshot.asOf, "financialPacket.marketSnapshot.asOf", 7, asOf, issues);
    if (!(Number(snapshot.price) > 0)) issues.push(issue("INVALID_PRICE", "marketSnapshot.price must be a positive number", "error", "financialPacket.marketSnapshot.price"));
    if (!String(snapshot.currency ?? "").trim()) {
      const currency = explicitCurrency(financial);
      if (currency) issues.push(issue("CURRENCY_NORMALIZED_FROM_UNITS", `price currency can be normalized from financialPacket.units to ${currency}`, "warning", "financialPacket.marketSnapshot.currency"));
      else issues.push(issue("CURRENCY_MISSING", "marketSnapshot.currency must not be empty", "error", "financialPacket.marketSnapshot.currency"));
    }
    if (snapshot.pe !== null && snapshot.pe !== undefined && !Number.isFinite(Number(snapshot.pe))) issues.push(issue("INVALID_PE", "marketSnapshot.pe must be a number or null", "error", "financialPacket.marketSnapshot.pe"));
    if ((snapshot.pe === null || snapshot.pe === undefined) && !(financial.unknowns ?? []).some((item) => /\b(pe|p\/e|earnings|loss)\b/i.test(String(item)))) {
      issues.push(issue("PE_UNKNOWN_UNEXPLAINED", "PE missing must be explained in financialPacket.unknowns", "warning", "financialPacket.unknowns"));
    }
  }
  checkHistory(financial.annualHistory, issues);
  checkQualitative(qualitative, asOf, issues);
  checkSourceTiers(qualitative, issues);
  checkModelInputs(financial, assumptionsFor(modelOptions.assumptions, ticker), Boolean(modelOptions.requireModel), issues);
  const errorCount = issues.filter(({ severity }) => severity === "error").length;
  return { rowIndex, ticker, valid: errorCount === 0, status: errorCount ? "blocked" : issues.length ? "degraded" : "ready", errorCount, warningCount: issues.length - errorCount, issues };
}

export function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.inputRows)) return payload.inputRows;
  return [payload];
}

export function preflight(payload, { asOf = new Date().toISOString().slice(0, 10), assumptions = null, requireModel = false } = {}) {
  const rows = rowsOf(payload).map((row, index) => checkRow(row, index, asOf, { assumptions, requireModel }));
  const blockedRows = rows.filter(({ valid }) => !valid).length;
  const degradedRows = rows.filter(({ status }) => status === "degraded").length;
  return { schemaVersion: "loomloom-us-value-input-preflight/v1", asOf, valid: blockedRows === 0, summary: { totalRows: rows.length, readyRows: rows.length - blockedRows - degradedRows, degradedRows, blockedRows }, rows };
}

async function readText(path) {
  if (path !== "-") return readFile(path, "utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (args.help) return process.stdout.write("node scripts/preflight.mjs --input <packets.json|-> [--assumptions <assumptions.json>] [--require-model] [--as-of YYYY-MM-DD] [--output report.json] [--pretty]\n");
  if (!args.input) throw new Error("--input is required");
  const assumptions = args.assumptions ? JSON.parse(await readText(args.assumptions)) : null;
  const report = preflight(JSON.parse(await readText(args.input)), { asOf: args.asOf, assumptions, requireModel: Boolean(args.requireModel) });
  const output = `${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`;
  if (args.output) await writeFile(args.output, output, "utf8"); else process.stdout.write(output);
  process.exitCode = report.valid ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { process.stderr.write(`preflight error: ${error.message}\n`); process.exitCode = 2; });
