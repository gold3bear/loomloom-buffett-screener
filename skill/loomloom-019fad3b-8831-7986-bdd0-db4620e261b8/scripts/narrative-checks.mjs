// Narrative-vs-packet numeric checks.
//
// The four cloud reviews are prose. A local evidence audit verifies atomic
// facts, but it does not catch a sentence that says "FCF is 1.6x net income"
// when the packet says 0.81x. These checks extract a small set of high-value
// numeric claims and compare them with the packet. They are deliberately
// rule-based: no model, no network, deterministic.
//
// Findings are advisories by default. `merge-public-results --strict-narrative`
// turns them into a veto; otherwise they set audit_status=warn.

const NUM = String.raw`([0-9][0-9,]*(?:\.[0-9]+)?)`;
const SCALE = { b: 1000, billion: 1000, m: 1, million: 1 };

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function last(values) {
  return Array.isArray(values) && values.length ? values[values.length - 1] : null;
}

function number(value) {
  return Number(String(value ?? "").replace(/,/g, ""));
}

function num(value) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function scaleOf(unit) {
  return SCALE[String(unit || "").toLowerCase()] ?? 1;
}

export function metricsOf(packet) {
  const financial = asObject(asObject(packet).financialPacket);
  const market = asObject(financial.marketSnapshot);
  const balance = asObject(financial.balanceSheet);
  const annual = asObject(financial.annualHistory);
  const recent = asObject(financial.quarterlyMostRecent);
  const ttm = asObject(recent.ttm);
  const shares = num(market.sharesOutstanding) ?? num(balance.sharesOutstanding);
  const price = num(market.price);
  const cash = num(balance.cash);
  const debt = num(balance.totalDebt) ?? ((num(balance.shortTermDebt) ?? 0) + (num(balance.longTermDebt) ?? 0));
  const annualFcf = num(last(annual.freeCashFlow));
  const annualNi = num(last(annual.netIncome));
  const ttmFcf = num(ttm.fcf);
  const ttmNi = num(ttm.netIncome);
  const ttmRevenue = num(ttm.revenue);
  const ttmOperating = num(ttm.operatingIncome);
  const pe = num(market.pe);
  const computedPe = pe === null && price !== null && shares && ttmNi ? price / (ttmNi / shares) : null;
  return {
    shares,
    price,
    pe: pe ?? computedPe,
    cash,
    debt,
    netCash: cash !== null && debt !== null ? cash - debt : null,
    annualFcf,
    annualNi,
    annualFcfToNi: annualFcf !== null && annualNi ? annualFcf / annualNi : null,
    ttmFcf,
    ttmNi,
    ttmRevenue,
    ttmOperating,
    ttmFcfToNi: ttmFcf !== null && ttmNi ? ttmFcf / ttmNi : null,
    ttmOperatingMargin: ttmOperating !== null && ttmRevenue ? ttmOperating / ttmRevenue : null,
  };
}

function contextOf(text) {
  return /fy\s*2026|fiscal\s*(?:year\s*)?2026|10-k/i.test(text) ? "annual" : "ttm";
}

function ratioFor(metrics, text) {
  return contextOf(text) === "annual" ? metrics.annualFcfToNi : metrics.ttmFcfToNi;
}

function flattenTexts(reviews) {
  const out = [];
  const visit = (value, path) => {
    if (typeof value === "string" && value.trim()) out.push({ path, text: value });
    else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`));
    else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (["evidence_records", "falsification_conditions"].includes(key)) continue;
        visit(item, `${path}.${key}`);
      }
    }
  };
  visit(reviews, "reviews");
  return out;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function push(findings, code, path, message, stated, computed) {
  if (findings.some((entry) => entry.code === code && entry.path === path)) return;
  findings.push({ code, severity: "error", path, message, stated, computed });
}

export function checkNarrative(reviews, packet) {
  const metrics = metricsOf(packet);
  const findings = [];
  for (const { path, text } of flattenTexts(reviews)) {
    const ratio = ratioFor(metrics, text);

    for (const match of text.matchAll(new RegExp(String.raw`fcf\s*\/\s*ni\s*(?:=|is|of|at|:)?\s*${NUM}\s*%`, "gi"))) {
      const stated = number(match[1]) / 100;
      if (ratio !== null && Math.abs(stated - ratio) > 0.06) {
        push(findings, "NARRATIVE_FCF_NI_CONFLICT", path, `stated FCF/NI ${pct(stated)} but packet implies ${pct(ratio)}`, pct(stated), pct(ratio));
      }
    }

    for (const match of text.matchAll(new RegExp(String.raw`fcf\s*\/\s*ni\s*(?:=|is|of|at|:)?\s*${NUM}\s*(?:x|times)`, "gi"))) {
      const stated = number(match[1]);
      if (ratio !== null && Math.abs(stated - ratio) > 0.12) {
        push(findings, "NARRATIVE_FCF_NI_CONFLICT", path, `stated FCF/NI ${stated.toFixed(2)}x but packet implies ${ratio.toFixed(2)}x`, `${stated.toFixed(2)}x`, `${ratio.toFixed(2)}x`);
      }
    }

    for (const match of text.matchAll(new RegExp(String.raw`free cash flow[^.]{0,80}?${NUM}\s*(?:x|times)\s*(?:net income|ni)`, "gi"))) {
      const stated = number(match[1]);
      if (ratio !== null && Math.abs(stated - ratio) > 0.12) {
        push(findings, "NARRATIVE_FCF_NI_CONFLICT", path, `stated FCF ${stated.toFixed(2)}x net income but packet implies ${ratio.toFixed(2)}x`, `${stated.toFixed(2)}x`, `${ratio.toFixed(2)}x`);
      }
    }

    for (const match of text.matchAll(new RegExp(String.raw`(?:free cash flow|fcf)[^.]{0,100}?\b(exceeds|exceeded|above|greater than|below|less than|under)\b[^.]{0,60}?(?:net income|ni)`, "gi"))) {
      if (ratio === null) continue;
      const direction = /exceed|above|greater/i.test(match[1]) ? "above" : "below";
      if ((direction === "above" && ratio < 1.0) || (direction === "below" && ratio > 1.0)) {
        push(findings, "NARRATIVE_FCF_NI_CONFLICT", path, `text says FCF is ${direction} net income but packet ratio is ${ratio.toFixed(2)}x`, direction, `${ratio.toFixed(2)}x`);
      }
    }

    for (const match of text.matchAll(new RegExp(String.raw`net income[^.]{0,60}?\b(exceeds|above|greater than|below|less than|under)\b[^.]{0,60}?(?:free cash flow|fcf)`, "gi"))) {
      if (ratio === null) continue;
      const direction = /exceed|above|greater/i.test(match[1]) ? "above" : "below";
      if ((direction === "above" && ratio > 1.0) || (direction === "below" && ratio < 1.0)) {
        push(findings, "NARRATIVE_FCF_NI_CONFLICT", path, `text says net income is ${direction} FCF but packet ratio is ${ratio.toFixed(2)}x`, direction, `${ratio.toFixed(2)}x`);
      }
    }

    if (metrics.shares !== null) {
      const patterns = [
        new RegExp(String.raw`shares outstanding[^.]{0,50}?${NUM}\s*(billion|b|million|m)`, "gi"),
        new RegExp(String.raw`${NUM}\s*(billion|b)\s*(?:diluted\s*)?shares`, "gi"),
      ];
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          const stated = number(match[1]) * scaleOf(match[2]);
          if (Math.abs(stated - metrics.shares) / Math.max(1, metrics.shares) > 0.06) {
            push(findings, "NARRATIVE_SHARES_CONFLICT", path, `stated ${stated.toFixed(0)}M shares but packet has ${metrics.shares.toFixed(0)}M`, `${stated.toFixed(0)}M`, `${metrics.shares.toFixed(0)}M`);
          }
        }
      }
    }

    if (metrics.pe !== null) {
      const patterns = [
        new RegExp(String.raw`p\/e[^.]{0,30}?${NUM}\s*x`, "gi"),
        new RegExp(String.raw`${NUM}\s*x\s*(?:p\/e|pe|trailing earnings)`, "gi"),
      ];
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          const stated = number(match[1]);
          if (Math.abs(stated - metrics.pe) / Math.max(1, metrics.pe) > 0.10) {
            push(findings, "NARRATIVE_PE_CONFLICT", path, `stated P/E ${stated.toFixed(1)}x but packet has ${metrics.pe.toFixed(1)}x`, `${stated.toFixed(1)}x`, `${metrics.pe.toFixed(1)}x`);
          }
        }
      }
    }

    if (metrics.netCash !== null) {
      for (const match of text.matchAll(new RegExp(String.raw`net cash[^.]{0,50}?\$?\s*(-|−)?${NUM}\s*(billion|b|million|m)`, "gi"))) {
        const negative = match[1] === "-" || match[1] === "−";
        const stated = (negative ? -1 : 1) * number(match[2]) * scaleOf(match[3]);
        if (metrics.netCash < 0) {
          if (stated >= 0) {
            push(findings, "NARRATIVE_NET_CASH_CONFLICT", path, `text says net cash ${stated.toFixed(0)}M but packet has net debt ${Math.abs(metrics.netCash).toFixed(0)}M`, `${stated.toFixed(0)}M cash`, `${Math.abs(metrics.netCash).toFixed(0)}M debt`);
          } else if (Math.abs(Math.abs(stated) - Math.abs(metrics.netCash)) / Math.max(1, Math.abs(metrics.netCash)) > 0.08) {
            push(findings, "NARRATIVE_NET_CASH_CONFLICT", path, `stated net cash ${stated.toFixed(0)}M but packet has net debt ${Math.abs(metrics.netCash).toFixed(0)}M`, `${stated.toFixed(0)}M`, `-${Math.abs(metrics.netCash).toFixed(0)}M`);
          }
        } else if (Math.abs(stated - metrics.netCash) / Math.max(1, Math.abs(metrics.netCash)) > 0.08) {
          push(findings, "NARRATIVE_NET_CASH_CONFLICT", path, `stated net cash ${stated.toFixed(0)}M but packet has ${metrics.netCash.toFixed(0)}M`, `${stated.toFixed(0)}M`, `${metrics.netCash.toFixed(0)}M`);
        }
      }
      for (const match of text.matchAll(new RegExp(String.raw`net debt[^.]{0,50}?\$?\s*(-|−)?${NUM}\s*(billion|b|million|m)`, "gi"))) {
        const negative = match[1] === "-" || match[1] === "−";
        const stated = (negative ? -1 : 1) * number(match[2]) * scaleOf(match[3]);
        const computedDebt = -metrics.netCash;
        if (computedDebt < 0) {
          push(findings, "NARRATIVE_NET_CASH_CONFLICT", path, `text says net debt ${stated.toFixed(0)}M but packet has net cash ${Math.abs(computedDebt).toFixed(0)}M`, `${stated.toFixed(0)}M debt`, `${Math.abs(computedDebt).toFixed(0)}M cash`);
        } else if (Math.abs(stated - computedDebt) / Math.max(1, computedDebt) > 0.08) {
          push(findings, "NARRATIVE_NET_CASH_CONFLICT", path, `stated net debt ${stated.toFixed(0)}M but packet has ${computedDebt.toFixed(0)}M`, `${stated.toFixed(0)}M`, `${computedDebt.toFixed(0)}M`);
        }
      }
    }
  }
  return findings;
}
