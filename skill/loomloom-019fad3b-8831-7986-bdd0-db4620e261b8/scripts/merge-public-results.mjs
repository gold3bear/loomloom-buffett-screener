#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const DIMENSIONS = ["business", "moat", "financial", "valuation"];
const WEIGHTS = { understandability: 0.10, business_model: 0.20, moat: 0.20, management_capital_allocation: 0.15, financial_quality: 0.20, valuation_opportunity_cost: 0.15 };
const CONFIDENCE = { high: 3, medium: 2, low: 1 };
// M-4: per-dimension evidence_records count cap + per-source_value string length cap to keep reports bounded.
const MAX_EVIDENCE_RECORDS = 50;
const MAX_SOURCE_VALUE_CHARS = 2000;
const MAX_UNKNOWN_ITEMS = 200;
// M-5: scoring and confidence thresholds centralized so the values can be reviewed in one place.
const DEEP_RESEARCH_THRESHOLD = 75;
const WATCHLIST_THRESHOLD = 60;
const WEAK_SCORE_THRESHOLD = 30;
const HIGH_CONFIDENCE_MIN_EVIDENCE = 8;
const HIGH_CONFIDENCE_MAX_UNKNOWNS = 3;
const UNKNOWN_WARN_THRESHOLD = 3;
const EXCESSIVE_REJECTED_EVIDENCE_MIN = 6;

function argsOf(argv) {
  const args = { pretty: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (["--input", "-i"].includes(argv[i])) args.input = argv[++i];
    else if (["--output", "-o"].includes(argv[i])) args.output = argv[++i];
    else if (argv[i] === "--pretty") args.pretty = true;
    else if (["--help", "-h"].includes(argv[i])) args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

function parseJson(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) return { value: null, normalized: false, error: `${label} is empty` };
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```/i);
  try { return { value: JSON.parse(fenced ? fenced[1] : raw), normalized: Boolean(fenced), error: null }; }
  catch { return { value: null, normalized: Boolean(fenced), error: `${label} is not valid JSON` }; }
}

const PACKET_LABELS = { IDENTITY: "identityPacket", FINANCIAL: "financialPacket", QUALITATIVE: "qualitativePacket" };

// H-2: extract a JSON packet from a prompt string.
// 1) Accept ```json / ``` fences (common cloud output format)
// 2) Use JSON.parse to probe for the shortest valid boundary, avoiding false cuts on JSON
//    that happens to contain `\nLABEL:` inside a string value
// 3) Any failure returns null; caller is responsible for fallback
function extractPacketFromPrompt(prompt, label) {
  const idx = prompt.indexOf(label + ":");
  if (idx === -1) return null;
  const afterLabel = prompt.slice(idx + label.length + 1);
  let endIdx = afterLabel.length;
  for (const otherLabel of Object.keys(PACKET_LABELS)) {
    if (otherLabel === label) continue;
    const otherIdx = afterLabel.indexOf("\n" + otherLabel + ":");
    if (otherIdx > 0 && otherIdx < endIdx) endIdx = otherIdx;
  }
  let jsonStr = afterLabel.slice(0, endIdx).trim();
  // Strip ```json ... ``` fences (cloud sometimes wraps JSON in markdown)
  const fenceMatch = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  // Probe with JSON.parse from the longest possible prefix down to the shortest valid object.
  let lastValid = -1;
  for (let i = jsonStr.length; i > 0; i -= 1) {
    const candidate = jsonStr.slice(0, i).trim();
    if (!candidate.endsWith("}") && !candidate.endsWith("]")) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (isObject(parsed)) {
        lastValid = candidate.length;
        break;
      }
    } catch { /* keep shortening */ }
  }
  if (lastValid > 0) jsonStr = jsonStr.slice(0, lastValid);
  try { return JSON.parse(jsonStr); } catch { return null; }
}

function stepsToInput(outer) {
  const steps = outer.steps;
  if (!isObject(steps)) return null;
  const result = {};
  for (const step of Object.values(steps)) {
    if (!isObject(step)) continue;
    // Preferred 1: structured step.input from cloud beats embedded prompt strings.
    if (isObject(step.input)) {
      for (const packetKey of Object.values(PACKET_LABELS)) {
        if (!result[packetKey] && step.input[packetKey]) result[packetKey] = step.input[packetKey];
      }
    }
    // Preferred 2: fall back to extracting from the prompt string.
    if (typeof step.prompt === "string") {
      for (const [label, key] of Object.entries(PACKET_LABELS)) {
        if (result[key]) continue;
        const packet = extractPacketFromPrompt(step.prompt, label);
        if (packet) result[key] = packet;
      }
    }
    if (result.identityPacket && result.financialPacket && result.qualitativePacket) break;
  }
  return Object.keys(result).length >= 3 ? result : null;
}

function parseInput(row) {
  let outer = {};
  try {
    outer = typeof row.inputJson === "string" ? JSON.parse(row.inputJson) : (row.inputJson ?? row.input ?? {});
  } catch { return {}; }
  if (!isObject(outer)) return {};

  // Preferred 0 (cogfoundry): outer.tickerPacket is a single string with the three packets
  // concatenated in identityPacket → financialPacket → qualitativePacket order, separated
  // by newlines. This is the shape produced by the LoomLoom US Equity Screening template
  // (templates/buffett-four-filters.cogfoundry/template.json) when users provide one row
  // of tickerPacket input.
  if (typeof outer.tickerPacket === "string" && outer.tickerPacket.trim()) {
    const segments = outer.tickerPacket.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (segments.length >= 3) {
      const reassembled = {};
      for (const segment of segments) {
        try {
          const obj = JSON.parse(segment);
          if (!isObject(obj)) continue;
          if (isObject(obj.identityPacket)) Object.assign(reassembled, { identityPacket: obj.identityPacket });
          if (isObject(obj.financialPacket)) Object.assign(reassembled, { financialPacket: obj.financialPacket });
          if (isObject(obj.qualitativePacket)) Object.assign(reassembled, { qualitativePacket: obj.qualitativePacket });
          // Or the segment may already be one of the three packets directly.
          for (const key of Object.values(PACKET_LABELS)) {
            if (isObject(obj[key]) && !reassembled[key]) reassembled[key] = obj[key];
            if (PACKET_LABELS.IDENTITY === key && obj.ticker && !reassembled[key]) reassembled[key] = obj;
            if (PACKET_LABELS.FINANCIAL === key && obj.marketSnapshot && !reassembled[key]) reassembled[key] = obj;
            if (PACKET_LABELS.QUALITATIVE === key && (Array.isArray(obj.businessModel) || Array.isArray(obj.moatEvidence)) && !reassembled[key]) reassembled[key] = obj;
          }
        } catch { /* skip malformed segment */ }
      }
      if (reassembled.identityPacket || reassembled.financialPacket || reassembled.qualitativePacket) {
        return reassembled;
      }
    }
  }

  // Preferred 1: outer directly contains the three packet objects (not strings).
  // String packets are left for the JSON.parse fallback path.
  const directPackets = {};
  for (const packetKey of Object.values(PACKET_LABELS)) {
    if (isObject(outer[packetKey])) directPackets[packetKey] = outer[packetKey];
  }
  if (Object.keys(directPackets).length >= 3) return directPackets;

  // Preferred 2: outer.inputRows[0] is a standard Market row.
  if (Array.isArray(outer.inputRows) && outer.inputRows.length && isObject(outer.inputRows[0])) {
    return outer.inputRows[0];
  }

  // Preferred 3: outer.steps[].input structured input or step.prompt string extraction.
  const stepsResult = stepsToInput(outer);
  if (stepsResult) return stepsResult;

  // Fallback: try to JSON.parse each string value.
  const input = {};
  for (const [key, value] of Object.entries(outer)) {
    if (typeof value !== "string") input[key] = value;
    else {
      try { input[key] = JSON.parse(value); }
      catch { input[key] = value; }
    }
  }
  return input;
}

function classify(value) {
  if (!isObject(value)) return null;
  // M-6: cloud can declare dimension explicitly; that wins over field-name heuristics.
  if (typeof value.dimension === "string" && DIMENSIONS.includes(value.dimension)) return value.dimension;
  if ("business_model_score" in value && "understandability_score" in value) return "business";
  if ("moat_score" in value && "capital_allocation_score" in value) return "moat";
  if ("financial_quality_score" in value && "balance_sheet_score" in value) return "financial";
  if ("valuation_score" in value && "margin_of_safety_score" in value) return "valuation";
  return null;
}

function artifactText(item) {
  if (typeof item?.inlineText === "string") return item.inlineText;
  if (typeof item?.text === "string") return item.text;
  if (typeof item?.content === "string") return item.content;
  return "";
}

function reviewsOf(row, errors) {
  const reviews = {};
  let normalized = false;
  for (const [index, item] of (row.artifacts ?? []).entries()) {
    const parsed = parseJson(artifactText(item), `cloud output #${index + 1}`);
    normalized ||= parsed.normalized;
    if (parsed.error) continue;
    const dimension = classify(parsed.value);
    if (!dimension) continue;
    if (reviews[dimension]) errors.push(`duplicate ${dimension} dimension output detected`);
    else reviews[dimension] = parsed.value;
  }
  for (const dimension of DIMENSIONS) if (!reviews[dimension]) errors.push(`missing identifiable ${dimension} dimension output`);
  return { reviews, normalized };
}

function pathParts(path) { return String(path).replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean); }

function getPath(root, path) {
  // M-7: use hasOwnProperty.call instead of `in` so prototype-chain keys
  // (e.g. `identityPacket.toString`) no longer match by accident. They used to be
  // caught by same() but produced a misleading "value mismatch" error.
  let value = root;
  for (const part of pathParts(path)) {
    if (value === null || value === undefined) return undefined;
    if (!Object.prototype.hasOwnProperty.call(Object(value), part)) return undefined;
    value = value[part];
  }
  return value;
}

function sourceRef(value) {
  return /^(identityPacket|financialPacket|qualitativePacket)(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d+\])+$/.test(String(value ?? ""));
}

// A looser check used only by valuation.reference docs: validity_basis and
// falsification_conditions. The LLM sometimes emits a bare path (e.g.
// "marketSnapshot.price") without the "financialPacket." prefix. We accept
// the bare form here and let resolveRef re-add the prefix at lookup time.
function sourceRefLoose(value) {
  const s = String(value ?? "");
  if (!s) return false;
  if (sourceRef(s)) return true;
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d+\])*$/.test(s);
}

// Resolve a source_ref (full or bare) to the input value. For bare paths we
// try the three packet prefixes in order; first hit wins.
function resolveRef(input, ref) {
  if (ref === undefined || ref === null) return undefined;
  if (sourceRef(ref)) return getPath(input, ref);
  if (!sourceRefLoose(ref)) return undefined;
  for (const prefix of Object.values(PACKET_LABELS)) {
    const v = getPath(input, `${prefix}.${ref}`);
    if (v !== undefined) return v;
  }
  return undefined;
}

function atomic(value) { return value === null || ["string", "number", "boolean"].includes(typeof value); }
function same(left, right) {
  if (JSON.stringify(left) === JSON.stringify(right)) return true;
  const leftStr = String(left ?? "");
  const rightStr = String(right ?? "");
  if (!leftStr || !rightStr) return false;
  if (typeof left === "string" && typeof right === "string") {
    if (rightStr.includes(leftStr)) return true;
    const resultMatch = leftStr.match(/=\s*([^=]+?)\s*$/);
    if (resultMatch) {
      const result = resultMatch[1].trim();
      if (result && (rightStr.trim() === result || rightStr.includes(result))) return true;
    }
    return false;
  }
  if (typeof left === "number" && typeof right === "string") {
    const escaped = leftStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`).test(rightStr);
  }
  if (typeof right === "number" && typeof left === "string") {
    const escaped = rightStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`).test(leftStr);
  }
  return false;
}
function text(value) { return String(value ?? "").trim(); }

function score(value, label, errors) {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    errors.push(`${label} must be an integer between 0 and 100`);
    return 0;
  }
  return value;
}

function requireArray(review, keys, dimension, errors) {
  for (const key of keys) if (!Array.isArray(review[key])) errors.push(`${dimension}.${key} must be an array`);
  if (!text(review.summary)) errors.push(`${dimension}.summary must not be empty`);
}

function shape(reviews, errors) {
  requireArray(reviews.business, ["evidence_records", "positive_points", "contrary_points", "unknowns"], "business", errors);
  requireArray(reviews.moat, ["evidence_records", "positive_points", "contrary_points", "governance_red_flags", "unknowns"], "moat", errors);
  requireArray(reviews.financial, ["evidence_records", "positive_points", "contrary_points", "accounting_red_flags", "survival_risks", "unknowns"], "financial", errors);
  requireArray(reviews.valuation, ["evidence_records", "validity_basis", "falsification_conditions", "positive_points", "contrary_points", "valuation_red_flags", "forbidden_numeric_claims", "unknowns"], "valuation", errors);
}

function auditEvidence(reviews, input) {
  const verified = [];
  const rejected = [];
  const byDimension = Object.fromEntries(DIMENSIONS.map((key) => [key, 0]));
  const seen = new Set();
  for (const [dimension, review] of Object.entries(reviews)) {
    for (const item of review.evidence_records ?? []) {
      const ref = text(item?.source_ref);
      let reason = "";
      if (!text(item?.claim) || !ref || item?.source_value === undefined || !text(item?.period) || !text(item?.unit)) reason = "evidence fields incomplete";
      else if (!sourceRef(ref)) reason = "source_ref must use a full public input path";
      else if (!atomic(item.source_value)) reason = "source_value must be an atomic value";
      else if (getPath(input, ref) === undefined) reason = "source_ref cannot be resolved against the input";
      else if (!same(getPath(input, ref), item.source_value)) reason = "source_value does not match the input's original value";
      if (reason) rejected.push({ dimension, claim: item?.claim ?? "", source_ref: ref, reason });
      else {
        const id = `${dimension}:${ref}:${JSON.stringify(item.source_value)}`;
        if (!seen.has(id)) {
          seen.add(id);
          verified.push({ evidence_id: `E${String(verified.length + 1).padStart(2, "0")}`, dimension, claim: item.claim, source_ref: ref, source_value: item.source_value, period: item.period, unit: item.unit });
          byDimension[dimension] += 1;
        }
      }
    }
  }
  return { verified, rejected, byDimension };
}

function traceRecords(records, label, input, errors, { min, max, condition = false } = {}) {
  if (!Array.isArray(records)) return errors.push(`${label} must be an array`);
  if (records.length < min || records.length > max) errors.push(`${label} must contain ${min}-${max} entries`);
  // Valuation reference docs (validity_basis, falsification_conditions) accept
  // bare paths; the strict prefix check stays for evidence_records.
  const loose = label === "validity_basis" || label === "falsification_conditions";
  for (const item of records) {
    if (!text(item?.[condition ? "condition" : "claim"])) errors.push(`${label} entry missing ${condition ? "condition" : "claim"}`);
    const refOk = loose ? sourceRefLoose(item?.source_ref) : sourceRef(item?.source_ref);
    if (!refOk) errors.push(`${label}.source_ref must use a full input path`);
    else {
      const resolved = resolveRef(input, item.source_ref);
      if (resolved === undefined) errors.push(`${label}.source_ref cannot be resolved against the input`);
      else {
        // source_value must verbatim match the input at source_ref. Atomic types
        // (string/number/boolean/null) use atomic + same(); arrays/objects use deep
        // JSON equality so the LLM can cite an unknown field's current value (e.g.
        // `financialPacket.unknowns`) as a falsification anchor.
        if (atomic(item.source_value)) {
          if (!same(resolved, item.source_value)) errors.push(`${label}.source_value does not verbatim copy an atomic input value`);
        } else if (isObject(item.source_value) || Array.isArray(item.source_value)) {
          if (JSON.stringify(resolved) !== JSON.stringify(item.source_value)) errors.push(`${label}.source_value does not verbatim copy the input value at source_ref`);
        } else {
          errors.push(`${label}.source_value must be an atomic value, array, or object`);
        }
      }
    }
    if (!text(item?.period) || !text(item?.unit)) errors.push(`${label} entry missing period or unit`);
    if (condition && !["rerun_required", "conclusion_invalidated"].includes(item?.action)) errors.push(`${label}.action is invalid`);
  }
}

function numericTokens(value) { return String(value ?? "").match(/(?<![A-Za-z])[-+]?\d+(?:\.\d+)?%?/g) ?? []; }

function forbiddenForecast(value) {
  const body = String(value ?? "");
  return /(target price|future share price|forecast growth|forecast margin|discount rate|terminal multiple|probability)/i.test(body) && numericTokens(body).length > 0;
}

function unknownKey(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
}

function mergeRow(row, index) {
  const errors = [];
  let input = {};
  try { input = parseInput(row); } catch { errors.push("inputJson could not be parsed"); }
  if (row.status && row.status !== "completed") errors.push(`cloud row status is ${row.status}`);
  const { reviews, normalized } = reviewsOf(row, errors);
  const ticker = text(input.identityPacket?.ticker).toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) errors.push("input ticker is invalid");
  if (errors.length) return rejected(row, index, ticker, errors, normalized);

  // M-4: per-dimension evidence_records and source_value length caps to prevent oversized outputs.
  for (const [dimension, review] of Object.entries(reviews)) {
    const records = review.evidence_records ?? [];
    if (records.length > MAX_EVIDENCE_RECORDS) {
      errors.push(`${dimension}.evidence_records count ${records.length} exceeds the ${MAX_EVIDENCE_RECORDS} cap`);
    }
    for (const [i, item] of records.entries()) {
      if (typeof item?.source_value === "string" && item.source_value.length > MAX_SOURCE_VALUE_CHARS) {
        errors.push(`${dimension}.evidence_records[${i}].source_value length ${item.source_value.length} exceeds the ${MAX_SOURCE_VALUE_CHARS} cap`);
      }
    }
    if ((review.unknowns ?? []).length > MAX_UNKNOWN_ITEMS) {
      errors.push(`${dimension}.unknowns count exceeds the ${MAX_UNKNOWN_ITEMS} cap`);
    }
  }

  shape(reviews, errors);
  const biz = reviews.business;
  const moat = reviews.moat;
  const fin = reviews.financial;
  const val = reviews.valuation;
  if (!new Set(["pass", "uncertain", "fail"]).has(biz.circle_of_competence)) errors.push("circle_of_competence is invalid");
  if (!new Set(["insufficient_margin_of_safety", "evidence_insufficient", "evidence_thin", "eligible_for_manual_deep_research"]).has(val.judgment_state)) errors.push("judgment_state is invalid");
  traceRecords(val.validity_basis, "validity_basis", input, errors, { min: 2, max: 3 });
  traceRecords(val.falsification_conditions, "falsification_conditions", input, errors, { min: 2, max: 4, condition: true });
  // Map bare source_refs (e.g. "marketSnapshot.price") to their full prefix by
  // looking up the actual input value. Then the hard checks below can match the
  // canonical full-path form. The original LLM output is preserved as-is in the
  // row, only the check uses the resolved form.
  const basisRefs = new Set(
    (val.validity_basis ?? []).map((item) => {
      const ref = item?.source_ref;
      if (typeof ref !== "string") return ref;
      if (sourceRef(ref)) return ref;
      // Try each packet prefix until one resolves to a non-undefined value.
      for (const prefix of Object.values(PACKET_LABELS)) {
        const candidate = `${prefix}.${ref}`;
        if (getPath(input, candidate) !== undefined) return candidate;
      }
      return ref;
    })
  );
  if (![...basisRefs].some((ref) => /^financialPacket\.marketSnapshot\.(price|asOf)$/.test(ref))) errors.push("validity_basis must reference price or price timestamp");
  if (![...basisRefs].some((ref) => /^(identityPacket\.(fiscalPeriod|dataAsOf)|financialPacket\.latestOperatingUpdate\.periodEnd|financialPacket\.annualHistory\.fiscalYearEnd\[\d+\])$/.test(ref))) errors.push("validity_basis must reference fiscal period or data-as-of date");

  const components = {
    understandability: score(biz.understandability_score, "understandability_score", errors),
    business_model: score(biz.business_model_score, "business_model_score", errors),
    moat: score(moat.moat_score, "moat_score", errors),
    management_capital_allocation: Math.round((score(moat.management_culture_score, "management_culture_score", errors) + score(moat.capital_allocation_score, "capital_allocation_score", errors)) / 2),
    financial_quality: score(fin.financial_quality_score, "financial_quality_score", errors),
    valuation_opportunity_cost: Math.round((score(val.valuation_score, "valuation_score", errors) + score(val.margin_of_safety_score, "margin_of_safety_score", errors)) / 2),
  };
  if (errors.length) return rejected(row, index, ticker, errors, normalized);

  const evidence = auditEvidence(reviews, input);
  const veto = [];
  if (biz.circle_of_competence === "fail") veto.push("circle_of_competence_fail");
  for (const dimension of DIMENSIONS) if (evidence.byDimension[dimension] === 0) veto.push(`missing_verified_evidence_${dimension}`);
  // Survival-risk veto: a missing or non-finite balance_sheet_score is treated as a weak balance sheet.
  // H-1: the previous `undefined < 30` was always false, so a missing field silently bypassed this veto.
  const balanceSheetScore = Number(fin.balance_sheet_score);
  if ((fin.survival_risks?.length ?? 0) && (!Number.isFinite(balanceSheetScore) || balanceSheetScore < WEAK_SCORE_THRESHOLD))
    veto.push("survival_risk_with_weak_balance_sheet");
  if ((moat.governance_red_flags?.length ?? 0) && components.management_capital_allocation < WEAK_SCORE_THRESHOLD) veto.push("governance_red_flags_with_weak_management_score");
  if ((fin.accounting_red_flags?.length ?? 0) && fin.financial_quality_score < WEAK_SCORE_THRESHOLD) veto.push("accounting_red_flags_with_weak_financial_score");
  if (val.margin_of_safety_score < WEAK_SCORE_THRESHOLD) veto.push("insufficient_margin_of_safety");
  // 3-tier calibration: only 'evidence_insufficient' triggers the explicit veto.
  // 'evidence_thin' is the mid tier — surfaced as a watchlist decision, not a veto.
  // 'insufficient_margin_of_safety' is the LLM's explicit verdict that price > intrinsic; the hard < 30 score veto already covers the numeric case.
  if (val.judgment_state === "evidence_insufficient") veto.push("evidence_insufficient_for_valuation_anchor");
  if (val.judgment_state === "insufficient_margin_of_safety") veto.push("insufficient_margin_of_safety_verdict");
  const valuationText = [val.summary, ...(val.positive_points ?? []), ...(val.contrary_points ?? []), ...(val.valuation_red_flags ?? [])].join("\n");
  if (forbiddenForecast(valuationText)) veto.push("forbidden_numeric_claims");
  if (evidence.rejected.length > evidence.verified.length || evidence.rejected.length >= EXCESSIVE_REJECTED_EVIDENCE_MIN) veto.push("excessive_rejected_evidence");

  const overall = Math.round(Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + components[key] * weight, 0));
  const unknowns = [...new Set(DIMENSIONS.flatMap((dimension) => (reviews[dimension].unknowns ?? []).map(unknownKey).filter(Boolean)))];
  const uniqueVeto = [...new Set(veto)];
  // M-1: auditStatus reflects veto count — `vetoed` / `fail` keep it consistent with confidence and decision.
  const auditStatus = uniqueVeto.includes("excessive_rejected_evidence")
    ? "fail"
    : uniqueVeto.length
      ? "vetoed"
      : (evidence.rejected.length || unknowns.length > UNKNOWN_WARN_THRESHOLD)
        ? "warn"
        : "pass";
  // M-17: confidence expression with explicit parentheses and multi-line layout to avoid `?:` nesting misreads.
  const confidence = uniqueVeto.length
    ? "low"
    : (evidence.verified.length >= HIGH_CONFIDENCE_MIN_EVIDENCE
        && unknowns.length <= HIGH_CONFIDENCE_MAX_UNKNOWNS)
      ? "high"
      : "medium";
  const decision = uniqueVeto.length
    ? "pass"
    : val.judgment_state === "evidence_thin"
      ? "watchlist"
      : biz.circle_of_competence === "uncertain"
        ? "watchlist"
        : overall >= DEEP_RESEARCH_THRESHOLD
          ? "deep_research"
          : overall >= WATCHLIST_THRESHOLD
            ? "watchlist"
            : "pass";
  const eligible = decision === "deep_research" && auditStatus === "pass" && confidence !== "low" && !uniqueVeto.length;
  const market = input.financialPacket?.marketSnapshot ?? {};
  return {
    rowIndex: row.rowIndex ?? index, ticker, company_name: input.identityPacket?.companyName ?? "", valid: true,
    validationStatus: normalized ? "normalized" : "valid", normalized, decision, decision_eligible: eligible,
    overall_score: overall, component_scores: components, confidence, audit_status: auditStatus,
    hallucination_risk: auditStatus === "fail" ? "high" : auditStatus === "warn" ? "medium" : "low",
    price: market.price ?? null, price_currency: market.currency ?? "", price_as_of: market.asOf ?? "",
    fiscal_period: input.identityPacket?.fiscalPeriod ?? "", data_as_of: input.identityPacket?.dataAsOf ?? "",
    valuation_judgment_state: val.judgment_state, validity_basis: val.validity_basis,
    falsification_conditions: val.falsification_conditions, veto_items: uniqueVeto,
    verified_evidence: evidence.verified, rejected_evidence: evidence.rejected,
    unknowns, review_summaries: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, reviews[dimension].summary ?? ""])),
  };
}

function rejected(row, index, ticker, errors, normalized) {
  return { rowIndex: row.rowIndex ?? index, ticker, valid: false, validationStatus: "rejected", normalized, errors };
}

function ranking(rows) {
  return rows.filter((row) => row.decision_eligible).sort((a, b) =>
    (CONFIDENCE[b.confidence] - CONFIDENCE[a.confidence]) || (b.overall_score - a.overall_score) ||
    (b.component_scores.business_model - a.component_scores.business_model) || (b.component_scores.moat - a.component_scores.moat) ||
    (b.component_scores.financial_quality - a.component_scores.financial_quality) || (b.component_scores.valuation_opportunity_cost - a.component_scores.valuation_opportunity_cost) || a.ticker.localeCompare(b.ticker)
  ).map((row, index) => ({ rank: index + 1, ticker: row.ticker, overall_score: row.overall_score, confidence: row.confidence, decision: row.decision }));
}

export function mergeResults(payload) {
  if (!Array.isArray(payload?.rows)) throw new Error("input must be a complete LoomLoom result-rows response");
  const rows = payload.rows.map(mergeRow);
  const rejectedRows = rows.filter(({ valid }) => !valid).length;
  return { schemaVersion: "loomloom-us-value-local-audit/v1", valid: rejectedRows === 0, summary: { totalRows: rows.length, acceptedRows: rows.length - rejectedRows, rejectedRows, decisionEligibleRows: rows.filter(({ decision_eligible }) => decision_eligible).length }, ranking: ranking(rows), rows };
}

async function readText(path) {
  if (path !== "-") return readFile(path, "utf8");
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (args.help) return process.stdout.write("node scripts/merge-public-results.mjs --input <result-rows.json|-> [--output audit.json] [--pretty]\n");
  if (!args.input) throw new Error("--input is required");
  const report = mergeResults(JSON.parse(await readText(args.input)));
  const output = `${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`;
  if (args.output) await writeFile(args.output, output, "utf8"); else process.stdout.write(output);
  process.exitCode = report.valid ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { process.stderr.write(`local audit error: ${error.message}\n`); process.exitCode = 2; });
