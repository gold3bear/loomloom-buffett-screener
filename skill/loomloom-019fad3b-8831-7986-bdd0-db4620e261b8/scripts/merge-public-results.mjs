#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const DIMENSIONS = ["business", "moat", "financial", "valuation"];
const WEIGHTS = { understandability: 0.10, business_model: 0.20, moat: 0.20, management_capital_allocation: 0.15, financial_quality: 0.20, valuation_opportunity_cost: 0.15 };
const CONFIDENCE = { high: 3, medium: 2, low: 1 };
// 修复 M-4:每维度 evidence_records 数量上限 + 单条 source_value 字符串长度上限,防止异常输出撑爆报告
const MAX_EVIDENCE_RECORDS = 50;
const MAX_SOURCE_VALUE_CHARS = 2000;
const MAX_UNKNOWN_ITEMS = 200;
// 修复 M-5:评分与置信度阈值集中,方便后续与 decision-policy.md 同步
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
    else throw new Error(`未知参数：${argv[i]}`);
  }
  return args;
}

function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

function parseJson(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) return { value: null, normalized: false, error: `${label} 为空` };
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```/i);
  try { return { value: JSON.parse(fenced ? fenced[1] : raw), normalized: Boolean(fenced), error: null }; }
  catch { return { value: null, normalized: Boolean(fenced), error: `${label} 不是有效 JSON` }; }
}

const PACKET_LABELS = { IDENTITY: "identityPacket", FINANCIAL: "financialPacket", QUALITATIVE: "qualitativePacket" };

// 修复 H-2:从 prompt 字符串里抽 JSON。
// 1) 支持 ```json / ``` 围栏（云端常见格式）
// 2) 找到下一个 \nLABEL: 前先用 JSON.parse 试探,避免误切 JSON 内含 \nLABEL: 的字符串
// 3) 任何异常返回 null,调用方负责 fallback
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
  // 移除 ```json ... ``` 围栏（云端有时用 markdown 包裹 JSON）
  const fenceMatch = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  // 用 JSON.parse 试探:取可能的最长前缀直到能 parse 成功,避免误切
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
    } catch { /* 继续缩短 */ }
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
    // 优先 1：云端若把 packet 作为结构化 input 字段传入(优于嵌入 prompt 字符串)
    if (isObject(step.input)) {
      for (const packetKey of Object.values(PACKET_LABELS)) {
        if (!result[packetKey] && step.input[packetKey]) result[packetKey] = step.input[packetKey];
      }
    }
    // 优先 2：退化用 prompt 字符串抽取
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

  // 优先 1：outer 自身就含三个 packet 对象(非字符串)。字符串 packet 留给退化路径 JSON.parse。
  const directPackets = {};
  for (const packetKey of Object.values(PACKET_LABELS)) {
    if (isObject(outer[packetKey])) directPackets[packetKey] = outer[packetKey];
  }
  if (Object.keys(directPackets).length >= 3) return directPackets;

  // 优先 2：outer.inputRows[0] 是标准 Market 行结构
  if (Array.isArray(outer.inputRows) && outer.inputRows.length && isObject(outer.inputRows[0])) {
    return outer.inputRows[0];
  }

  // 优先 3：outer.steps[].input 结构化输入 或 step.prompt 字符串抽取
  const stepsResult = stepsToInput(outer);
  if (stepsResult) return stepsResult;

  // 退化：把每个 value 当 JSON 字符串解析
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
  // 修复 M-6:云端可显式声明 dimension,优先于字段名启发式匹配(避免 LLM 串行输出导致错分类)
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
    const parsed = parseJson(artifactText(item), `第 ${index + 1} 个云端输出`);
    normalized ||= parsed.normalized;
    if (parsed.error) continue;
    const dimension = classify(parsed.value);
    if (!dimension) continue;
    if (reviews[dimension]) errors.push(`检测到重复的 ${dimension} 维度输出`);
    else reviews[dimension] = parsed.value;
  }
  for (const dimension of DIMENSIONS) if (!reviews[dimension]) errors.push(`缺少可识别的 ${dimension} 维度输出`);
  return { reviews, normalized };
}

function pathParts(path) { return String(path).replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean); }

function getPath(root, path) {
  // 修复 M-7:用 hasOwnProperty.call 而非 `in`,避免 `identityPacket.toString` 之类的原型链属性被误解析。
  // 之前会被 same() 兜住,但 auditEvidence 会输出"source_value 与输入原值不一致"误导为业务问题。
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
    errors.push(`${label} 必须是 0-100 整数`);
    return 0;
  }
  return value;
}

function requireArray(review, keys, dimension, errors) {
  for (const key of keys) if (!Array.isArray(review[key])) errors.push(`${dimension}.${key} 必须是数组`);
  if (!text(review.summary)) errors.push(`${dimension}.summary 不能为空`);
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
      if (!text(item?.claim) || !ref || item?.source_value === undefined || !text(item?.period) || !text(item?.unit)) reason = "证据字段不完整";
      else if (!sourceRef(ref)) reason = "source_ref 必须使用完整公开输入路径";
      else if (!atomic(item.source_value)) reason = "source_value 必须是原子值";
      else if (getPath(input, ref) === undefined) reason = "source_ref 无法解析到输入";
      else if (!same(getPath(input, ref), item.source_value)) reason = "source_value 与输入原值不一致";
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
  if (!Array.isArray(records)) return errors.push(`${label} 必须是数组`);
  if (records.length < min || records.length > max) errors.push(`${label} 必须包含 ${min}-${max} 项`);
  for (const item of records) {
    if (!text(item?.[condition ? "condition" : "claim"])) errors.push(`${label} 条目缺少 ${condition ? "condition" : "claim"}`);
    if (!sourceRef(item?.source_ref)) errors.push(`${label}.source_ref 必须使用完整输入路径`);
    else if (getPath(input, item.source_ref) === undefined) errors.push(`${label}.source_ref 无法解析到输入`);
    else if (!atomic(item.source_value) || !same(getPath(input, item.source_ref), item.source_value)) errors.push(`${label}.source_value 未原样复制输入原子值`);
    if (!text(item?.period) || !text(item?.unit)) errors.push(`${label} 条目缺少 period 或 unit`);
    if (condition && !["rerun_required", "conclusion_invalidated"].includes(item?.action)) errors.push(`${label}.action 无效`);
  }
}

function numericTokens(value) { return String(value ?? "").match(/(?<![A-Za-z])[-+]?\d+(?:\.\d+)?%?/g) ?? []; }

function forbiddenForecast(value) {
  const body = String(value ?? "");
  return /(目标价|未来股价|预测增长率|预测利润率|贴现率|终值倍数|概率|target price|future share price|forecast growth|forecast margin|discount rate|terminal multiple)/i.test(body) && numericTokens(body).length > 0;
}

function unknownKey(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
}

function mergeRow(row, index) {
  const errors = [];
  let input = {};
  try { input = parseInput(row); } catch { errors.push("inputJson 无法解析"); }
  if (row.status && row.status !== "completed") errors.push(`云端行状态为 ${row.status}`);
  const { reviews, normalized } = reviewsOf(row, errors);
  const ticker = text(input.identityPacket?.ticker).toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) errors.push("输入 ticker 无效");
  if (errors.length) return rejected(row, index, ticker, errors, normalized);

  // 修复 M-4:每维度 evidence_records 数量与 source_value 字符串长度上限,防止异常/恶意输出撑爆报告
  for (const [dimension, review] of Object.entries(reviews)) {
    const records = review.evidence_records ?? [];
    if (records.length > MAX_EVIDENCE_RECORDS) {
      errors.push(`${dimension}.evidence_records 数量 ${records.length} 超过 ${MAX_EVIDENCE_RECORDS} 上限`);
    }
    for (const [i, item] of records.entries()) {
      if (typeof item?.source_value === "string" && item.source_value.length > MAX_SOURCE_VALUE_CHARS) {
        errors.push(`${dimension}.evidence_records[${i}].source_value 长度 ${item.source_value.length} 超过 ${MAX_SOURCE_VALUE_CHARS} 上限`);
      }
    }
    if ((review.unknowns ?? []).length > MAX_UNKNOWN_ITEMS) {
      errors.push(`${dimension}.unknowns 数量超过 ${MAX_UNKNOWN_ITEMS} 上限`);
    }
  }

  shape(reviews, errors);
  const biz = reviews.business;
  const moat = reviews.moat;
  const fin = reviews.financial;
  const val = reviews.valuation;
  if (!new Set(["pass", "uncertain", "fail"]).has(biz.circle_of_competence)) errors.push("circle_of_competence 无效");
  if (!new Set(["insufficient_margin_of_safety", "evidence_insufficient", "eligible_for_manual_deep_research"]).has(val.judgment_state)) errors.push("judgment_state 无效");
  traceRecords(val.validity_basis, "validity_basis", input, errors, { min: 2, max: 3 });
  traceRecords(val.falsification_conditions, "falsification_conditions", input, errors, { min: 2, max: 4, condition: true });
  const basisRefs = new Set((val.validity_basis ?? []).map((item) => item?.source_ref));
  if (![...basisRefs].some((ref) => /^financialPacket\.marketSnapshot\.(price|asOf)$/.test(ref))) errors.push("validity_basis 必须引用价格或价格时间");
  if (![...basisRefs].some((ref) => /^(identityPacket\.(fiscalPeriod|dataAsOf)|financialPacket\.latestOperatingUpdate\.periodEnd|financialPacket\.annualHistory\.fiscalYearEnd\[\d+\])$/.test(ref))) errors.push("validity_basis 必须引用财报期间或数据截止日");

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
  // 生存风险 veto：balance_sheet_score 缺失或非有限数时,视同弱资产负债表,触发否决。
  // 修复 H-1:之前用 `undefined < 30` 会得到 false,导致云端漏返该字段时 veto 静默失效。
  const balanceSheetScore = Number(fin.balance_sheet_score);
  if ((fin.survival_risks?.length ?? 0) && (!Number.isFinite(balanceSheetScore) || balanceSheetScore < WEAK_SCORE_THRESHOLD))
    veto.push("survival_risk_with_weak_balance_sheet");
  if ((moat.governance_red_flags?.length ?? 0) && components.management_capital_allocation < WEAK_SCORE_THRESHOLD) veto.push("governance_red_flags_with_weak_management_score");
  if ((fin.accounting_red_flags?.length ?? 0) && fin.financial_quality_score < WEAK_SCORE_THRESHOLD) veto.push("accounting_red_flags_with_weak_financial_score");
  if (val.margin_of_safety_score < WEAK_SCORE_THRESHOLD) veto.push("insufficient_margin_of_safety");
  if (val.judgment_state !== "eligible_for_manual_deep_research") veto.push("valuation_not_eligible_for_manual_deep_research");
  const valuationText = [val.summary, ...(val.positive_points ?? []), ...(val.contrary_points ?? []), ...(val.valuation_red_flags ?? [])].join("\n");
  if (forbiddenForecast(valuationText)) veto.push("forbidden_numeric_claims");
  if (evidence.rejected.length > evidence.verified.length || evidence.rejected.length >= EXCESSIVE_REJECTED_EVIDENCE_MIN) veto.push("excessive_rejected_evidence");

  const overall = Math.round(Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + components[key] * weight, 0));
  const unknowns = [...new Set(DIMENSIONS.flatMap((dimension) => (reviews[dimension].unknowns ?? []).map(unknownKey).filter(Boolean)))];
  const uniqueVeto = [...new Set(veto)];
  // 修复 M-1:auditStatus 反映 veto 数量——有 veto 时应为 "vetoed",与 confidence/decision 一致
  const auditStatus = uniqueVeto.includes("excessive_rejected_evidence")
    ? "fail"
    : uniqueVeto.length
      ? "vetoed"
      : (evidence.rejected.length || unknowns.length > UNKNOWN_WARN_THRESHOLD)
        ? "warn"
        : "pass";
  // 修复 M-17:confidence 表达式加显式括号与多行排版,避免 `?:` 嵌套误读
  const confidence = uniqueVeto.length
    ? "low"
    : (evidence.verified.length >= HIGH_CONFIDENCE_MIN_EVIDENCE
        && unknowns.length <= HIGH_CONFIDENCE_MAX_UNKNOWNS)
      ? "high"
      : "medium";
  const decision = uniqueVeto.length ? "pass" : biz.circle_of_competence === "uncertain" ? "watchlist" : overall >= DEEP_RESEARCH_THRESHOLD ? "deep_research" : overall >= WATCHLIST_THRESHOLD ? "watchlist" : "pass";
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
  if (!Array.isArray(payload?.rows)) throw new Error("输入必须是 LoomLoom result-rows 完整响应");
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
  if (!args.input) throw new Error("必须提供 --input");
  const report = mergeResults(JSON.parse(await readText(args.input)));
  const output = `${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`;
  if (args.output) await writeFile(args.output, output, "utf8"); else process.stdout.write(output);
  process.exitCode = report.valid ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { process.stderr.write(`本地审计错误：${error.message}\n`); process.exitCode = 2; });

