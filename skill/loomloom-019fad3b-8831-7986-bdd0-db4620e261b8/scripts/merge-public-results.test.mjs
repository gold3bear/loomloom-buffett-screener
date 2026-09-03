import test from "node:test";
import assert from "node:assert/strict";
import { mergeResults } from "./merge-public-results.mjs";
import { renderReport } from "./render-report.mjs";

const input = {
  identityPacket: { ticker: "AAPL", companyName: "Apple Inc.", fiscalPeriod: "FY2025", dataAsOf: "2026-07-29" },
  financialPacket: { marketSnapshot: { price: 200, currency: "USD", asOf: "2026-07-29" }, metrics: { revenue: 100, fcf: 20, debt: 10, pe: 25 } },
  qualitativePacket: {},
};

function ev(claim, source_ref, source_value) { return [{ claim, source_ref, source_value, period: "FY2025", unit: "USD" }]; }

function reviews() {
  return [
    { business_model_score: 80, understandability_score: 80, circle_of_competence: "pass", evidence_records: ev("收入", "financialPacket.metrics.revenue", 100), positive_points: [], contrary_points: [], unknowns: [], summary: "商业模式清晰" },
    { moat_score: 80, management_culture_score: 80, capital_allocation_score: 80, evidence_records: ev("现金流", "financialPacket.metrics.fcf", 20), positive_points: [], contrary_points: [], governance_red_flags: [], unknowns: [], summary: "护城河稳定" },
    { financial_quality_score: 80, cash_flow_quality_score: 80, balance_sheet_score: 80, evidence_records: ev("债务", "financialPacket.metrics.debt", 10), positive_points: [], contrary_points: [], accounting_red_flags: [], survival_risks: [], unknowns: [], summary: "财务质量良好" },
    {
      valuation_score: 80, margin_of_safety_score: 80, judgment_state: "eligible_for_manual_deep_research",
      evidence_records: ev("市盈率", "financialPacket.metrics.pe", 25),
      validity_basis: [
        { claim: "价格", source_ref: "financialPacket.marketSnapshot.price", source_value: 200, period: "2026-07-29", unit: "USD" },
        { claim: "财报期间", source_ref: "identityPacket.fiscalPeriod", source_value: "FY2025", period: "FY2025", unit: "text" },
      ],
      falsification_conditions: [
        { condition: "价格变化", source_ref: "financialPacket.marketSnapshot.price", source_value: 200, period: "2026-07-29", unit: "USD", action: "rerun_required" },
        { condition: "财报更新", source_ref: "identityPacket.fiscalPeriod", source_value: "FY2025", period: "FY2025", unit: "text", action: "conclusion_invalidated" },
      ],
      positive_points: [], contrary_points: [], valuation_red_flags: [], forbidden_numeric_claims: [], unknowns: [], summary: "估值可继续研究",
    },
  ];
}

function payload({ fenced = false, mutate } = {}) {
  const outputs = reviews();
  mutate?.(outputs);
  return { rows: [{
    rowIndex: 0,
    status: "completed",
    inputJson: JSON.stringify(Object.fromEntries(Object.entries(input).map(([key, value]) => [key, JSON.stringify(value)]))),
    artifacts: outputs.map((value, index) => ({ opaqueId: `artifact-${index}`, inlineText: fenced ? `\`\`\`json\n${JSON.stringify(value)}\n\`\`\`` : JSON.stringify(value) })),
  }] };
}

test("identifies public output dimensions by shape without private step IDs", () => {
  const report = mergeResults(payload());
  assert.equal(report.valid, true);
  assert.equal(report.rows[0].overall_score, 80);
  assert.equal(report.rows[0].decision, "deep_research");
  assert.equal(report.rows[0].decision_eligible, true);
  assert.equal(report.rows[0].verified_evidence.length, 4);
  assert.equal(report.rows[0].price, 200);
});

test("normalizes fenced JSON", () => {
  const report = mergeResults(payload({ fenced: true }));
  assert.equal(report.rows[0].validationStatus, "normalized");
});

test("normalizes fenced JSON with trailing junk after closing fence", () => {
  const p = payload({ fenced: true });
  // Simulate cloud returning a stray backtick after the closing fence
  p.rows[0].artifacts = p.rows[0].artifacts.map((a, i) =>
    i === 1 ? { ...a, inlineText: a.inlineText + "\n`" } : a
  );
  const report = mergeResults(p);
  assert.equal(report.rows[0].validationStatus, "normalized");
  assert.equal(report.rows[0].valid, true);
});

test("rejects source values that do not match input and vetoes missing dimension evidence", () => {
  const report = mergeResults(payload({ mutate: (outputs) => { outputs[0].evidence_records[0].source_value = 999; } }));
  assert.equal(report.rows[0].decision, "pass");
  assert.ok(report.rows[0].veto_items.includes("missing_verified_evidence_business"));
});

test("rejects a missing research dimension", () => {
  const report = mergeResults(payload({ mutate: (outputs) => outputs.pop() }));
  assert.equal(report.valid, false);
  assert.equal(report.rows[0].validationStatus, "rejected");
});

test("detects unauthorized numeric target price", () => {
  const report = mergeResults(payload({ mutate: (outputs) => { outputs[3].summary = "目标价为 250 美元"; } }));
  assert.equal(report.rows[0].decision, "pass");
  assert.ok(report.rows[0].veto_items.includes("forbidden_numeric_claims"));
});

test("renders price, evidence and falsification conditions", () => {
  const markdown = renderReport(mergeResults(payload()));
  assert.match(markdown, /200 USD/);
  assert.match(markdown, /通过验证的证据/);
  assert.match(markdown, /价格变化/);
});

test("parses steps-format inputJson from cloud", () => {
  const stepsInputJson = JSON.stringify({
    steps: {
      stp_biz101: {
        prompt: `IDENTITY:\n${JSON.stringify(input.identityPacket)}\nFINANCIAL:\n${JSON.stringify(input.financialPacket)}\nQUALITATIVE:\n${JSON.stringify(input.qualitativePacket)}`,
      },
      stp_fin303: { prompt: "other step" },
    },
  });
  const p = payload();
  p.rows[0].inputJson = stepsInputJson;
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.equal(report.rows[0].ticker, "AAPL");
  assert.equal(report.rows[0].price, 200);
  assert.equal(report.rows[0].verified_evidence.length, 4);
});

test("accepts source_value containing derivation formula with original value", () => {
  const p = payload({ mutate: (outputs) => {
    // Cloud LLM writes a formula that includes the original value "80.0%"
    // Input value at qualitativePacket is {}, so test with a financial metric
    outputs[0].evidence_records[0].source_value = "100 / total = 100";
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.equal(report.rows[0].verified_evidence.length, 4);
});

test("accepts string source_value that contains input value as substring", () => {
  const p = payload({ mutate: (outputs) => {
    // Input value is 100 (number), cloud writes "revenue was 100 million"
    outputs[0].evidence_records[0].source_value = "revenue was 100 million";
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.ok(report.rows[0].verified_evidence.some((e) => e.claim === "收入"));
});

test("rejects source_value that does not contain input value at all", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[0].evidence_records[0].source_value = "completely different value 999";
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].decision, "pass");
  assert.ok(report.rows[0].veto_items.includes("missing_verified_evidence_business"));
});

test("accepts source_value that is the result of a formula in the input", () => {
  // Input value is "61166/76448 = 80.0%", cloud writes just "80.0%"
  const formulaInput = {
    identityPacket: { ticker: "TEST", companyName: "Test Corp", fiscalPeriod: "FY2025", dataAsOf: "2026-07-29" },
    financialPacket: { marketSnapshot: { price: 200, currency: "USD", asOf: "2026-07-29" }, metrics: { revenue: 100, fcf: 20, debt: 10, pe: 25, ratio: "61166/76448 = 80.0%" } },
    qualitativePacket: {},
  };
  const outputs = reviews();
  outputs[0].evidence_records = [{ claim: "负债率", source_ref: "financialPacket.metrics.ratio", source_value: "80.0%", period: "FY2025", unit: "text" }];
  const p = {
    rows: [{
      rowIndex: 0, status: "completed",
      inputJson: JSON.stringify(Object.fromEntries(Object.entries(formulaInput).map(([k, v]) => [k, JSON.stringify(v)]))),
      artifacts: outputs.map((v) => ({ opaqueId: "a", inlineText: JSON.stringify(v) })),
    }],
  };
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.ok(report.rows[0].verified_evidence.some((e) => e.claim === "负债率"));
});

// H-1 回归:balance_sheet_score 字段存在但值为 null 时,survival_risks 触发的 veto 不应被静默吞掉。
// 修复前 `null < 30` 为 true 不会有问题,但 `undefined` 或非数字字符串会让 `score < 30` 静默失效。
test("vetoes survival_risk_with_weak_balance_sheet when balance_sheet_score is null", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[2].survival_risks = ["经营现金流持续为负"];
    outputs[2].balance_sheet_score = null;
  }});
  const report = mergeResults(p);
  assert.ok(report.rows[0].veto_items.includes("survival_risk_with_weak_balance_sheet"),
    `expected veto, got ${JSON.stringify(report.rows[0].veto_items)}`);
  assert.equal(report.rows[0].decision, "pass");
  assert.equal(report.rows[0].decision_eligible, false);
});

// H-1 边界:survival_risks 为空时,即使 balance_sheet_score 是 null 也不触发 veto。
test("does not veto when survival_risks is empty even if balance_sheet_score is null", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[2].survival_risks = [];
    outputs[2].balance_sheet_score = null;
  }});
  const report = mergeResults(p);
  assert.ok(!report.rows[0].veto_items.includes("survival_risk_with_weak_balance_sheet"),
    `unexpected veto: ${JSON.stringify(report.rows[0].veto_items)}`);
});

// H-1 边界:balance_sheet_score 是显式弱分(20)时,正常触发 veto。
test("vetoes when balance_sheet_score is a low finite number", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[2].survival_risks = ["现金流承压"];
    outputs[2].balance_sheet_score = 20;
  }});
  const report = mergeResults(p);
  assert.ok(report.rows[0].veto_items.includes("survival_risk_with_weak_balance_sheet"));
});

// H-1 边界:balance_sheet_score 是非数字字符串("unknown")时,也被识别为弱,触发 veto。
test("vetoes when balance_sheet_score is a non-numeric string", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[2].survival_risks = ["现金流承压"];
    outputs[2].balance_sheet_score = "unknown";
  }});
  const report = mergeResults(p);
  assert.ok(report.rows[0].veto_items.includes("survival_risk_with_weak_balance_sheet"),
    `expected veto, got ${JSON.stringify(report.rows[0].veto_items)}`);
});

// H-2:云端把 packet 作为结构化 step.input 返回时,优先于 prompt 字符串抽取。
test("prefers structured step.input over prompt string extraction", () => {
  const structuredInput = {
    identityPacket: { ticker: "AAPL", companyName: "Apple Inc.", fiscalPeriod: "FY2025", dataAsOf: "2026-07-29" },
    financialPacket: { marketSnapshot: { price: 200, currency: "USD", asOf: "2026-07-29" }, metrics: { revenue: 100, fcf: 20, debt: 10, pe: 25 } },
    qualitativePacket: {},
  };
  // prompt 里塞一个"误导性"的 IDENTITY 标签,验证 step.input 胜出
  const decoyPrompt = "IDENTITY: {\"ticker\":\"FAKE\"}\nFINANCIAL: {}\nQUALITATIVE: {}";
  const p = payload();
  p.rows[0].inputJson = JSON.stringify({
    steps: {
      stp_biz101: { input: structuredInput, prompt: decoyPrompt },
    },
  });
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.equal(report.rows[0].ticker, "AAPL");
  assert.equal(report.rows[0].company_name, "Apple Inc.");
});

// H-2:云端用 ```json 围栏包裹 prompt 中的 packet 时,本地能正确解析。
test("extracts packets wrapped in ```json fences from prompt string", () => {
  const p = payload();
  p.rows[0].inputJson = JSON.stringify({
    steps: {
      stp_biz101: {
        prompt: [
          "IDENTITY:",
          "```json",
          JSON.stringify(input.identityPacket),
          "```",
          "FINANCIAL:",
          "```json",
          JSON.stringify(input.financialPacket),
          "```",
          "QUALITATIVE:",
          "```json",
          JSON.stringify(input.qualitativePacket),
          "```",
        ].join("\n"),
      },
    },
  });
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.equal(report.rows[0].ticker, "AAPL");
  assert.equal(report.rows[0].price, 200);
});

// H-2:outer 自身直接含三个 packet 对象(非字符串)时,parseInput 直接采用,不再走 steps 解析。
test("accepts outer object with packet objects directly", () => {
  const p = payload();
  // 这里的 packet 必须是对象(不是字符串),才能命中"优先 1"路径
  p.rows[0].inputJson = JSON.stringify({
    identityPacket: input.identityPacket,
    financialPacket: input.financialPacket,
    qualitativePacket: input.qualitativePacket,
  });
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.equal(report.rows[0].ticker, "AAPL");
});

// M-7:getPath 修复后,source_ref 指向原型链属性时应被识别为"无法解析",
// 而不是被 same() 兜底为"值不一致"。
test("rejects source_ref that targets a prototype-chain property", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[0].evidence_records[0].source_ref = "identityPacket.toString";
  }});
  const report = mergeResults(p);
  assert.ok(report.rows[0].rejected_evidence.some((e) => /无法解析/.test(e.reason)),
    `expected "无法解析" reason, got ${JSON.stringify(report.rows[0].rejected_evidence)}`);
});

// M-6:云端用 dimension 字段显式声明时,优先于字段名启发式匹配。
test("respects explicit dimension field over field-name heuristic", () => {
  const p = payload({ mutate: (outputs) => {
    // 假装 cloud 把 valuation review 误串了 moat 字段,但通过 dimension 字段正确归类
    outputs[3].moat_score = 90;
    outputs[3].dimension = "valuation";
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  // valuation 维度应有 1 条 evidence(原 ev 中 valuation 的 evidence_records)
  assert.ok(report.rows[0].review_summaries.valuation);
});

// M-6:dimension 字段是非法值时,回退到字段名匹配(不抛错)。
test("falls back to field-name heuristic when dimension field is invalid", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[0].dimension = "wrong_dimension";
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.equal(report.rows[0].ticker, "AAPL");
});

// M-1:有 veto 时 auditStatus 应该是 "vetoed",而不是 "pass"。
test("audit_status reflects vetoes as 'vetoed'", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[2].survival_risks = ["现金流承压"];
    outputs[2].balance_sheet_score = null; // 触发 survival_risk_with_weak_balance_sheet veto
  }});
  const report = mergeResults(p);
  assert.ok(report.rows[0].veto_items.length > 0);
  assert.equal(report.rows[0].audit_status, "vetoed");
});

// M-1:有 excessive_rejected_evidence veto 时 auditStatus 应该是 "fail"。
test("audit_status is 'fail' when excessive_rejected_evidence is present", () => {
  // 让 6 条 evidence 都被拒,触发 excessive_rejected_evidence
  const p = payload({ mutate: (outputs) => {
    outputs[0].evidence_records = [
      { claim: "x1", source_ref: "identityPacket.ticker", source_value: "WRONG", period: "FY2025", unit: "text" },
      { claim: "x2", source_ref: "identityPacket.ticker", source_value: "WRONG", period: "FY2025", unit: "text" },
      { claim: "x3", source_ref: "identityPacket.ticker", source_value: "WRONG", period: "FY2025", unit: "text" },
      { claim: "x4", source_ref: "identityPacket.ticker", source_value: "WRONG", period: "FY2025", unit: "text" },
      { claim: "x5", source_ref: "identityPacket.ticker", source_value: "WRONG", period: "FY2025", unit: "text" },
      { claim: "x6", source_ref: "identityPacket.ticker", source_value: "WRONG", period: "FY2025", unit: "text" },
    ];
  }});
  const report = mergeResults(p);
  assert.ok(report.rows[0].veto_items.includes("excessive_rejected_evidence"));
  assert.equal(report.rows[0].audit_status, "fail");
});

// M-4:evidence_records 数量超过上限时,行被 rejected。
test("rejects rows with evidence_records exceeding limit", () => {
  const oversized = Array.from({ length: 51 }, (_, i) => ({
    claim: `c${i}`, source_ref: "financialPacket.metrics.revenue", source_value: 100, period: "FY2025", unit: "USD",
  }));
  const p = payload({ mutate: (outputs) => {
    outputs[0].evidence_records = oversized;
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, false);
  assert.ok(report.rows[0].errors.some((e) => /超过.*上限/.test(e)),
    `expected limit error, got ${JSON.stringify(report.rows[0].errors)}`);
});

// M-4:source_value 字符串超过 2000 字符时,行被 rejected。
test("rejects rows with oversized source_value strings", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[0].evidence_records[0].source_value = "x".repeat(2001);
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, false);
  assert.ok(report.rows[0].errors.some((e) => /超过.*上限/.test(e)));
});

// M-4:边界值 — 50 条 evidence + 2000 字符 source_value 应正常通过。
test("accepts rows at exact limits", () => {
  const atLimit = Array.from({ length: 50 }, (_, i) => ({
    claim: `c${i}`, source_ref: "financialPacket.metrics.revenue", source_value: 100, period: "FY2025", unit: "USD",
  }));
  const p = payload({ mutate: (outputs) => {
    outputs[0].evidence_records = atLimit;
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
});

// M-2:报告里 company_name 含 Markdown 强调字符时,应被转义,不会被渲染为斜体。
test("escapes markdown emphasis characters in report fields", () => {
  const evilName = "*Apple Inc.*";
  const p = payload();
  const newInput = structuredClone(input);
  newInput.identityPacket.companyName = evilName;
  p.rows[0].inputJson = JSON.stringify(Object.fromEntries(Object.entries(newInput).map(([k, v]) => [k, JSON.stringify(v)])));
  const markdown = renderReport(mergeResults(p));
  // 原始的 *Apple Inc.* 应该是经过转义的 \*Apple Inc.\*
  assert.ok(markdown.includes("\\*Apple Inc.\\*"),
    `expected escaped name in markdown, got: ${markdown.slice(0, 200)}`);
  // 没有"非转义"的 * 紧跟字母(这是行内强调触发条件)
  const body = markdown.split("生成时间")[1] || "";
  // 把所有已转义的 \*、\_、\` 占位掉,再检查是否有未转义的 *X 模式
  const stripped = body.replace(/\\[*_`]/g, "");
  assert.ok(!/\*[A-Za-z]/.test(stripped),
    `found unescaped emphasis pattern in body`);
});

// M-2:summary 含 HTML 标签时,应被转义为实体,不会被某些 Markdown 渲染器解析为 HTML。
test("escapes HTML tags in report summaries", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[0].summary = "商业模式 <script>alert(1)</script>";
  }});
  const markdown = renderReport(mergeResults(p));
  assert.ok(markdown.includes("&lt;script&gt;"));
  assert.ok(!markdown.includes("<script>alert"));
});

