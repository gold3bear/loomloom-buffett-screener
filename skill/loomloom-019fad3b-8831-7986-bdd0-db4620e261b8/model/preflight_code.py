#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Cloud preflight gate for the LoomLoom v4 template.

Runs as a Code node before the four paid reviews and the model node. It checks
the input contract only: packet shape, freshness, sources, units, market-cap
reconciliation, balance-sheet presence, source tiers, and model-assumption
drivers. It has no network access and never fetches a filing or a quote.

Outputs:
    ready     boolean  -- false when any error-severity finding exists
    findings  array    -- [{code, severity, path, message}]
    summary   object   -- {ticker, asOf, checks, errors, warnings, ready}

The same rules exist in the local ``preflight.mjs``. The cloud copy is a
fail-fast gate; the local copy remains the development and offline reference.
"""

from __future__ import annotations

import datetime
import json
import re
from typing import Any, Dict, List, Optional

TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.-]{0,9}$")
TIERS = ("S", "A", "B", "C")
QUAL_GROUPS = ("businessModel", "moatEvidence", "managementCulture", "capitalAllocation", "riskFactors", "contraryEvidence", "unknowns")
FACT_GROUPS = QUAL_GROUPS[:6]
SCENARIO_FIELDS = (
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
)


def _issue(code: str, severity: str, path: str, message: str) -> Dict[str, str]:
    return {"code": code, "severity": severity, "path": path, "message": message}


def _num(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip().replace(",", "").replace("$", ""))
        except ValueError:
            return None
    return None


def _text(value: Any) -> str:
    return str(value or "").strip()


def _obj(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _parse_json(value: Any, label: str) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    raw = _text(value)
    if not raw:
        raise ValueError("%s is empty" % label)
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("%s must be a JSON object" % label)
    return parsed


def _date(value: Any) -> Optional[datetime.date]:
    raw = _text(value)
    if not re.match(r"^\d{4}-\d{2}-\d{2}", raw):
        return None
    try:
        return datetime.date.fromisoformat(raw[:10])
    except ValueError:
        return None


def _age_days(value: Any, reference: datetime.date) -> Optional[int]:
    parsed = _date(value)
    if parsed is None:
        return None
    return (reference - parsed).days


class Preflight:
    def __init__(self, reference: datetime.date):
        self.reference = reference
        self.findings: List[Dict[str, str]] = []
        self.checks = 0

    def add(self, code: str, severity: str, path: str, message: str) -> None:
        self.checks += 1
        self.findings.append(_issue(code, severity, path, message))

    def require(self, condition: bool, code: str, path: str, message: str) -> bool:
        self.checks += 1
        if not condition:
            self.findings.append(_issue(code, "error", path, message))
            return False
        return True

    def warn(self, condition: bool, code: str, path: str, message: str) -> bool:
        self.checks += 1
        if not condition:
            self.findings.append(_issue(code, "warning", path, message))
            return False
        return True


def _check_identity(pre: Preflight, identity: Dict[str, Any]) -> str:
    ticker = _text(identity.get("ticker")).upper()
    pre.require(bool(TICKER_RE.match(ticker)), "INVALID_TICKER", "identityPacket.ticker", "ticker must match ^[A-Z][A-Z0-9.-]{0,9}$")
    pre.require(bool(_text(identity.get("companyName"))), "COMPANY_NAME_MISSING", "identityPacket.companyName", "companyName is required")
    pre.require(bool(_text(identity.get("fiscalPeriod"))), "FISCAL_PERIOD_MISSING", "identityPacket.fiscalPeriod", "fiscalPeriod is required")

    text_date = _date(identity.get("dataAsOf"))
    if not pre.require(text_date is not None, "INVALID_DATE", "identityPacket.dataAsOf", "dataAsOf must be a valid YYYY-MM-DD date"):
        return ticker
    age = (pre.reference - text_date).days
    pre.require(age <= 45, "STALE_DATA", "identityPacket.dataAsOf", "dataAsOf is more than 45 days old")
    pre.require(age >= -1, "FUTURE_DATA", "identityPacket.dataAsOf", "dataAsOf is later than the as-of date")

    sources = identity.get("sources") if isinstance(identity.get("sources"), list) else []
    valid_sources = [source for source in sources if isinstance(source, str) and source.startswith("https://")]
    pre.require(bool(valid_sources), "SOURCES_MISSING", "identityPacket.sources", "at least one HTTPS source URL is required")
    return ticker


def _check_financial(pre: Preflight, financial: Dict[str, Any]) -> Optional[float]:
    pre.require(bool(financial), "FINANCIAL_PACKET_MISSING", "financialPacket", "financialPacket must be an object")
    if not financial:
        return None

    units = _text(financial.get("units"))
    pre.warn(units.startswith(("USD", "CNY", "EUR", "GBP", "JPY", "HKD")), "UNITS_MISSING", "financialPacket.units", "declare units, e.g. 'USD millions'")

    market = _obj(financial.get("marketSnapshot"))
    pre.require(bool(market), "MARKET_SNAPSHOT_MISSING", "financialPacket.marketSnapshot", "marketSnapshot is required")
    if not market:
        return None

    price = _num(market.get("price"))
    pre.require(price is not None and price > 0, "INVALID_PRICE", "financialPacket.marketSnapshot.price", "price must be a positive number")

    currency = _text(market.get("currency"))
    unit_currency = units[:3] if units[:3].isalpha() and units[:3].isupper() else ""
    pre.require(bool(currency) or bool(unit_currency), "CURRENCY_MISSING", "financialPacket.marketSnapshot.currency", "currency is required, or derive it from financialPacket.units")
    if currency and unit_currency:
        pre.require(currency == unit_currency, "CURRENCY_MISMATCH", "financialPacket.marketSnapshot.currency", "currency does not match financialPacket.units")

    quote_date = _date(market.get("asOf"))
    if pre.require(quote_date is not None, "INVALID_DATE", "financialPacket.marketSnapshot.asOf", "quote asOf must be a valid date"):
        age = (pre.reference - quote_date).days
        pre.require(age <= 7, "STALE_PRICE", "financialPacket.marketSnapshot.asOf", "quote is more than 7 days old")
        pre.require(age >= -1, "FUTURE_DATA", "financialPacket.marketSnapshot.asOf", "quote asOf is later than the as-of date")

    pe = market.get("pe")
    if pe is None:
        unknowns = financial.get("unknowns") if isinstance(financial.get("unknowns"), list) else []
        pre.require(
            any(re.search(r"\b(pe|p\/e|earnings|loss)\b", str(item), re.I) for item in unknowns),
            "PE_UNKNOWN_UNEXPLAINED",
            "financialPacket.unknowns",
            "a null PE must be explained in financialPacket.unknowns",
        )
    else:
        parsed_pe = _num(pe)
        pre.require(parsed_pe is not None, "INVALID_PE", "financialPacket.marketSnapshot.pe", "PE must be a number or null")
        if parsed_pe is not None:
            pre.warn(parsed_pe > 0, "NON_POSITIVE_PE", "financialPacket.marketSnapshot.pe", "PE is zero or negative; confirm it is meaningful")

    history = _obj(financial.get("annualHistory"))
    periods = history.get("fiscalYearEnd") if isinstance(history.get("fiscalYearEnd"), list) else []
    valid_periods = [_date(period) for period in periods]
    pre.require(len(periods) >= 3 and all(valid_periods), "INVALID_FISCAL_PERIODS", "financialPacket.annualHistory.fiscalYearEnd", "at least three valid fiscal year end dates are required")
    for key in ("revenue", "netIncome", "freeCashFlow"):
        values = history.get(key)
        if pre.require(isinstance(values, list), "MISSING_ANNUAL_SERIES", "financialPacket.annualHistory.%s" % key, "annual series is required"):
            pre.require(len(values) == len(periods), "HISTORY_LENGTH_MISMATCH", "financialPacket.annualHistory.%s" % key, "array length must match fiscalYearEnd")
    revenue = history.get("revenue") if isinstance(history.get("revenue"), list) else []
    pre.require(bool(revenue) and _num(revenue[-1]) is not None and _num(revenue[-1]) > 0, "INVALID_STARTING_REVENUE", "financialPacket.annualHistory.revenue", "latest fiscal-year revenue must be positive")

    balance = _obj(financial.get("balanceSheet"))
    if not balance:
        balance = financial
    shares = _num(balance.get("sharesOutstanding") or financial.get("sharesOutstanding") or market.get("sharesOutstanding"))
    pre.require(shares is not None and shares > 0, "SHARES_MISSING", "financialPacket.balanceSheet.sharesOutstanding", "diluted shares are required for per-share and market-cap checks")

    market_cap = _num(market.get("marketCapUsd"))
    if not pre.require(market_cap is not None and market_cap > 0, "MARKET_CAP_MISSING", "financialPacket.marketSnapshot.marketCapUsd", "marketCapUsd is required for reconciliation (same units as financialPacket)"):
        market_cap = None
    if market_cap is not None and price is not None and shares is not None and shares > 0:
        delta = abs(price * shares - market_cap) / market_cap
        pre.require(delta <= 0.02, "MARKET_CAP_MISMATCH", "financialPacket.marketSnapshot.marketCapUsd", "price * shares differs from marketCapUsd by %.2f%%, above the 2%% tolerance" % (delta * 100.0))

    equity = _num(balance.get("equity") or balance.get("totalEquity") or balance.get("shareholdersEquity") or balance.get("stockholdersEquity"))
    pre.require(equity is not None, "BALANCE_SHEET_EQUITY_MISSING", "financialPacket.balanceSheet.equity", "opening shareholders' equity is required")
    nwc = _num(balance.get("nwc") or balance.get("netWorkingCapital"))
    current_assets = _num(balance.get("currentAssets"))
    current_liabilities = _num(balance.get("currentLiabilities"))
    if nwc is None:
        pre.require(current_assets is not None and current_liabilities is not None, "BALANCE_SHEET_NWC_MISSING", "financialPacket.balanceSheet.netWorkingCapital", "supply netWorkingCapital, or currentAssets and currentLiabilities")
        if current_assets is not None and current_liabilities is not None:
            short_debt = _num(balance.get("shortTermDebt")) or 0.0
            nwc = (current_assets - (_num(balance.get("cash")) or 0.0)) - (current_liabilities - short_debt)
    net_ppe = _num(balance.get("netPPE") or balance.get("ppeNet") or balance.get("propertyPlantAndEquipmentNet"))
    total_assets = _num(balance.get("totalAssets"))
    pre.require(net_ppe is not None or total_assets is not None, "BALANCE_SHEET_PPE_MISSING", "financialPacket.balanceSheet.netPPE", "supply netPPE or totalAssets")

    if equity is not None and nwc is not None and (net_ppe is not None or total_assets is not None):
        cash = _num(balance.get("cash")) or 0.0
        debt = _num(balance.get("totalDebt") or balance.get("debt")) or 0.0
        if debt == 0.0:
            debt = (_num(balance.get("shortTermDebt")) or 0.0) + (_num(balance.get("longTermDebt")) or 0.0)
        other_assets = _num(balance.get("otherAssets")) or 0.0
        other_liabilities = _num(balance.get("otherLiabilities")) or 0.0
        if net_ppe is None and total_assets is not None:
            net_ppe = total_assets - cash - nwc - other_assets
        assets = cash + nwc + net_ppe + other_assets
        liabilities_and_equity = debt + other_liabilities + equity
        tolerance = max(1.0, abs(assets) * 0.0001)
        gap = abs(assets - liabilities_and_equity)
        pre.require(gap <= tolerance, "OPENING_BALANCE_SHEET_UNBALANCED", "financialPacket.balanceSheet", "assets %.1f vs liabilities + equity %.1f (gap %.1f, tolerance %.1f)" % (assets, liabilities_and_equity, gap, tolerance))

    return price


def _check_qualitative(pre: Preflight, qualitative: Dict[str, Any]) -> None:
    for group in QUAL_GROUPS:
        pre.require(isinstance(qualitative.get(group), list), "QUALITATIVE_GROUP_MISSING", "qualitativePacket.%s" % group, "group must be an array")
    for group in FACT_GROUPS:
        items = qualitative.get(group)
        if not isinstance(items, list):
            continue
        for index, item in enumerate(items):
            path = "qualitativePacket.%s[%d]" % (group, index)
            if not pre.require(isinstance(item, dict), "QUALITATIVE_FACT_INVALID", path, "fact must be an object"):
                continue
            pre.require(bool(_text(item.get("fact"))), "FACT_MISSING", path + ".fact", "fact text is required")
            source = _text(item.get("source"))
            pre.require(source.startswith("https://"), "FACT_SOURCE_INVALID", path + ".source", "source must be an HTTPS URL")
            fact_date = _date(item.get("date"))
            if pre.require(fact_date is not None, "FACT_DATE_INVALID", path + ".date", "date must be a valid YYYY-MM-DD"):
                age = (pre.reference - fact_date).days
                pre.warn(age <= 550, "FACT_STALE", path + ".date", "qualitative fact is older than 550 days")
                pre.require(age >= -1, "FUTURE_DATA", path + ".date", "fact date is later than the as-of date")
            tier = _text(item.get("sourceTier") or item.get("tier")).upper()
            if not tier:
                pre.warn(False, "SOURCE_TIER_MISSING", path + ".sourceTier", "add sourceTier S/A/B/C so tier gating is explicit")
            elif tier not in TIERS:
                pre.require(False, "SOURCE_TIER_INVALID", path + ".sourceTier", "sourceTier must be one of S, A, B, C")
            elif tier == "C":
                pre.require(False, "TIER_C_NOT_EVIDENCE", path + ".sourceTier", "C-tier sources (forums/blogs/Wikipedia) cannot carry evidence")


def _check_scenario(pre: Preflight, name: str, scenario: Dict[str, Any]) -> None:
    prefix = "modelAssumptions.scenarios.%s" % name
    years = _num(scenario.get("years"))
    pre.require(years is not None and float(int(years)) == years and 1 <= int(years) <= 10, "SCENARIO_YEARS_INVALID", prefix + ".years", "years must be an integer 1-10")
    year_count = int(years) if years is not None and float(int(years)) == years and 1 <= int(years) <= 10 else None

    for field in SCENARIO_FIELDS:
        pre.require(scenario.get(field) is not None, "SCENARIO_DRIVER_MISSING", "%s.%s" % (prefix, field), "required driver is missing; there are no defaults")

    for field in ("revenueGrowth", "ebitMargin"):
        value = scenario.get(field)
        if isinstance(value, list):
            if year_count is not None:
                pre.require(len(value) == year_count, "SCENARIO_SERIES_LENGTH", "%s.%s" % (prefix, field), "array length must equal years")
            for index, item in enumerate(value):
                pre.require(_num(item) is not None, "SCENARIO_SERIES_INVALID", "%s.%s[%d]" % (prefix, field, index), "must be a finite number")
        elif value is not None:
            pre.require(_num(value) is not None, "SCENARIO_SERIES_INVALID", "%s.%s" % (prefix, field), "must be a number or an array of numbers")

    ranges = {
        "taxRate": (0.0, 0.6),
        "daPctRevenue": (0.0, 1.0),
        "capexPctRevenue": (0.0, 2.0),
        "nwcPctRevenue": (-1.0, 2.0),
        "interestRateOnDebt": (0.0, 0.5),
        "debtRepaymentPct": (0.0, 1.0),
        "wacc": (0.005, 0.5),
    }
    for field, (low, high) in ranges.items():
        value = _num(scenario.get(field))
        if value is not None:
            pre.require(low <= value <= high, "SCENARIO_DRIVER_RANGE", "%s.%s" % (prefix, field), "must be between %s and %s" % (low, high))

    method = _text(scenario.get("terminalMethod"))
    pre.require(method in ("perpetuity", "exitMultiple"), "SCENARIO_TERMINAL_METHOD", prefix + ".terminalMethod", "must be 'perpetuity' or 'exitMultiple'")
    wacc = _num(scenario.get("wacc"))
    if method == "perpetuity":
        growth = _num(scenario.get("terminalGrowth"))
        if pre.require(growth is not None and -0.5 < growth < 0.25, "SCENARIO_TERMINAL_GROWTH", prefix + ".terminalGrowth", "terminalGrowth must be between -0.5 and 0.25"):
            pre.require(wacc is not None and wacc > growth + 0.005, "SCENARIO_WACC_NOT_ABOVE_TERMINAL", prefix + ".wacc", "WACC must exceed terminalGrowth by at least 0.5 percentage points")
    elif method == "exitMultiple":
        multiple = _num(scenario.get("exitMultiple") or scenario.get("terminalMultiple"))
        pre.require(multiple is not None and multiple > 0, "SCENARIO_EXIT_MULTIPLE", prefix + ".exitMultiple", "exitMultiple must be positive")
        basis = _text(scenario.get("exitMultipleBasis") or "ebit")
        pre.require(basis in ("ebit", "ebitda"), "SCENARIO_EXIT_BASIS", prefix + ".exitMultipleBasis", "must be 'ebit' or 'ebitda'")
    if scenario.get("startingRevenue") is not None:
        starting = _num(scenario.get("startingRevenue"))
        pre.require(starting is not None and starting > 0, "SCENARIO_STARTING_REVENUE", prefix + ".startingRevenue", "must be positive")


def _check_assumptions(pre: Preflight, assumptions: Dict[str, Any]) -> None:
    scenarios = assumptions.get("scenarios")
    pre.require(isinstance(scenarios, dict) and bool(scenarios), "SCENARIOS_MISSING", "modelAssumptions.scenarios", "at least one scenario is required")
    if not isinstance(scenarios, dict):
        return
    for name, scenario in scenarios.items():
        if pre.require(isinstance(scenario, dict), "SCENARIO_INVALID", "modelAssumptions.scenarios.%s" % name, "scenario must be an object"):
            _check_scenario(pre, str(name), scenario)

    base = _text(assumptions.get("baseScenario") or "base")
    pre.require(base in scenarios, "BASE_SCENARIO_MISSING", "modelAssumptions.baseScenario", "baseScenario must name a supplied scenario")
    pre.warn(isinstance(assumptions.get("sources"), list) and bool(assumptions.get("sources")), "ASSUMPTIONS_WITHOUT_SOURCES", "modelAssumptions.sources", "add sources[] naming the owner and date of each driver")
    as_of = assumptions.get("asOf")
    if as_of is not None:
        pre.require(_date(as_of) is not None, "INVALID_DATE", "modelAssumptions.asOf", "asOf must be a valid date")


def _result(pre: Preflight, ticker: str) -> Dict[str, Any]:
    errors = [finding for finding in pre.findings if finding["severity"] == "error"]
    warnings = [finding for finding in pre.findings if finding["severity"] == "warning"]
    return {
        "ready": len(errors) == 0,
        "findings": pre.findings,
        "summary": {
            "ticker": ticker,
            "asOf": pre.reference.isoformat(),
            "checks": pre.checks,
            "errors": len(errors),
            "warnings": len(warnings),
            "ready": len(errors) == 0,
        },
    }


def main(inputs: Any) -> Dict[str, Any]:
    """LoomLoom Code node entrypoint."""
    if not isinstance(inputs, dict):
        inputs = {}
    raw_as_of = _text(inputs.get("asOf"))
    reference = _date(raw_as_of)
    assumptions: Dict[str, Any] = {}
    try:
        assumptions = _parse_json(inputs.get("assumptions"), "modelAssumptions")
    except ValueError:
        assumptions = {}
    if reference is None:
        reference = _date(assumptions.get("asOf")) or datetime.date.today()
    pre = Preflight(reference)

    try:
        packets = _parse_json(inputs.get("tickerPacket"), "tickerPacket")
    except ValueError as exc:
        pre.add("PACKET_NOT_JSON", "error", "tickerPacket", str(exc))
        return _result(pre, "")
    if not pre.require(bool(packets), "PACKET_EMPTY", "tickerPacket", "tickerPacket must contain identityPacket, financialPacket and qualitativePacket"):
        return _result(pre, "")

    identity = _obj(packets.get("identityPacket"))
    financial = _obj(packets.get("financialPacket"))
    qualitative = _obj(packets.get("qualitativePacket"))
    if not pre.require(bool(identity) and bool(financial) and bool(qualitative), "PACKETS_INCOMPLETE", "tickerPacket", "all three packets are required"):
        return _result(pre, _text(identity.get("ticker")).upper())

    ticker = _check_identity(pre, identity)
    _check_financial(pre, financial)
    _check_qualitative(pre, qualitative)

    if not assumptions:
        pre.add("ASSUMPTIONS_NOT_JSON", "error", "modelAssumptions", "modelAssumptions must be a JSON object")
    else:
        _check_assumptions(pre, assumptions)

    if raw_as_of and _date(raw_as_of) is None:
        pre.add("INVALID_AS_OF", "error", "asOf", "asOf must be a valid YYYY-MM-DD date")

    return _result(pre, ticker)


if __name__ == "__main__":
    import sys

    payload = json.load(sys.stdin)
    json.dump(main(payload), sys.stdout, ensure_ascii=False)
