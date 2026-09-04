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
    { business_model_score: 80, understandability_score: 80, circle_of_competence: "pass", evidence_records: ev("revenue", "financialPacket.metrics.revenue", 100), positive_points: [], contrary_points: [], unknowns: [], summary: "Business model is clear" },
    { moat_score: 80, management_culture_score: 80, capital_allocation_score: 80, evidence_records: ev("free cash flow", "financialPacket.metrics.fcf", 20), positive_points: [], contrary_points: [], governance_red_flags: [], unknowns: [], summary: "Moat is stable" },
    { financial_quality_score: 80, cash_flow_quality_score: 80, balance_sheet_score: 80, evidence_records: ev("debt", "financialPacket.metrics.debt", 10), positive_points: [], contrary_points: [], accounting_red_flags: [], survival_risks: [], unknowns: [], summary: "Financial quality is healthy" },
    {
      valuation_score: 80, margin_of_safety_score: 80, judgment_state: "eligible_for_manual_deep_research",
      evidence_records: ev("P/E ratio", "financialPacket.metrics.pe", 25),
      validity_basis: [
        { claim: "price", source_ref: "financialPacket.marketSnapshot.price", source_value: 200, period: "2026-07-29", unit: "USD" },
        { claim: "fiscal period", source_ref: "identityPacket.fiscalPeriod", source_value: "FY2025", period: "FY2025", unit: "text" },
      ],
      falsification_conditions: [
        { condition: "price changes", source_ref: "financialPacket.marketSnapshot.price", source_value: 200, period: "2026-07-29", unit: "USD", action: "rerun_required" },
        { condition: "fiscal update", source_ref: "identityPacket.fiscalPeriod", source_value: "FY2025", period: "FY2025", unit: "text", action: "conclusion_invalidated" },
      ],
      positive_points: [], contrary_points: [], valuation_red_flags: [], forbidden_numeric_claims: [], unknowns: [], summary: "Valuation is open to further research",
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
  const report = mergeResults(payload({ mutate: (outputs) => { outputs[3].summary = "our target price is 250 USD"; } }));
  assert.equal(report.rows[0].decision, "pass");
  assert.ok(report.rows[0].veto_items.includes("forbidden_numeric_claims"));
});

test("renders price, evidence and falsification conditions", () => {
  const markdown = renderReport(mergeResults(payload()));
  assert.match(markdown, /200 USD/);
  assert.match(markdown, /Verified evidence/);
  assert.match(markdown, /price changes/);
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
    // Cloud LLM writes a formula that includes the original value "100"
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
  assert.ok(report.rows[0].verified_evidence.some((e) => e.claim === "revenue"));
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
  outputs[0].evidence_records = [{ claim: "debt ratio", source_ref: "financialPacket.metrics.ratio", source_value: "80.0%", period: "FY2025", unit: "text" }];
  const p = {
    rows: [{
      rowIndex: 0, status: "completed",
      inputJson: JSON.stringify(Object.fromEntries(Object.entries(formulaInput).map(([k, v]) => [k, JSON.stringify(v)]))),
      artifacts: outputs.map((v) => ({ opaqueId: "a", inlineText: JSON.stringify(v) })),
    }],
  };
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.ok(report.rows[0].verified_evidence.some((e) => e.claim === "debt ratio"));
});

// H-1 regression: when balance_sheet_score is present but null, the survival_risks veto must fire
// instead of being silently swallowed.
test("vetoes survival_risk_with_weak_balance_sheet when balance_sheet_score is null", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[2].survival_risks = ["operating cash flow has been negative for several quarters"];
    outputs[2].balance_sheet_score = null;
  }});
  const report = mergeResults(p);
  assert.ok(report.rows[0].veto_items.includes("survival_risk_with_weak_balance_sheet"),
    `expected veto, got ${JSON.stringify(report.rows[0].veto_items)}`);
  assert.equal(report.rows[0].decision, "pass");
  assert.equal(report.rows[0].decision_eligible, false);
});

// H-1 boundary: when survival_risks is empty, no veto even if balance_sheet_score is null.
test("does not veto when survival_risks is empty even if balance_sheet_score is null", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[2].survival_risks = [];
    outputs[2].balance_sheet_score = null;
  }});
  const report = mergeResults(p);
  assert.ok(!report.rows[0].veto_items.includes("survival_risk_with_weak_balance_sheet"),
    `unexpected veto: ${JSON.stringify(report.rows[0].veto_items)}`);
});

// H-1 boundary: balance_sheet_score is an explicit weak score (20) and triggers the veto.
test("vetoes when balance_sheet_score is a low finite number", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[2].survival_risks = ["cash flow under pressure"];
    outputs[2].balance_sheet_score = 20;
  }});
  const report = mergeResults(p);
  assert.ok(report.rows[0].veto_items.includes("survival_risk_with_weak_balance_sheet"));
});

// H-1 boundary: balance_sheet_score is a non-numeric string ("unknown") and is treated as weak.
test("vetoes when balance_sheet_score is a non-numeric string", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[2].survival_risks = ["cash flow under pressure"];
    outputs[2].balance_sheet_score = "unknown";
  }});
  const report = mergeResults(p);
  assert.ok(report.rows[0].veto_items.includes("survival_risk_with_weak_balance_sheet"),
    `expected veto, got ${JSON.stringify(report.rows[0].veto_items)}`);
});

// H-2: when the cloud returns a packet as structured step.input, that wins over prompt-string extraction.
test("prefers structured step.input over prompt string extraction", () => {
  const structuredInput = {
    identityPacket: { ticker: "AAPL", companyName: "Apple Inc.", fiscalPeriod: "FY2025", dataAsOf: "2026-07-29" },
    financialPacket: { marketSnapshot: { price: 200, currency: "USD", asOf: "2026-07-29" }, metrics: { revenue: 100, fcf: 20, debt: 10, pe: 25 } },
    qualitativePacket: {},
  };
  // Decoy prompt with a misleading IDENTITY label; structured step.input must still win.
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

// H-2: when the cloud wraps prompt-embedded packets in ```json fences, the local parser still extracts them.
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

// H-2: when outer directly contains the three packet objects (not strings), parseInput takes that path.
test("accepts outer object with packet objects directly", () => {
  const p = payload();
  p.rows[0].inputJson = JSON.stringify({
    identityPacket: input.identityPacket,
    financialPacket: input.financialPacket,
    qualitativePacket: input.qualitativePacket,
  });
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.equal(report.rows[0].ticker, "AAPL");
});

// M-7: getPath should treat prototype-chain keys as "cannot be resolved", not as a value mismatch.
test("rejects source_ref that targets a prototype-chain property", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[0].evidence_records[0].source_ref = "identityPacket.toString";
  }});
  const report = mergeResults(p);
  assert.ok(report.rows[0].rejected_evidence.some((e) => /cannot be resolved/i.test(e.reason)),
    `expected "cannot be resolved" reason, got ${JSON.stringify(report.rows[0].rejected_evidence)}`);
});

// M-6: an explicit dimension field wins over the field-name heuristic.
test("respects explicit dimension field over field-name heuristic", () => {
  const p = payload({ mutate: (outputs) => {
    // Cloud accidentally includes a moat field in the valuation review; the explicit
    // `dimension` field must still route it to valuation.
    outputs[3].moat_score = 90;
    outputs[3].dimension = "valuation";
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.ok(report.rows[0].review_summaries.valuation);
});

// M-6: an invalid dimension value falls back to field-name matching without erroring.
test("falls back to field-name heuristic when dimension field is invalid", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[0].dimension = "wrong_dimension";
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.equal(report.rows[0].ticker, "AAPL");
});

// M-1: any veto should make auditStatus 'vetoed', not 'pass'.
test("audit_status reflects vetoes as 'vetoed'", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[2].survival_risks = ["cash flow under pressure"];
    outputs[2].balance_sheet_score = null; // triggers survival_risk_with_weak_balance_sheet
  }});
  const report = mergeResults(p);
  assert.ok(report.rows[0].veto_items.length > 0);
  assert.equal(report.rows[0].audit_status, "vetoed");
});

// M-1: excessive_rejected_evidence veto forces auditStatus to 'fail'.
test("audit_status is 'fail' when excessive_rejected_evidence is present", () => {
  // Push 6 rejected evidence items to trigger excessive_rejected_evidence.
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

// M-4: evidence_records above the cap rejects the row.
test("rejects rows with evidence_records exceeding limit", () => {
  const oversized = Array.from({ length: 51 }, (_, i) => ({
    claim: `c${i}`, source_ref: "financialPacket.metrics.revenue", source_value: 100, period: "FY2025", unit: "USD",
  }));
  const p = payload({ mutate: (outputs) => {
    outputs[0].evidence_records = oversized;
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, false);
  assert.ok(report.rows[0].errors.some((e) => /exceeds the .* cap/i.test(e)),
    `expected cap error, got ${JSON.stringify(report.rows[0].errors)}`);
});

// M-4: source_value string over 2000 characters rejects the row.
test("rejects rows with oversized source_value strings", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[0].evidence_records[0].source_value = "x".repeat(2001);
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, false);
  assert.ok(report.rows[0].errors.some((e) => /exceeds the .* cap/i.test(e)));
});

// M-4: at the exact limits (50 evidence / 2000 chars) the row is still accepted.
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

// M-2: a Markdown emphasis character in a report field is escaped, not rendered as italics.
test("escapes markdown emphasis characters in report fields", () => {
  const evilName = "*Apple Inc.*";
  const p = payload();
  const newInput = structuredClone(input);
  newInput.identityPacket.companyName = evilName;
  p.rows[0].inputJson = JSON.stringify(Object.fromEntries(Object.entries(newInput).map(([k, v]) => [k, JSON.stringify(v)])));
  const markdown = renderReport(mergeResults(p));
  // The raw *Apple Inc.* must end up as the escaped form \*Apple Inc.\*
  assert.ok(markdown.includes("\\*Apple Inc.\\*"),
    `expected escaped name in markdown, got: ${markdown.slice(0, 200)}`);
  // No unescaped * followed by a letter (the inline-emphasis trigger)
  const body = markdown.split("Generated at")[1] || "";
  const stripped = body.replace(/\\[*_`]/g, "");
  assert.ok(!/\*[A-Za-z]/.test(stripped),
    `found unescaped emphasis pattern in body`);
});

// M-2: HTML tags in a summary are escaped to entities, not parsed as HTML.
test("escapes HTML tags in report summaries", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[0].summary = "Business model <script>alert(1)</script>";
  }});
  const markdown = renderReport(mergeResults(p));
  assert.ok(markdown.includes("&lt;script&gt;"));
  assert.ok(!markdown.includes("<script>alert"));
});

// cogfoundry TemplateSpec input shape: outer.tickerPacket holds the three packets
// joined as newline-separated JSON strings, in identityPacket -> financialPacket ->
// qualitativePacket order. parseInput must reassemble them so evidence audit can
// match source_refs like "financialPacket.marketSnapshot.price".
test("accepts cogfoundry tickerPacket newline-joined input shape", () => {
  const joined = [
    JSON.stringify(input.identityPacket),
    JSON.stringify(input.financialPacket),
    JSON.stringify(input.qualitativePacket),
  ].join("\n");
  const p = payload();
  p.rows[0].inputJson = JSON.stringify({ tickerPacket: joined });
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true, `expected valid, got errors: ${JSON.stringify(report.rows[0].errors)}`);
  assert.equal(report.rows[0].ticker, "AAPL");
  assert.equal(report.rows[0].price, 200);
  assert.equal(report.rows[0].verified_evidence.length, 4);
});

// cogfoundry input shape where each newline-separated segment is one packet directly
// (not wrapped in {identityPacket, financialPacket, qualitativePacket}).
test("accepts cogfoundry tickerPacket with three bare JSON segments", () => {
  const p = payload();
  p.rows[0].inputJson = JSON.stringify({
    tickerPacket: [
      JSON.stringify(input.identityPacket),
      JSON.stringify(input.financialPacket),
      JSON.stringify(input.qualitativePacket),
    ].join("\n"),
  });
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true, `expected valid, got errors: ${JSON.stringify(report.rows[0].errors)}`);
  assert.equal(report.rows[0].ticker, "AAPL");
  assert.equal(report.rows[0].verified_evidence.length, 4);
});
