#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deterministic three-statement + DCF model for the LoomLoom value-screening Skill.

The same source file runs in two places:

* LoomLoom Code node (``python-pure@1``, CPython 3.12, standard library only).
* Local audit runner (``node scripts/run-model.mjs`` -> ``python3 model/valuation_model.py``).

Design rules
------------
* No network, no third-party packages, no secrets, no wall-clock timestamps.
* Every assumption is explicit. A missing driver is an error, never a default.
* The model emits a full arithmetic trace so the local audit can recompute it.
* The workbook is a presentation of the audited values. It intentionally does
  not rely on Excel formulas, because a formula typo would silently diverge
  from the JSON the audit verifies. Change assumptions and rerun instead.

The model is a research aid. It is not investment advice and it does not emit
target prices, position sizes, or buy/sell instructions.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import zipfile
from typing import Any, Dict, List, Optional, Sequence, Tuple
from xml.sax.saxutils import escape

ENGINE_VERSION = "1.1.0"
MODEL_SCHEMA = "loomloom-investment-model/v1"
ASSUMPTIONS_SCHEMA = "loomloom-model-assumptions/v1"
DEFAULT_WORKBOOK = "model.xlsx"
DEFAULT_TOLERANCE = 1e-6
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

MISSING = "MISSING_ASSUMPTION"
INVALID = "INVALID_ASSUMPTION"


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _issue(code: str, path: str, message: str) -> Dict[str, str]:
    return {"code": code, "path": path, "message": message}


def _num(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            return None
        return float(value)
    if isinstance(value, str):
        text = value.strip().replace(",", "").replace("$", "")
        if not text:
            return None
        try:
            parsed = float(text)
        except ValueError:
            return None
        return parsed if math.isfinite(parsed) else None
    return None


def _pick(container: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in container and container[key] is not None:
            return container[key]
    return None


def _round(value: Optional[float], digits: int = 6) -> Optional[float]:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


def _safe_div(numerator: Optional[float], denominator: Optional[float]) -> Optional[float]:
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _as_series(value: Any, years: int, path: str, errors: List[Dict[str, str]], missing: List[str]) -> Optional[List[float]]:
    if value is None:
        errors.append(_issue(MISSING, path, "required driver is missing"))
        missing.append(path)
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return [float(value)] * years
    if isinstance(value, list):
        if len(value) != years:
            errors.append(_issue(INVALID, path, "array length must equal years (%d), got %d" % (years, len(value))))
            return None
        series = []
        for index, item in enumerate(value):
            parsed = _num(item)
            if parsed is None:
                errors.append(_issue(INVALID, "%s[%d]" % (path, index), "must be a finite number"))
                return None
            series.append(parsed)
        return series
    errors.append(_issue(INVALID, path, "must be a number or an array of numbers"))
    return None


def _parse_json_object(value: Any, label: str) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    text = str(value or "").strip()
    if not text:
        raise ValueError("%s is empty" % label)
    try:
        parsed = json.loads(text)
    except ValueError as exc:
        raise ValueError("%s is not valid JSON: %s" % (label, exc))
    if not isinstance(parsed, dict):
        raise ValueError("%s must be a JSON object" % label)
    return parsed


def _extract_packets(value: Any) -> Dict[str, Any]:
    parsed = _parse_json_object(value, "tickerPacket")
    row = parsed.get("tickerPacket")
    if isinstance(row, str):
        parsed = _parse_json_object(row, "tickerPacket.tickerPacket")
    elif isinstance(row, dict):
        parsed = row
    for key in ("identityPacket", "financialPacket"):
        inner = parsed.get(key)
        if isinstance(inner, str):
            parsed[key] = _parse_json_object(inner, key)
    return parsed


# ---------------------------------------------------------------------------
# Input normalisation
# ---------------------------------------------------------------------------


REQUIRED_SCENARIO_FIELDS = [
    "years",
    "revenueGrowth",
    "ebitMargin",
    "taxRate",
    "daPctRevenue",
    "capexPctRevenue",
    "nwcPctRevenue",
    "interestRateOnDebt",
    "debtRepaymentPct",
    "wacc",
    "terminalMethod",
]


def _normalise_scenario(name: str, raw: Any, errors: List[Dict[str, str]], missing: List[str], warnings: List[Dict[str, str]]) -> Optional[Dict[str, Any]]:
    prefix = "scenarios.%s" % name
    if not isinstance(raw, dict):
        errors.append(_issue(INVALID, prefix, "scenario must be an object"))
        return None

    ok = True
    years_raw = _num(raw.get("years"))
    if years_raw is None:
        errors.append(_issue(MISSING, prefix + ".years", "required integer 1-10"))
        missing.append(prefix + ".years")
        return None
    years = int(years_raw)
    if years != years_raw or years < 1 or years > 10:
        errors.append(_issue(INVALID, prefix + ".years", "must be an integer between 1 and 10"))
        return None

    scenario: Dict[str, Any] = {
        "label": str(raw.get("label") or name.replace("_", " ").title()),
        "years": years,
    }

    for field in ("revenueGrowth", "ebitMargin"):
        series = _as_series(raw.get(field), years, "%s.%s" % (prefix, field), errors, missing)
        if series is None:
            ok = False
        else:
            scenario[field] = series
    for index, growth in enumerate(scenario.get("revenueGrowth", [])):
        if growth <= -0.99 or growth > 3.0:
            errors.append(_issue(INVALID, "%s.revenueGrowth[%d]" % (prefix, index), "must be greater than -0.99 and at most 3.0"))
            ok = False
    for index, margin in enumerate(scenario.get("ebitMargin", [])):
        if margin < -1.0 or margin > 1.0:
            errors.append(_issue(INVALID, "%s.ebitMargin[%d]" % (prefix, index), "must be between -1.0 and 1.0"))
            ok = False

    scalar_fields = [
        ("taxRate", 0.0, 0.6, False),
        ("daPctRevenue", 0.0, 1.0, False),
        ("capexPctRevenue", 0.0, 2.0, False),
        ("nwcPctRevenue", -1.0, 2.0, False),
        ("interestRateOnDebt", 0.0, 0.5, False),
        ("debtRepaymentPct", 0.0, 1.0, False),
        ("dividendPayoutRatio", 0.0, 1.0, True),
        ("buybackPctOfNetIncome", 0.0, 1.0, True),
        ("wacc", 0.005, 0.5, False),
    ]
    for field, low, high, optional in scalar_fields:
        raw_value = raw.get(field)
        if raw_value is None:
            if optional:
                scenario[field] = 0.0
                continue
            errors.append(_issue(MISSING, "%s.%s" % (prefix, field), "required driver is missing"))
            missing.append("%s.%s" % (prefix, field))
            ok = False
            continue
        parsed = _num(raw_value)
        if parsed is None or parsed < low or parsed > high:
            errors.append(_issue(INVALID, "%s.%s" % (prefix, field), "must be a number between %s and %s" % (low, high)))
            ok = False
            continue
        scenario[field] = parsed

    method = str(raw.get("terminalMethod") or "").strip()
    if method not in ("perpetuity", "exitMultiple"):
        errors.append(_issue(MISSING if not method else INVALID, prefix + ".terminalMethod", "must be 'perpetuity' or 'exitMultiple'"))
        missing.append(prefix + ".terminalMethod")
        ok = False
        method = ""
    scenario["terminalMethod"] = method

    if method == "perpetuity":
        growth = _num(raw.get("terminalGrowth"))
        if growth is None:
            errors.append(_issue(MISSING, prefix + ".terminalGrowth", "required when terminalMethod=perpetuity"))
            missing.append(prefix + ".terminalGrowth")
            ok = False
        elif growth <= -0.5 or growth >= 0.25:
            errors.append(_issue(INVALID, prefix + ".terminalGrowth", "must be between -0.5 and 0.25"))
            ok = False
        else:
            scenario["terminalGrowth"] = growth
    elif method == "exitMultiple":
        multiple = _num(_pick(raw, "exitMultiple", "terminalMultiple"))
        if multiple is None or multiple <= 0:
            errors.append(_issue(MISSING, prefix + ".exitMultiple", "required positive multiple when terminalMethod=exitMultiple"))
            missing.append(prefix + ".exitMultiple")
            ok = False
        else:
            scenario["exitMultiple"] = multiple
        basis = str(raw.get("exitMultipleBasis") or "ebit").strip()
        if basis not in ("ebit", "ebitda"):
            errors.append(_issue(INVALID, prefix + ".exitMultipleBasis", "must be 'ebit' or 'ebitda'"))
            ok = False
            basis = "ebit"
        scenario["exitMultipleBasis"] = basis

    wacc = scenario.get("wacc")
    growth = scenario.get("terminalGrowth")
    if method == "perpetuity" and wacc is not None and growth is not None and wacc <= growth + 0.005:
        errors.append(_issue(INVALID, prefix + ".wacc", "must exceed terminalGrowth by at least 0.5 percentage points"))
        ok = False
    if wacc is not None and wacc > 0.3:
        warnings.append(_issue("HIGH_DISCOUNT_RATE", prefix + ".wacc", "discount rate above 30% - verify it is intentional"))

    if raw.get("startingRevenue") is not None:
        starting = _num(raw.get("startingRevenue"))
        if starting is None or starting <= 0:
            errors.append(_issue(INVALID, prefix + ".startingRevenue", "must be a positive number"))
            ok = False
        else:
            scenario["startingRevenue"] = starting

    return scenario if ok else None


def _normalise_balance_sheet(
    financial: Dict[str, Any],
    assumptions: Dict[str, Any],
    shares_hint: Optional[float],
    errors: List[Dict[str, str]],
    missing: List[str],
    warnings: List[Dict[str, str]],
) -> Optional[Dict[str, Any]]:
    bs = financial.get("balanceSheet")
    if not isinstance(bs, dict):
        bs = financial

    cash = _num(_pick(bs, "cash", "cashAndEquivalents", "cashAndCashEquivalents"))
    if cash is None:
        cash = 0.0
        warnings.append(_issue("CASH_DEFAULTED", "financialPacket.balanceSheet.cash", "cash not supplied; opening cash assumed 0 - verify"))

    debt = _num(_pick(bs, "totalDebt", "debt"))
    if debt is None:
        short = _num(_pick(bs, "shortTermDebt", "currentPortionOfDebt"))
        long = _num(_pick(bs, "longTermDebt"))
        if short is not None or long is not None:
            debt = (short or 0.0) + (long or 0.0)
    if debt is None:
        debt = 0.0
        warnings.append(_issue("DEBT_DEFAULTED", "financialPacket.balanceSheet.totalDebt", "debt not supplied; opening debt assumed 0 - verify"))

    equity = _num(_pick(bs, "equity", "totalEquity", "shareholdersEquity", "stockholdersEquity"))
    if equity is None:
        errors.append(_issue(MISSING, "financialPacket.balanceSheet.equity", "opening shareholders' equity is required"))
        missing.append("financialPacket.balanceSheet.equity")

    current_assets = _num(_pick(bs, "currentAssets", "totalCurrentAssets"))
    current_liabilities = _num(_pick(bs, "currentLiabilities", "totalCurrentLiabilities"))
    short_debt = _num(_pick(bs, "shortTermDebt", "currentPortionOfDebt")) or 0.0
    nwc = _num(_pick(bs, "nwc", "netWorkingCapital"))
    if nwc is None:
        if current_assets is not None and current_liabilities is not None:
            nwc = (current_assets - cash) - (current_liabilities - short_debt)
            warnings.append(_issue("NWC_DERIVED", "financialPacket.balanceSheet.nwc", "NWC derived as (currentAssets - cash) - (currentLiabilities - shortTermDebt)"))
        else:
            errors.append(_issue(MISSING, "financialPacket.balanceSheet.nwc", "supply netWorkingCapital, or currentAssets and currentLiabilities"))
            missing.append("financialPacket.balanceSheet.nwc")

    net_ppe = _num(_pick(bs, "netPPE", "ppeNet", "propertyPlantAndEquipmentNet", "netPropertyPlantAndEquipment"))
    total_assets = _num(_pick(bs, "totalAssets"))
    other_assets = _num(_pick(bs, "otherAssets"))
    if net_ppe is None:
        if total_assets is not None and nwc is not None and cash is not None:
            net_ppe = total_assets - cash - nwc - (other_assets or 0.0)
            warnings.append(_issue("PPE_DERIVED", "financialPacket.balanceSheet.netPPE", "net PP&E derived from totalAssets - cash - NWC - otherAssets"))
        else:
            errors.append(_issue(MISSING, "financialPacket.balanceSheet.netPPE", "supply netPPE or totalAssets"))
            missing.append("financialPacket.balanceSheet.netPPE")

    other_liabilities = _num(_pick(bs, "otherLiabilities"))
    if other_liabilities is None:
        other_liabilities = 0.0

    shares = _num(_pick(bs, "sharesOutstanding", "dilutedShares", "shares"))
    if shares is None:
        shares = shares_hint
    if shares is None or shares <= 0:
        errors.append(_issue(MISSING, "financialPacket.balanceSheet.sharesOutstanding", "diluted shares outstanding are required"))
        missing.append("financialPacket.balanceSheet.sharesOutstanding")
        shares = None

    if nwc is None or equity is None or net_ppe is None:
        return None

    assets = cash + nwc + net_ppe + (other_assets or 0.0)
    total_liabilities_and_equity = debt + other_liabilities + equity
    difference = assets - total_liabilities_and_equity
    tolerance = max(1.0, abs(assets) * 0.0001)
    balanced = abs(difference) <= tolerance
    if not balanced:
        errors.append(
            _issue(
                "OPENING_BALANCE_SHEET_DOES_NOT_BALANCE",
                "financialPacket.balanceSheet",
                "assets %.6f != liabilities + equity %.6f (difference %.6f, tolerance %.6f); supply otherAssets/otherLiabilities or correct the inputs"
                % (assets, total_liabilities_and_equity, difference, tolerance),
            )
        )
        missing.append("financialPacket.balanceSheet (does not balance)")

    return {
        "cash": cash,
        "nwc": nwc,
        "netPPE": net_ppe,
        "otherAssets": other_assets or 0.0,
        "totalAssets": assets,
        "debt": debt,
        "otherLiabilities": other_liabilities,
        "equity": equity,
        "totalLiabilitiesAndEquity": total_liabilities_and_equity,
        "difference": difference,
        "balanced": balanced,
        "sharesOutstanding": shares,
    }


def _normalise_history(financial: Dict[str, Any], errors: List[Dict[str, str]], missing: List[str]) -> List[Dict[str, Any]]:
    history = financial.get("annualHistory")
    if not isinstance(history, dict):
        errors.append(_issue(MISSING, "financialPacket.annualHistory", "three fiscal years are required"))
        missing.append("financialPacket.annualHistory")
        return []
    periods = history.get("fiscalYearEnd")
    if not isinstance(periods, list) or not periods:
        errors.append(_issue(MISSING, "financialPacket.annualHistory.fiscalYearEnd", "fiscal year end dates are required"))
        missing.append("financialPacket.annualHistory.fiscalYearEnd")
        return []
    rows = []
    for index, period in enumerate(periods):
        row = {"fiscalYearEnd": str(period)}
        for key in ("revenue", "netIncome", "freeCashFlow"):
            values = history.get(key)
            value = _num(values[index]) if isinstance(values, list) and index < len(values) else None
            row[key] = value
        rows.append(row)
    if rows and rows[-1].get("revenue") is None:
        errors.append(_issue(MISSING, "financialPacket.annualHistory.revenue", "latest fiscal-year revenue is required as the projection base"))
        missing.append("financialPacket.annualHistory.revenue")
    return rows


def _normalise_assumptions(
    raw: Dict[str, Any],
    financial: Dict[str, Any],
    market: Dict[str, Any],
    errors: List[Dict[str, str]],
    missing: List[str],
    warnings: List[Dict[str, str]],
) -> Optional[Dict[str, Any]]:
    scenarios_raw = raw.get("scenarios")
    if not isinstance(scenarios_raw, dict) or not scenarios_raw:
        errors.append(_issue(MISSING, "scenarios", "at least one scenario is required"))
        missing.append("scenarios")
        return None

    scenarios: Dict[str, Any] = {}
    for name, value in scenarios_raw.items():
        key = str(name)
        scenario = _normalise_scenario(key, value, errors, missing, warnings)
        if scenario is not None and scenario.get("revenueGrowth") and scenario.get("ebitMargin"):
            scenarios[key] = scenario

    if not scenarios:
        return None

    base = str(raw.get("baseScenario") or ("base" if "base" in scenarios else next(iter(scenarios))))
    if base not in scenarios:
        errors.append(_issue(INVALID, "baseScenario", "must name one of the supplied scenarios"))
        base = next(iter(scenarios))

    shares = _num(_pick(raw, "sharesOutstanding", "dilutedShares"))
    if shares is None:
        shares = _num(_pick(financial, "sharesOutstanding", "dilutedShares", "shares"))
    if shares is None:
        shares = _num(_pick(market, "sharesOutstanding", "shares"))

    sources = raw.get("sources")
    if not isinstance(sources, list) or not sources:
        warnings.append(_issue("ASSUMPTIONS_WITHOUT_SOURCES", "sources", "no assumption source list supplied; every driver should name its owner and date"))
        sources = []

    return {
        "schemaVersion": str(raw.get("schemaVersion") or ASSUMPTIONS_SCHEMA),
        "asOf": str(raw.get("asOf") or ""),
        "currency": str(raw.get("currency") or market.get("currency") or "USD"),
        "units": str(raw.get("units") or "USD millions"),
        "baseScenario": base,
        "sharesOutstanding": shares,
        "sources": sources,
        "unknowns": raw.get("unknowns") if isinstance(raw.get("unknowns"), list) else [],
        "scenarios": scenarios,
    }


# ---------------------------------------------------------------------------
# Model mechanics
# ---------------------------------------------------------------------------


def _run_scenario(
    name: str,
    scenario: Dict[str, Any],
    opening: Dict[str, Any],
    starting_revenue: float,
    price: float,
) -> Dict[str, Any]:
    years = scenario["years"]
    wacc = scenario["wacc"]
    tax_rate = scenario["taxRate"]
    da_pct = scenario["daPctRevenue"]
    capex_pct = scenario["capexPctRevenue"]
    nwc_pct = scenario["nwcPctRevenue"]
    interest_rate = scenario["interestRateOnDebt"]
    repay_pct = scenario["debtRepaymentPct"]
    payout = scenario.get("dividendPayoutRatio", 0.0)
    buyback_pct = scenario.get("buybackPctOfNetIncome", 0.0)

    cash = opening["cash"]
    debt = opening["debt"]
    equity = opening["equity"]
    nwc_prev = opening["nwc"]
    ppe = opening["netPPE"]
    other_assets = opening["otherAssets"]
    other_liabilities = opening["otherLiabilities"]
    revenue = starting_revenue

    rows: List[Dict[str, Any]] = []
    max_balance_diff = 0.0
    min_cash = cash
    min_equity = equity
    negative_cash_years = []
    negative_equity_years = []

    for year in range(1, years + 1):
        growth = scenario["revenueGrowth"][year - 1]
        margin = scenario["ebitMargin"][year - 1]

        prev_revenue = revenue
        revenue = prev_revenue * (1.0 + growth)
        ebit = revenue * margin
        da = revenue * da_pct
        capex = revenue * capex_pct
        nwc = revenue * nwc_pct
        change_nwc = nwc - nwc_prev

        interest = debt * interest_rate
        ebt = ebit - interest
        tax = max(0.0, ebt) * tax_rate
        net_income = ebt - tax

        dividends = max(0.0, net_income) * payout
        buybacks = max(0.0, net_income) * buyback_pct
        debt_repayment = min(debt, debt * repay_pct)

        cfo = net_income + da - change_nwc
        cfi = -capex
        cff = -debt_repayment - dividends - buybacks
        net_cash_change = cfo + cfi + cff

        cash = cash + net_cash_change
        ppe = ppe + capex - da
        debt = debt - debt_repayment
        equity = equity + net_income - dividends - buybacks

        assets = cash + nwc + ppe + other_assets
        liabilities_and_equity = debt + other_liabilities + equity
        balance_diff = assets - liabilities_and_equity
        max_balance_diff = max(max_balance_diff, abs(balance_diff))

        nopat = ebit * (1.0 - tax_rate)
        fcff = nopat + da - capex - change_nwc
        discount_factor = 1.0 / ((1.0 + wacc) ** year)
        pv_fcff = fcff * discount_factor

        if cash < 0:
            negative_cash_years.append(year)
        if equity < 0:
            negative_equity_years.append(year)
        min_cash = min(min_cash, cash)
        min_equity = min(min_equity, equity)

        rows.append(
            {
                "year": year,
                "fiscalYear": "FY+%d" % year,
                "revenue": _round(revenue),
                "revenueGrowth": _round(growth),
                "ebit": _round(ebit),
                "ebitMargin": _round(margin),
                "da": _round(da),
                "capex": _round(capex),
                "nwc": _round(nwc),
                "changeInNwc": _round(change_nwc),
                "interest": _round(interest),
                "ebt": _round(ebt),
                "tax": _round(tax),
                "netIncome": _round(net_income),
                "dividends": _round(dividends),
                "buybacks": _round(buybacks),
                "debt": _round(debt),
                "debtRepayment": _round(debt_repayment),
                "equity": _round(equity),
                "cash": _round(cash),
                "netPPE": _round(ppe),
                "otherAssets": _round(other_assets),
                "totalAssets": _round(assets),
                "otherLiabilities": _round(other_liabilities),
                "totalLiabilitiesAndEquity": _round(liabilities_and_equity),
                "balanceCheck": _round(balance_diff),
                "cfo": _round(cfo),
                "cfi": _round(cfi),
                "cff": _round(cff),
                "netCashChange": _round(net_cash_change),
                "fcff": _round(fcff),
                "discountFactor": _round(discount_factor),
                "pvFcff": _round(pv_fcff),
            }
        )
        nwc_prev = nwc

    last = rows[-1]
    pv_explicit = sum(row["pvFcff"] for row in rows)
    method = scenario["terminalMethod"]
    if method == "perpetuity":
        growth = scenario["terminalGrowth"]
        terminal_value = last["fcff"] * (1.0 + growth) / (wacc - growth)
        terminal_label = "perpetuity growth %.4f" % growth
    else:
        multiple = scenario["exitMultiple"]
        basis_value = last["ebit"] if scenario.get("exitMultipleBasis", "ebit") == "ebit" else last["ebit"] + last["da"]
        terminal_value = basis_value * multiple
        terminal_label = "%s x %.4f" % (scenario.get("exitMultipleBasis", "ebit").upper(), multiple)
    pv_terminal = terminal_value / ((1.0 + wacc) ** years)
    enterprise_value = pv_explicit + pv_terminal
    net_debt = last["debt"] - last["cash"]
    equity_value = enterprise_value - net_debt
    value_per_share = _safe_div(equity_value, opening["sharesOutstanding"])
    margin_of_safety = None
    upside = None
    if value_per_share is not None and value_per_share > 0 and price > 0:
        margin_of_safety = (value_per_share - price) / value_per_share
        upside = value_per_share / price - 1.0

    cash_tie = abs((cash - opening["cash"]) - sum(row["netCashChange"] for row in rows))
    equity_tie = abs((equity - opening["equity"]) - sum(row["netIncome"] - row["dividends"] - row["buybacks"] for row in rows))
    fcff_tie = max(abs(row["fcff"] - (row["ebit"] * (1.0 - tax_rate) + row["da"] - row["capex"] - row["changeInNwc"])) for row in rows)
    ev_tie = abs(enterprise_value - (sum(row["pvFcff"] for row in rows) + round(pv_terminal, 6)))
    relative_balance = _safe_div(max_balance_diff, max(1.0, abs(opening["totalAssets"])))
    terminal_share = _safe_div(pv_terminal, enterprise_value)

    checks = [
        {"name": "balanceSheetBalances", "severity": "error", "passed": max_balance_diff <= max(0.01, abs(opening["totalAssets"]) * 1e-6), "detail": "max |assets - (liabilities + equity)| = %.10f" % max_balance_diff},
        {"name": "cashFlowReconciles", "severity": "error", "passed": cash_tie <= 1e-3, "detail": "ending cash minus opening cash equals sum of net cash change (gap %.10f)" % cash_tie},
        {"name": "equityRollsForward", "severity": "error", "passed": equity_tie <= 1e-3, "detail": "ending equity equals opening equity plus net income less distributions (gap %.10f)" % equity_tie},
        {"name": "fcffRecomputes", "severity": "error", "passed": fcff_tie <= 1e-3, "detail": "FCFF equals NOPAT + D&A - capex - change in NWC (max gap %.10f)" % fcff_tie},
        {"name": "dcfComponentsReconcile", "severity": "error", "passed": ev_tie <= 1e-2, "detail": "enterprise value equals the displayed PV(FCFF) plus PV(terminal) (gap %.10f)" % ev_tie},
        {"name": "waccExceedsTerminalGrowth", "severity": "error", "passed": method != "perpetuity" or wacc > scenario["terminalGrowth"], "detail": "wacc=%.4f, terminal=%.4f" % (wacc, scenario.get("terminalGrowth", 0.0))},
        {"name": "terminalValueNotDominant", "severity": "warning", "passed": terminal_share is None or terminal_share <= 0.85, "detail": "terminal value is %.2f%% of enterprise value" % ((terminal_share or 0.0) * 100.0)},
    ]

    warnings = []
    implied_nwc = starting_revenue * nwc_pct
    if opening["nwc"] > 0 and implied_nwc > 0:
        nwc_gap = abs(opening["nwc"] - implied_nwc) / max(1.0, opening["nwc"])
        if nwc_gap > 0.5:
            warnings.append(
                _issue(
                    "NWC_DRIVER_MISMATCH",
                    "scenarios.%s.nwcPctRevenue" % name,
                    "opening NWC is %.1f but nwcPctRevenue implies %.1f at the starting revenue; year 1 will show a large working-capital release or build"
                    % (opening["nwc"], implied_nwc),
                )
            )
    if negative_cash_years:
        warnings.append(_issue("NEGATIVE_CASH", "scenarios.%s" % name, "projected cash is negative in year(s) %s; the model assumes the company can fund the gap" % ", ".join(str(y) for y in negative_cash_years)))
    if negative_equity_years:
        warnings.append(_issue("NEGATIVE_EQUITY", "scenarios.%s" % name, "projected equity is negative in year(s) %s" % ", ".join(str(y) for y in negative_equity_years)))
    if terminal_share is not None and terminal_share > 0.85:
        warnings.append(_issue("TERMINAL_VALUE_DOMINANT", "scenarios.%s" % name, "terminal value is %.2f%% of enterprise value; the result is highly sensitive to terminal assumptions" % (terminal_share * 100.0)))
    if value_per_share is None or value_per_share <= 0:
        warnings.append(_issue("NON_POSITIVE_VALUE", "scenarios.%s" % name, "model-implied equity value per share is not positive"))

    summary = {
        "enterpriseValue": _round(enterprise_value),
        "pvExplicit": _round(pv_explicit),
        "terminalValue": _round(terminal_value),
        "pvTerminal": _round(pv_terminal),
        "terminalPctOfEv": _round(terminal_share),
        "terminalMethod": method,
        "terminalAssumption": terminal_label,
        "netDebt": _round(net_debt),
        "equityValue": _round(equity_value),
        "valuePerShare": _round(value_per_share),
        "price": _round(price),
        "marginOfSafetyPct": _round(margin_of_safety),
        "upsidePct": _round(upside),
        "priceToModelValue": _round(_safe_div(price, value_per_share)),
        "minCash": _round(min_cash),
        "minEquity": _round(min_equity),
    }

    return {
        "name": name,
        "label": scenario["label"],
        "rows": rows,
        "summary": summary,
        "checks": checks,
        "warnings": warnings,
        "integrity": {
            "maxBalanceDifference": _round(max_balance_diff),
            "relativeBalanceDifference": _round(relative_balance),
            "passed": all(check["passed"] for check in checks if check.get("severity") == "error"),
        },
    }


def _solve_implied_growth(
    scenario: Dict[str, Any],
    opening: Dict[str, Any],
    starting_revenue: float,
    price: float,
) -> Dict[str, Any]:
    base_growth = scenario["revenueGrowth"]

    def value_at(delta: float) -> Optional[float]:
        shifted = dict(scenario)
        shifted["revenueGrowth"] = [min(2.0, max(-0.95, growth + delta)) for growth in base_growth]
        result = _run_scenario("implied", shifted, opening, starting_revenue, price)
        return result["summary"]["valuePerShare"]

    low, high = -0.5, 0.5
    low_value = value_at(low)
    high_value = value_at(high)
    if low_value is None or high_value is None:
        return {"solved": False, "reason": "model_not_evaluable"}
    if not (low_value <= price <= high_value):
        return {
            "solved": False,
            "reason": "price_outside_solvable_range",
            "rangeLowValue": low_value,
            "rangeHighValue": high_value,
        }

    for _ in range(80):
        middle = (low + high) / 2.0
        middle_value = value_at(middle)
        if middle_value is None:
            return {"solved": False, "reason": "model_not_evaluable"}
        if middle_value < price:
            low = middle
        else:
            high = middle
    delta = (low + high) / 2.0
    implied = [min(2.0, max(-0.95, growth + delta)) for growth in base_growth]
    implied_value = value_at(delta)
    reproduces = implied_value is not None and abs(implied_value - price) <= max(0.01, abs(price) * 0.01)
    checks = [
        {
            "name": "reverseDcfReproducesPrice",
            "severity": "error",
            "passed": bool(reproduces),
            "detail": "value at the implied growth is %.6f versus price %.6f" % (implied_value if implied_value is not None else 0.0, price),
        }
    ]
    return {
        "solved": True,
        "method": "uniform shift to every explicit-year revenue growth rate, holding all other drivers constant",
        "growthDelta": _round(delta),
        "impliedRevenueGrowth": [_round(value) for value in implied],
        "impliedAverageRevenueGrowth": _round(_mean(implied)),
        "impliedValuePerShare": _round(implied_value),
        "iterations": 80,
        "checks": checks,
    }


def _sensitivity(
    scenario: Dict[str, Any],
    opening: Dict[str, Any],
    starting_revenue: float,
    price: float,
    base_value: Optional[float],
) -> Dict[str, Any]:
    method = scenario["terminalMethod"]
    wacc_offsets = [-0.02, -0.01, 0.0, 0.01, 0.02]
    if method == "perpetuity":
        axis_offsets = [-0.01, -0.005, 0.0, 0.005, 0.01]
        axis_label = "terminalGrowthOffset"
    else:
        axis_offsets = [-2.0, -1.0, 0.0, 1.0, 2.0]
        axis_label = "exitMultipleOffset"

    grid: List[List[Optional[float]]] = []
    for wacc_offset in wacc_offsets:
        row: List[Optional[float]] = []
        for axis_offset in axis_offsets:
            candidate = dict(scenario)
            candidate["wacc"] = scenario["wacc"] + wacc_offset
            if method == "perpetuity":
                candidate["terminalGrowth"] = scenario["terminalGrowth"] + axis_offset
                if candidate["wacc"] <= candidate["terminalGrowth"] + 0.001:
                    row.append(None)
                    continue
            else:
                candidate["exitMultiple"] = max(0.1, scenario["exitMultiple"] + axis_offset)
            result = _run_scenario("sensitivity", candidate, opening, starting_revenue, price)
            row.append(result["summary"]["valuePerShare"])
        grid.append(row)

    center = grid[len(wacc_offsets) // 2][len(axis_offsets) // 2]
    center_ok = (
        center is not None
        and base_value is not None
        and abs(center - base_value) <= max(1e-6, abs(base_value) * 1e-6)
    )
    checks = [
        {
            "name": "sensitivityCenterMatchesBase",
            "severity": "error",
            "passed": bool(center_ok),
            "detail": "grid center %.6f versus base value %s" % (center if center is not None else 0.0, "%.6f" % base_value if base_value is not None else "missing"),
        }
    ]

    wacc_monotonic = True
    for column in range(len(axis_offsets)):
        series = [grid[row][column] for row in range(len(wacc_offsets)) if grid[row][column] is not None]
        if any(series[index + 1] > series[index] + 1e-9 for index in range(len(series) - 1)):
            wacc_monotonic = False
            break
    checks.append(
        {
            "name": "sensitivityWaccMonotonic",
            "severity": "warning",
            "passed": wacc_monotonic,
            "detail": "value per share should not increase as WACC increases",
        }
    )

    axis_monotonic = True
    for row in range(len(wacc_offsets)):
        series = [grid[row][column] for column in range(len(axis_offsets)) if grid[row][column] is not None]
        if any(series[index + 1] < series[index] - 1e-9 for index in range(len(series) - 1)):
            axis_monotonic = False
            break
    checks.append(
        {
            "name": "sensitivityTerminalMonotonic",
            "severity": "warning",
            "passed": axis_monotonic,
            "detail": "value per share should not decrease as terminal growth or exit multiple increases",
        }
    )

    return {
        "baseWacc": _round(scenario["wacc"]),
        "waccOffsets": [_round(value) for value in wacc_offsets],
        "axisLabel": axis_label,
        "axisOffsets": [_round(value) for value in axis_offsets],
        "valuesPerShare": grid,
        "price": _round(price),
        "checks": checks,
    }


def build_model(ticker_packet: Any, assumptions_json: Any) -> Dict[str, Any]:
    errors: List[Dict[str, str]] = []
    warnings: List[Dict[str, str]] = []
    missing: List[str] = []

    try:
        packets = _extract_packets(ticker_packet)
    except ValueError as exc:
        return _empty_model(errors=[_issue("PACKET_NOT_JSON", "tickerPacket", str(exc))], missing=["tickerPacket"])
    try:
        raw_assumptions = _parse_json_object(assumptions_json, "modelAssumptions")
    except ValueError as exc:
        return _empty_model(errors=[_issue("ASSUMPTIONS_NOT_JSON", "modelAssumptions", str(exc))], missing=["modelAssumptions"])

    identity = packets.get("identityPacket") if isinstance(packets.get("identityPacket"), dict) else {}
    financial = packets.get("financialPacket") if isinstance(packets.get("financialPacket"), dict) else {}
    market = financial.get("marketSnapshot") if isinstance(financial.get("marketSnapshot"), dict) else {}

    ticker = str(identity.get("ticker") or packets.get("ticker") or "UNKNOWN").upper()
    company_name = str(identity.get("companyName") or "")
    price = _num(market.get("price"))
    if price is None or price <= 0:
        errors.append(_issue(MISSING, "financialPacket.marketSnapshot.price", "a positive current price is required"))
        missing.append("financialPacket.marketSnapshot.price")
        price = 0.0

    history = _normalise_history(financial, errors, missing)

    shares_hint = _num(_pick(market, "sharesOutstanding", "shares"))
    opening = _normalise_balance_sheet(financial, raw_assumptions, shares_hint, errors, missing, warnings)
    normalised = _normalise_assumptions(raw_assumptions, financial, market, errors, missing, warnings)

    starting_revenue = None
    if history and history[-1].get("revenue"):
        starting_revenue = float(history[-1]["revenue"])
    if normalised:
        base_scenario = normalised["scenarios"].get(normalised["baseScenario"], {})
        if base_scenario.get("startingRevenue") is not None:
            if starting_revenue is not None and abs(base_scenario["startingRevenue"] - starting_revenue) / max(1.0, starting_revenue) > 0.05:
                warnings.append(_issue("STARTING_REVENUE_OVERRIDE", "scenarios.%s.startingRevenue" % normalised["baseScenario"], "assumption startingRevenue differs from latest 10-K revenue by more than 5%"))
            starting_revenue = base_scenario["startingRevenue"]
    if starting_revenue is None or starting_revenue <= 0:
        errors.append(_issue(MISSING, "financialPacket.annualHistory.revenue", "a positive latest fiscal-year revenue (or startingRevenue) is required"))
        missing.append("financialPacket.annualHistory.revenue")
    if normalised and normalised.get("sharesOutstanding") is None and opening and opening.get("sharesOutstanding"):
        normalised["sharesOutstanding"] = opening["sharesOutstanding"]
    if opening and normalised and normalised.get("sharesOutstanding"):
        opening["sharesOutstanding"] = normalised["sharesOutstanding"]

    scenarios: Dict[str, Any] = {}
    scenario_errors: Dict[str, Any] = {}
    if normalised and opening and starting_revenue and price > 0 and opening.get("balanced"):
        for name, scenario in normalised["scenarios"].items():
            result = _run_scenario(name, scenario, opening, starting_revenue, price)
            scenarios[name] = result
            warnings.extend(result["warnings"])
            for check in result["checks"]:
                if not check["passed"]:
                    scenario_errors.setdefault(name, []).append(_issue("MODEL_INTEGRITY_CHECK_FAILED", "scenarios.%s.%s" % (name, check["name"]), check["detail"]))

    if scenario_errors:
        for issues in scenario_errors.values():
            errors.extend(issues)

    base_name = normalised["baseScenario"] if normalised else ""
    base_result = scenarios.get(base_name)
    sensitivity = None
    reverse = None
    model_checks: List[Dict[str, Any]] = []
    if base_result and base_result["integrity"]["passed"] and opening and opening.get("balanced") and normalised:
        base_scenario = normalised["scenarios"][base_name]
        base_value = base_result["summary"]["valuePerShare"]
        sensitivity = _sensitivity(base_scenario, opening, starting_revenue, price, base_value)
        reverse = _solve_implied_growth(base_scenario, opening, starting_revenue, price)
        model_checks = list(sensitivity.get("checks", [])) + list(reverse.get("checks", []))
        for check in model_checks:
            if check.get("severity") == "error" and not check.get("passed"):
                errors.append(_issue("MODEL_INVARIANT_FAILED", "model." + check["name"], check["detail"]))

    model_ready = bool(
        base_result
        and base_result["integrity"]["passed"]
        and opening
        and opening.get("balanced")
        and not errors
        and not scenario_errors
    )

    if model_ready and sensitivity:
        base_value = base_result["summary"]["valuePerShare"]
        if base_value is not None:
            warnings.append(_issue("MODEL_VALUE_IS_CONDITIONAL", "scenarios.%s" % base_name, "model-implied value is conditional on the supplied assumptions; it is not a target price"))

    unique_missing = sorted(set(missing))
    limitations = [
        "The model is a deterministic projection of the supplied assumptions; it does not forecast what will happen.",
        "It is not investment advice and does not produce target prices, position sizes, or buy/sell instructions.",
        "Historical figures are copied from the input packet; the model does not re-fetch or re-verify them.",
        "A negative projected cash balance means the model assumes external funding is available.",
        "Terminal value can dominate enterprise value; read the terminal share check before relying on the result.",
    ]

    return {
        "schemaVersion": MODEL_SCHEMA,
        "engineVersion": ENGINE_VERSION,
        "ticker": ticker,
        "companyName": company_name,
        "asOf": str(raw_assumptions.get("asOf") or identity.get("dataAsOf") or ""),
        "price": _round(price),
        "priceAsOf": str(market.get("asOf") or ""),
        "currency": str(normalised["currency"] if normalised else market.get("currency") or "USD"),
        "units": str(normalised["units"] if normalised else "USD millions"),
        "model_ready": model_ready,
        "baseScenario": base_name,
        "missingInputs": unique_missing,
        "errors": errors,
        "warnings": warnings,
        "limitations": limitations,
        "history": history,
        "openingBalanceSheet": opening,
        "assumptions": normalised,
        "scenarios": scenarios,
        "sensitivity": sensitivity,
        "reverseDcf": reverse,
        "modelChecks": model_checks,
    }


def _empty_model(errors: List[Dict[str, str]], missing: List[str]) -> Dict[str, Any]:
    return {
        "schemaVersion": MODEL_SCHEMA,
        "engineVersion": ENGINE_VERSION,
        "ticker": "UNKNOWN",
        "companyName": "",
        "asOf": "",
        "price": None,
        "priceAsOf": "",
        "currency": "USD",
        "units": "USD millions",
        "model_ready": False,
        "baseScenario": "",
        "missingInputs": missing,
        "errors": errors,
        "warnings": [],
        "limitations": [],
        "history": [],
        "openingBalanceSheet": None,
        "assumptions": None,
        "scenarios": {},
        "sensitivity": None,
        "reverseDcf": None,
        "modelChecks": [],
    }


# ---------------------------------------------------------------------------
# Minimal deterministic XLSX writer (stdlib only)
# ---------------------------------------------------------------------------

_STYLES = [
    ("normal", 0, 0, 0, 0, None),
    ("bold", 1, 0, 0, 0, None),
    ("title", 1, 0, 0, 0, None),
    ("header", 1, 0, 2, 1, "center"),
    ("pct", 0, 0, 0, 0, None),
    ("num2", 0, 0, 0, 0, None),
    ("num0", 0, 0, 0, 0, None),
    ("wrap", 0, 0, 0, 0, "left"),
    ("section", 1, 0, 2, 0, None),
    ("pct2", 0, 0, 0, 0, None),
    ("num4", 0, 0, 0, 0, None),
]
_STYLE_INDEX = {"normal": 0, "bold": 1, "title": 2, "header": 3, "pct": 4, "num2": 5, "num0": 6, "wrap": 7, "section": 8, "pct2": 9, "num4": 10}


def _col(index: int) -> str:
    text = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        text = chr(65 + remainder) + text
    return text


def _xml_text(value: Any) -> str:
    return escape(str(value), {"\n": "&#10;"})


def _cell_xml(ref: str, cell: Any) -> str:
    if cell is None:
        return ""
    style = "normal"
    value = cell
    if isinstance(cell, dict):
        value = cell.get("v")
        style = str(cell.get("s") or "normal")
    style_index = _STYLE_INDEX.get(style, 0)
    style_attr = ' s="%d"' % style_index if style_index else ""
    if isinstance(value, bool):
        return '<c r="%s"%s t="b"><v>%d</v></c>' % (ref, style_attr, 1 if value else 0)
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)):
        return '<c r="%s"%s><v>%s</v></c>' % (ref, style_attr, repr(float(value)))
    if value is None or value == "":
        return '<c r="%s"%s/>' % (ref, style_attr)
    text = _xml_text(value)
    preserve = ' xml:space="preserve"' if str(value) != str(value).strip() or "\n" in str(value) else ""
    return '<c r="%s"%s t="inlineStr"><is><t%s>%s</t></is></c>' % (ref, style_attr, preserve, text)


def _sheet_xml(sheet: Dict[str, Any]) -> str:
    rows_xml = []
    for row_index, row in enumerate(sheet.get("rows", []), start=1):
        cells = row.get("cells") if isinstance(row, dict) else row
        height = row.get("height") if isinstance(row, dict) else None
        cells_xml = []
        for col_index, cell in enumerate(cells):
            ref = "%s%d" % (_col(col_index), row_index)
            rendered = _cell_xml(ref, cell)
            if rendered:
                cells_xml.append(rendered)
        height_attr = ' ht="%s" customHeight="1"' % height if height else ""
        rows_xml.append('<row r="%d"%s>%s</row>' % (row_index, height_attr, "".join(cells_xml)))

    cols = sheet.get("cols") or []
    if cols:
        cols_xml = "<cols>%s</cols>" % "".join(
            '<col min="%d" max="%d" width="%s" customWidth="1"/>' % (index + 1, index + 1, width) for index, width in enumerate(cols)
        )
    else:
        cols_xml = ""

    merges = sheet.get("merges") or []
    merges_xml = ""
    if merges:
        merges_xml = '<mergeCells count="%d">%s</mergeCells>' % (
            len(merges),
            "".join('<mergeCell ref="%s"/>' % ref for ref in merges),
        )

    freeze = sheet.get("freeze", True)
    pane_xml = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' if freeze else ""

    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetViews><sheetView workbookViewId="0">%s</sheetView></sheetViews>'
        "%s<sheetData>%s</sheetData>%s</worksheet>"
    ) % (pane_xml, cols_xml, "".join(rows_xml), merges_xml)


def _styles_xml() -> str:
    num_formats = (
        '<numFmts count="4">'
        '<numFmt numFmtId="164" formatCode="0.0%"/>'
        '<numFmt numFmtId="165" formatCode="#,##0.00"/>'
        '<numFmt numFmtId="166" formatCode="#,##0"/>'
        '<numFmt numFmtId="167" formatCode="0.00%"/>'
        "</numFmts>"
    )
    fonts = (
        '<fonts count="3">'
        '<font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="16"/><name val="Calibri"/></font>'
        "</fonts>"
    )
    fills = (
        '<fills count="3">'
        '<fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF7"/><bgColor indexed="64"/></patternFill></fill>'
        "</fills>"
    )
    borders = '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    xfs = []
    for name, font, fill, num_fmt, border, align in _STYLES:
        attrs = 'numFmtId="%d" fontId="%d" fillId="%d" borderId="%d" xfId="0"' % (num_fmt, font, fill, border)
        if num_fmt == 0 and name in ("pct",):
            attrs = 'numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"'
        if name == "pct2":
            attrs = 'numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"'
        if name == "num2":
            attrs = 'numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"'
        if name == "num0":
            attrs = 'numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"'
        if name == "num4":
            attrs = 'numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"'
        child = ""
        if align:
            horizontal = "center" if align == "center" else "left"
            child = '<alignment horizontal="%s" vertical="top" wrapText="1"/>' % horizontal
        xfs.append("<xf %s applyAlignment=\"%d\">%s</xf>" % (attrs, 1 if child else 0, child))
    cell_xfs = '<cellXfs count="%d">%s</cellXfs>' % (len(xfs), "".join(xfs))
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        "%s%s%s%s%s%s"
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        "</styleSheet>"
    ) % (num_formats, fonts, fills, borders, '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>', cell_xfs)


def _content_types_xml(sheet_count: int) -> str:
    overrides = [
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ]
    for index in range(1, sheet_count + 1):
        overrides.append(
            '<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % index
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        "%s</Types>"
    ) % "".join(overrides)


def _workbook_xml(sheets: List[Dict[str, Any]]) -> str:
    entries = []
    for index, sheet in enumerate(sheets, start=1):
        name = str(sheet.get("name") or "Sheet%d" % index)[:31]
        for char in set('[]:*?/\\'):
            name = name.replace(char, "-")
        entries.append('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (_xml_text(name), index, index))
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        "<sheets>%s</sheets></workbook>"
    ) % "".join(entries)


def _workbook_rels_xml(sheets: List[Dict[str, Any]]) -> str:
    rels = []
    for index in range(1, len(sheets) + 1):
        rels.append(
            '<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>' % (index, index)
        )
    rels.append(
        '<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' % (len(sheets) + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s</Relationships>'
    ) % "".join(rels)


def _package_rels_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        "</Relationships>"
    )


def _core_xml(model: Dict[str, Any]) -> str:
    title = "%s - three-statement DCF model" % (model.get("ticker") or "US equity")
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        "<dc:title>%s</dc:title><dc:creator>LoomLoom valuation model %s</dc:creator>"
        "<cp:lastModifiedBy>LoomLoom valuation model</cp:lastModifiedBy>"
        "</cp:coreProperties>"
    ) % (_xml_text(title), ENGINE_VERSION)


def _app_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        "<Application>LoomLoom valuation model</Application></Properties>"
    )


def write_xlsx(path: str, model: Dict[str, Any]) -> str:
    sheets = _workbook_sheets(model)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        def add(name: str, data: str) -> None:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data.encode("utf-8"))

        add("[Content_Types].xml", _content_types_xml(len(sheets)))
        add("_rels/.rels", _package_rels_xml())
        add("docProps/core.xml", _core_xml(model))
        add("docProps/app.xml", _app_xml())
        add("xl/workbook.xml", _workbook_xml(sheets))
        add("xl/_rels/workbook.xml.rels", _workbook_rels_xml(sheets))
        add("xl/styles.xml", _styles_xml())
        for index, sheet in enumerate(sheets, start=1):
            add("xl/worksheets/sheet%d.xml" % index, _sheet_xml(sheet))
    return path


# ---------------------------------------------------------------------------
# Workbook content
# ---------------------------------------------------------------------------


def _pct(value: Optional[float]) -> Optional[str]:
    return None if value is None else "%.2f%%" % (value * 100.0)


def _money(value: Optional[float]) -> Optional[str]:
    return None if value is None else "{:,.1f}".format(value)


def _year_headers(scenario: Dict[str, Any]) -> List[str]:
    return ["FY0"] + ["FY+%d" % index for index in range(1, scenario["years"] + 1)]


def _line(label: str, values: List[Any], style: str = "num0", formula: str = "") -> List[Any]:
    cells: List[Any] = [{"v": label, "s": "bold"}]
    cells.extend([{"v": value, "s": style} if value is not None else None for value in values])
    cells.append({"v": formula, "s": "wrap"} if formula else "")
    return cells


def _workbook_sheets(model: Dict[str, Any]) -> List[Dict[str, Any]]:
    ticker = model.get("ticker") or "UNKNOWN"
    sheets: List[Dict[str, Any]] = []

    # Cover ---------------------------------------------------------------
    cover_rows: List[Any] = [
        {"cells": [{"v": "LoomLoom three-statement + DCF model", "s": "title"}, "", "", "", ""], "height": 26},
        {"cells": [{"v": "%s %s" % (ticker, model.get("companyName") or ""), "s": "bold"}, "", "", "", ""]},
        {"cells": [{"v": "Research aid only. Not investment advice. No target prices, position sizes, or buy/sell instructions.", "s": "wrap"}, "", "", "", ""]},
        [],
        {"cells": [{"v": "Model ready", "s": "bold"}, {"v": "YES" if model.get("model_ready") else "NO", "s": "bold"}]},
        {"cells": [{"v": "Price", "s": "bold"}, {"v": model.get("price"), "s": "num2"}, {"v": model.get("currency") or ""}]},
        {"cells": [{"v": "Price as of", "s": "bold"}, {"v": model.get("priceAsOf") or ""}]},
        {"cells": [{"v": "Data as of", "s": "bold"}, {"v": model.get("asOf") or ""}]},
        {"cells": [{"v": "Units", "s": "bold"}, {"v": model.get("units") or ""}]},
        {"cells": [{"v": "Engine", "s": "bold"}, {"v": model.get("engineVersion") or ""}]},
        [],
    ]
    if model.get("errors"):
        cover_rows.append({"cells": [{"v": "Errors", "s": "section"}]})
        for issue in model["errors"]:
            cover_rows.append({"cells": [{"v": "%s | %s | %s" % (issue.get("code"), issue.get("path"), issue.get("message")), "s": "wrap"}]})
    if model.get("warnings"):
        cover_rows.append({"cells": [{"v": "Warnings", "s": "section"}]})
        for issue in model["warnings"]:
            cover_rows.append({"cells": [{"v": "%s | %s | %s" % (issue.get("code"), issue.get("path"), issue.get("message")), "s": "wrap"}]})
    cover_rows.append({"cells": [{"v": "Limitations", "s": "section"}]})
    for item in model.get("limitations") or []:
        cover_rows.append({"cells": [{"v": item, "s": "wrap"}]})
    sheets.append({"name": "Cover", "rows": cover_rows, "cols": [46, 18, 18, 18, 18], "merges": ["A1:E1", "A3:E3"]})

    # Assumptions ---------------------------------------------------------
    scenario_names = list((model.get("scenarios") or {}).keys())
    if not scenario_names and model.get("assumptions"):
        scenario_names = list(model["assumptions"].get("scenarios", {}).keys())
    assumptions_rows: List[Any] = [
        {"cells": [{"v": "Driver", "s": "header"}] + [{"v": name, "s": "header"} for name in scenario_names] + [{"v": "Formula / note", "s": "header"}]},
    ]

    raw_scenarios = ((model.get("assumptions") or {}).get("scenarios") or {})
    driver_rows = [
        ("years", "years", "num0"),
        ("revenueGrowth", "revenue growth by year", "pct"),
        ("ebitMargin", "EBIT margin by year", "pct"),
        ("taxRate", "cash tax rate", "pct"),
        ("daPctRevenue", "D&A % revenue", "pct"),
        ("capexPctRevenue", "capex % revenue", "pct"),
        ("nwcPctRevenue", "NWC % revenue", "pct"),
        ("interestRateOnDebt", "interest rate on opening debt", "pct"),
        ("debtRepaymentPct", "debt repayment % of opening debt", "pct"),
        ("dividendPayoutRatio", "dividend payout % of net income", "pct"),
        ("buybackPctOfNetIncome", "buyback % of net income", "pct"),
        ("wacc", "discount rate (WACC)", "pct"),
        ("terminalMethod", "terminal method", "normal"),
    ]
    for key, label, style in driver_rows:
        cells: List[Any] = [{"v": label, "s": "bold"}]
        for name in scenario_names:
            scenario = raw_scenarios.get(name) or {}
            value = scenario.get(key)
            if isinstance(value, list):
                value = " / ".join("%.2f%%" % (item * 100.0) for item in value)
                style = "normal"
            elif isinstance(value, float) and key != "years":
                value = value
            cells.append({"v": value, "s": style if not isinstance(value, str) else "normal"})
        cells.append({"v": "", "s": "normal"})
        assumptions_rows.append({"cells": cells})

    for key, label in (("terminalGrowth", "terminal growth"), ("exitMultiple", "exit multiple"), ("exitMultipleBasis", "exit multiple basis")):
        cells = [{"v": label, "s": "bold"}]
        for name in scenario_names:
            value = (raw_scenarios.get(name) or {}).get(key)
            cells.append({"v": value, "s": "pct" if key == "terminalGrowth" else "num2" if key == "exitMultiple" else "normal"})
        cells.append({"v": "", "s": "normal"})
        assumptions_rows.append({"cells": cells})

    assumptions_rows.append([])
    assumptions_rows.append({"cells": [{"v": "Assumption sources", "s": "section"}]})
    sources = ((model.get("assumptions") or {}).get("sources") or [])
    if sources:
        for item in sources:
            if isinstance(item, dict):
                assumptions_rows.append({"cells": [{"v": "%s = %s | %s | %s" % (item.get("field"), item.get("value"), item.get("source"), item.get("date")), "s": "wrap"}]})
            else:
                assumptions_rows.append({"cells": [{"v": str(item), "s": "wrap"}]})
    else:
        assumptions_rows.append({"cells": [{"v": "No source list supplied. Every driver should name its owner and date.", "s": "wrap"}]})
    sheets.append({"name": "Assumptions", "rows": assumptions_rows, "cols": [40] + [22] * max(1, len(scenario_names)) + [46]})

    # Historical ----------------------------------------------------------
    history_rows: List[Any] = [
        {"cells": [{"v": "Fiscal year end", "s": "header"}, {"v": "Revenue", "s": "header"}, {"v": "Net income", "s": "header"}, {"v": "Free cash flow", "s": "header"}]},
    ]
    for item in model.get("history") or []:
        history_rows.append({"cells": [{"v": item.get("fiscalYearEnd"), "s": "normal"}, {"v": item.get("revenue"), "s": "num0"}, {"v": item.get("netIncome"), "s": "num0"}, {"v": item.get("freeCashFlow"), "s": "num0"}]})
    sheets.append({"name": "Historical", "rows": history_rows, "cols": [18, 18, 18, 18]})

    # P&L / BS / CF / DCF per scenario -----------------------------------
    for name in scenario_names:
        result = (model.get("scenarios") or {}).get(name)
        if not result:
            continue
        rows = result["rows"]
        headers = ["Line item"] + ["FY+%d" % row["year"] for row in rows] + ["Formula"]
        pl_rows: List[Any] = [{"cells": [{"v": "Income statement - %s" % result.get("label", name), "s": "section"}]}, {"cells": [{"v": item, "s": "header"} for item in headers]}]
        pl_rows.append(_line("Revenue", [row["revenue"] for row in rows], "num0", "Prior revenue x (1 + growth)"))
        pl_rows.append(_line("Revenue growth", [row["revenueGrowth"] for row in rows], "pct", "Assumption"))
        pl_rows.append(_line("EBIT", [row["ebit"] for row in rows], "num0", "Revenue x EBIT margin"))
        pl_rows.append(_line("EBIT margin", [row["ebitMargin"] for row in rows], "pct", "Assumption"))
        pl_rows.append(_line("Interest expense", [row["interest"] for row in rows], "num0", "Opening debt x interest rate"))
        pl_rows.append(_line("Pre-tax income", [row["ebt"] for row in rows], "num0", "EBIT - interest"))
        pl_rows.append(_line("Tax", [row["tax"] for row in rows], "num0", "max(0, pre-tax) x tax rate"))
        pl_rows.append(_line("Net income", [row["netIncome"] for row in rows], "num0", "Pre-tax - tax"))
        sheets.append({"name": ("P&L " + name)[:31], "rows": pl_rows, "cols": [30] + [15] * len(rows) + [44]})

        bs_rows: List[Any] = [{"cells": [{"v": "Balance sheet - %s" % result.get("label", name), "s": "section"}]}, {"cells": [{"v": item, "s": "header"} for item in headers]}]
        opening = model.get("openingBalanceSheet") or {}
        bs_rows.append(_line("Cash", [opening.get("cash")] + [row["cash"] for row in rows], "num0", "Prior cash + CFO + CFI + CFF"))
        bs_rows.append(_line("Net working capital", [opening.get("nwc")] + [row["nwc"] for row in rows], "num0", "Revenue x NWC %"))
        bs_rows.append(_line("Net PP&E", [opening.get("netPPE")] + [row["netPPE"] for row in rows], "num0", "Prior PP&E + capex - D&A"))
        bs_rows.append(_line("Other assets", [opening.get("otherAssets")] + [row["otherAssets"] for row in rows], "num0", "Held constant"))
        bs_rows.append(_line("Total assets", [opening.get("totalAssets")] + [row["totalAssets"] for row in rows], "num0", "Sum of assets"))
        bs_rows.append(_line("Debt", [opening.get("debt")] + [row["debt"] for row in rows], "num0", "Prior debt - repayment"))
        bs_rows.append(_line("Other liabilities", [opening.get("otherLiabilities")] + [row["otherLiabilities"] for row in rows], "num0", "Held constant"))
        bs_rows.append(_line("Shareholders' equity", [opening.get("equity")] + [row["equity"] for row in rows], "num0", "Prior equity + NI - distributions"))
        bs_rows.append(_line("Total liabilities + equity", [opening.get("totalLiabilitiesAndEquity")] + [row["totalLiabilitiesAndEquity"] for row in rows], "num0", "Debt + other liabilities + equity"))
        bs_rows.append(_line("Check", [opening.get("difference")] + [row["balanceCheck"] for row in rows], "num4", "Assets - (liabilities + equity); must be 0"))
        sheets.append({"name": ("BS " + name)[:31], "rows": bs_rows, "cols": [30] + [15] * len(rows) + [44]})

        cf_rows: List[Any] = [{"cells": [{"v": "Cash flow - %s" % result.get("label", name), "s": "section"}]}, {"cells": [{"v": item, "s": "header"} for item in headers]}]
        cf_rows.append(_line("Net income", [row["netIncome"] for row in rows], "num0", "From P&L"))
        cf_rows.append(_line("D&A", [row["da"] for row in rows], "num0", "Revenue x D&A %"))
        cf_rows.append(_line("Change in NWC", [-row["changeInNwc"] for row in rows], "num0", "-(NWC this year - NWC prior year)"))
        cf_rows.append(_line("Operating cash flow", [row["cfo"] for row in rows], "num0", "NI + D&A - change in NWC"))
        cf_rows.append(_line("Capex", [-row["capex"] for row in rows], "num0", "-(Revenue x capex %)"))
        cf_rows.append(_line("Investing cash flow", [row["cfi"] for row in rows], "num0", "-capex"))
        cf_rows.append(_line("Debt repayment", [-row["debtRepayment"] for row in rows], "num0", "-(Opening debt x repayment %)"))
        cf_rows.append(_line("Dividends", [-row["dividends"] for row in rows], "num0", "-(Net income x payout)"))
        cf_rows.append(_line("Buybacks", [-row["buybacks"] for row in rows], "num0", "-(Net income x buyback %)"))
        cf_rows.append(_line("Financing cash flow", [row["cff"] for row in rows], "num0", "Repayment + dividends + buybacks"))
        cf_rows.append(_line("Net cash change", [row["netCashChange"] for row in rows], "num0", "CFO + CFI + CFF"))
        cf_rows.append(_line("Ending cash", [row["cash"] for row in rows], "num0", "Opening cash + net change"))
        sheets.append({"name": ("CF " + name)[:31], "rows": cf_rows, "cols": [30] + [15] * len(rows) + [44]})

        dcf_rows: List[Any] = [{"cells": [{"v": "DCF - %s" % result.get("label", name), "s": "section"}]}, {"cells": [{"v": item, "s": "header"} for item in headers]}]
        dcf_rows.append(_line("EBIT x (1 - tax)", [row["ebit"] * (1.0 - (raw_scenarios.get(name) or {}).get("taxRate", 0.0)) for row in rows], "num0", "NOPAT"))
        dcf_rows.append(_line("+ D&A", [row["da"] for row in rows], "num0", "Non-cash add-back"))
        dcf_rows.append(_line("- Capex", [-row["capex"] for row in rows], "num0", "Cash investment"))
        dcf_rows.append(_line("- Change in NWC", [-row["changeInNwc"] for row in rows], "num0", "Working-capital investment"))
        dcf_rows.append(_line("FCFF", [row["fcff"] for row in rows], "num0", "NOPAT + D&A - capex - change in NWC"))
        dcf_rows.append(_line("Discount factor", [row["discountFactor"] for row in rows], "num4", "1 / (1 + WACC) ^ year"))
        dcf_rows.append(_line("PV of FCFF", [row["pvFcff"] for row in rows], "num0", "FCFF x discount factor"))
        dcf_rows.append([])
        summary = result.get("summary") or {}
        summary_rows = [
            ("PV of explicit FCFF", summary.get("pvExplicit"), "num0"),
            ("Terminal value", summary.get("terminalValue"), "num0"),
            ("PV of terminal value", summary.get("pvTerminal"), "num0"),
            ("Terminal % of EV", summary.get("terminalPctOfEv"), "pct"),
            ("Enterprise value", summary.get("enterpriseValue"), "num0"),
            ("Net debt", summary.get("netDebt"), "num0"),
            ("Equity value", summary.get("equityValue"), "num0"),
            ("Value per share", summary.get("valuePerShare"), "num2"),
            ("Price", summary.get("price"), "num2"),
            ("Margin of safety", summary.get("marginOfSafetyPct"), "pct"),
            ("Upside / downside", summary.get("upsidePct"), "pct"),
        ]
        for label, value, style in summary_rows:
            dcf_rows.append({"cells": [{"v": label, "s": "bold"}, {"v": value, "s": style}]})
        dcf_rows.append({"cells": [{"v": "Terminal assumption", "s": "bold"}, {"v": summary.get("terminalAssumption"), "s": "normal"}]})
        dcf_rows.append({"cells": [{"v": "Model-implied value is conditional, not a target price.", "s": "wrap"}]})
        sheets.append({"name": ("DCF " + name)[:31], "rows": dcf_rows, "cols": [30] + [15] * len(rows) + [44]})

    # Sensitivity ---------------------------------------------------------
    sensitivity = model.get("sensitivity")
    if sensitivity:
        width = len(sensitivity["axisOffsets"])
        header = [{"v": "WACC \\ terminal axis", "s": "header"}] + [{"v": "%+.2f%%" % (offset * 100.0) if sensitivity["axisLabel"] == "terminalGrowthOffset" else "%+.1fx" % offset, "s": "header"} for offset in sensitivity["axisOffsets"]]
        sens_rows: List[Any] = [
            {"cells": [{"v": "Value per share sensitivity - base scenario", "s": "section"}]},
            {"cells": header},
        ]
        for index, offset in enumerate(sensitivity["waccOffsets"]):
            row_cells: List[Any] = [{"v": "%+.2f%% WACC" % (offset * 100.0), "s": "bold"}]
            for value in sensitivity["valuesPerShare"][index]:
                row_cells.append({"v": value, "s": "num2"})
            sens_rows.append({"cells": row_cells})
        sens_rows.append({"cells": [{"v": "Blank cells are invalid combinations (WACC at or below terminal growth).", "s": "wrap"}]})
        sheets.append({"name": "Sensitivity", "rows": sens_rows, "cols": [22] + [16] * width})

    # Checks --------------------------------------------------------------
    check_rows: List[Any] = [{"cells": [{"v": "Scenario", "s": "header"}, {"v": "Check", "s": "header"}, {"v": "Passed", "s": "header"}, {"v": "Detail", "s": "header"}]}]
    for name, result in (model.get("scenarios") or {}).items():
        for check in result.get("checks") or []:
            check_rows.append({"cells": [{"v": name}, {"v": check.get("name")}, {"v": "PASS" if check.get("passed") else "FAIL", "s": "bold" if not check.get("passed") else "normal"}, {"v": check.get("detail"), "s": "wrap"}]})
    for check in model.get("modelChecks") or []:
        check_rows.append({"cells": [{"v": "model"}, {"v": check.get("name")}, {"v": "PASS" if check.get("passed") else "FAIL", "s": "bold" if not check.get("passed") else "normal"}, {"v": check.get("detail"), "s": "wrap"}]})
    sheets.append({"name": "Checks", "rows": check_rows, "cols": [16, 34, 10, 80]})

    return sheets


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


def main(inputs: Any) -> Dict[str, Any]:
    """LoomLoom Code node entrypoint.

    Declared inputs: ``tickerPacket`` (string), ``assumptions`` (string).
    Declared outputs: ``model`` (object value), ``workbook`` (xlsx artifact).
    """
    if not isinstance(inputs, dict):
        inputs = {}
    ticker_packet = inputs.get("tickerPacket") or inputs.get("packet") or "{}"
    assumptions = inputs.get("assumptions") or inputs.get("modelAssumptions") or "{}"
    model = build_model(ticker_packet, assumptions)

    workbook_path = DEFAULT_WORKBOOK
    try:
        write_xlsx(workbook_path, model)
    except Exception as exc:  # pragma: no cover - defensive: artifact must still be declared
        model.setdefault("errors", []).append(_issue("WORKBOOK_WRITE_FAILED", "workbook", str(exc)))
        model["model_ready"] = False
        workbook_path = ""
    return {"model": model, "workbook": workbook_path}


def _cli(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic three-statement + DCF model")
    parser.add_argument("--packets", required=True, help="tickerPacket JSON file (or a row with identityPacket/financialPacket)")
    parser.add_argument("--assumptions", required=True, help="model assumptions JSON file")
    parser.add_argument("--out", required=True, help="model JSON output path")
    parser.add_argument("--xlsx", default="", help="optional xlsx output path")
    parser.add_argument("--pretty", action="store_true", help="pretty-print JSON")
    args = parser.parse_args(argv)

    with open(args.packets, "r", encoding="utf-8") as handle:
        packets = handle.read()
    with open(args.assumptions, "r", encoding="utf-8") as handle:
        assumptions = handle.read()

    model = build_model(packets, assumptions)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(model, handle, ensure_ascii=False, indent=2 if args.pretty else None, sort_keys=True)
        handle.write("\n")
    if args.xlsx:
        write_xlsx(args.xlsx, model)
    return 0 if model.get("model_ready") else 2


if __name__ == "__main__":
    sys.exit(_cli())
