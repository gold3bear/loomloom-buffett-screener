#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

function argsOf(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (["--input", "-i"].includes(argv[i])) args.input = argv[++i];
    else if (["--output", "-o"].includes(argv[i])) args.output = argv[++i];
    else if (["--help", "-h"].includes(argv[i])) args.help = true;
    else throw new Error(`未知参数：${argv[i]}`);
  }
  return args;
}

// 修复 M-2:转义 Markdown 特殊字符,防 HTML 注入 / 视觉欺骗 / 链接污染。
// 反斜杠必须最先处理(它本身是转义前缀),其余顺序不敏感。
function clean(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[*_`]/g, "\\$&")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, " ")
    .trim();
}
function list(values, empty = "无") { return values?.length ? values.map((value) => `- ${clean(typeof value === "string" ? value : JSON.stringify(value))}`).join("\n") : `- ${empty}`; }

function decisionLabel(value) {
  return { deep_research: "进入人工深度研究", watchlist: "观察名单", pass: "暂不进入下一轮" }[value] ?? value ?? "未知";
}

function rowSection(row) {
  if (!row.valid) return `## ${row.ticker || `第 ${row.rowIndex + 1} 行`}：本地校验拒绝\n\n${list(row.errors, "未返回错误详情")}\n`;
  const summaries = row.review_summaries ?? {};
  const evidence = (row.verified_evidence ?? []).map((item) => `${item.evidence_id}｜${item.claim}（${item.source_ref} = ${JSON.stringify(item.source_value)}，${item.period}，${item.unit}）`);
  const rejected = (row.rejected_evidence ?? []).map((item) => `${item.claim || "未命名声明"}：${item.reason}`);
  const falsifiers = (row.falsification_conditions ?? []).map((item) => `${item.condition}；动作：${item.action}；依据：${item.source_ref} = ${JSON.stringify(item.source_value)}`);
  return `## ${row.ticker}｜${clean(row.company_name)}\n\n` +
    `- 研究分层：${decisionLabel(row.decision)}\n` +
    `- 综合分：${row.overall_score}/100；置信度：${row.confidence}\n` +
    `- 当前价格：${row.price ?? "未知"} ${clean(row.price_currency)}（${clean(row.price_as_of) || "时间未知"}）\n` +
    `- 财报期间：${clean(row.fiscal_period) || "未知"}；数据截止：${clean(row.data_as_of) || "未知"}\n` +
    `- 本地审计：${row.audit_status}；幻觉风险：${row.hallucination_risk}；格式：${row.validationStatus}\n\n` +
    `### 四维摘要\n\n` +
    `- 商业模式与能力圈：${clean(summaries.business)}\n` +
    `- 护城河与资本配置：${clean(summaries.moat)}\n` +
    `- 财务质量：${clean(summaries.financial)}\n` +
    `- 估值与安全边际：${clean(summaries.valuation)}\n\n` +
    `### 通过验证的证据\n\n${list(evidence)}\n\n` +
    `### 被拒绝的声明\n\n${list(rejected)}\n\n` +
    `### 否决项\n\n${list(row.veto_items)}\n\n` +
    `### 未知项\n\n${list(row.unknowns)}\n\n` +
    `### 可证伪与复跑条件\n\n${list(falsifiers)}\n`;
}

export function renderReport(report) {
  if (!report || !Array.isArray(report.rows)) throw new Error("输入必须是本地审计 JSON");
  const generatedAt = new Date().toISOString();
  const ranked = report.ranking?.length
    ? `| 排名 | 股票 | 综合分 | 置信度 |\n|---:|---|---:|---|\n${report.ranking.map((item) => `| ${item.rank} | ${item.ticker} | ${item.overall_score} | ${item.confidence} |`).join("\n")}`
    : "本批次没有股票通过全部证据与否决规则进入深度研究排名。";
  const overview = report.rows.map((row) => `| ${row.ticker || `行${row.rowIndex + 1}`} | ${row.valid ? decisionLabel(row.decision) : "本地拒绝"} | ${row.overall_score ?? "—"} | ${row.price ?? "—"} ${clean(row.price_currency)} | ${clean(row.price_as_of) || "—"} | ${row.audit_status ?? "—"} |`).join("\n");
  return `# LoomLoom 美股长期价值批量初筛报告\n\n` +
    `> 生成时间：${generatedAt}。本报告只用于研究辅助，不构成投资建议，不提供目标价、仓位或买卖指令。\n\n` +
    `## 批次结论\n\n` +
    `- 股票数：${report.summary?.totalRows ?? report.rows.length}\n` +
    `- 本地接受：${report.summary?.acceptedRows ?? 0}\n` +
    `- 本地拒绝：${report.summary?.rejectedRows ?? 0}\n` +
    `- 可进入深度研究排名：${report.summary?.decisionEligibleRows ?? 0}\n\n` +
    `| 股票 | 研究分层 | 综合分 | 当前价格 | 价格时间 | 本地审计 |\n|---|---|---:|---:|---|---|\n${overview}\n\n` +
    `## 深度研究优先级\n\n${ranked}\n\n` +
    `${report.rows.map(rowSection).join("\n")}\n` +
    `## 使用限制\n\n` +
    `云端模型负责并行审查，本地程序负责证据匹配、硬性否决和确定性排序。本地校验只能确认结论是否服从已提供的数据，不能替代对 SEC 文件、公司披露、市场价格和会计口径的人工核查。\n`;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (args.help) return process.stdout.write("node scripts/render-report.mjs --input <local-audit.json> --output <report.md>\n");
  if (!args.input || !args.output) throw new Error("必须提供 --input 和 --output");
  const report = JSON.parse(await readFile(args.input, "utf8"));
  await writeFile(args.output, renderReport(report), "utf8");
  process.stdout.write(`报告已生成：${args.output}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { process.stderr.write(`报告生成错误：${error.message}\n`); process.exitCode = 2; });

