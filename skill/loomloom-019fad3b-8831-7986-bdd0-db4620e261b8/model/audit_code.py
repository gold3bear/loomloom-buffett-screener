#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Cloud audit Code node for the LoomLoom v4 template.

Runs after the four reviews and the model. It absorbs the local evidence audit,
narrative checks, scoring/decision logic and model self-checks so that a Market
run can return an accepted/rejected result without a local Node process.

It never rewrites numbers. Invalid evidence, unresolved refs, array/object
refs, narrative contradictions and failed model checks become findings.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any, Dict, List, Optional, Tuple

DIMENSIONS = ("business", "moat", "financial", "valuation")
WEIGHTS = {
    "understandability": 0.10,
    "business_model": 0.20,
    "moat": 0.20,
    "management_capital_allocation": 0.15,
    "financial_quality": 0.20,
    "valuation_opportunity_cost": 0.15,
}
DEEP_RESEARCH_THRESHOLD = 75
WATCHLIST_THRESHOLD = 60
WEAK_SCORE_THRESHOLD = 30
HIGH_CONFIDENCE_MIN_EVIDENCE = 8
HIGH_CONFIDENCE_MAX_UNKNOWNS = 3
EXCESSIVE_REJECTED_EVIDENCE_MIN = 8
MODEL_CONTRADICTION_MOS = -0.5

PACKET_PREFIX = {
    "business": "qualitativePacket",
    "moat": "qualitativePacket",
    "financial": "financialPacket",
    "valuation": "financialPacket",
}
PACKET_PREFIXES = ("identityPacket", "financialPacket", "qualitativePacket")


def _issue(code: str, severity: str, path: str, message: str) -> Dict[str, str]:
    return {"code": code, "severity": severity, "path": path, "message": message}


def _obj(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _text(value: Any) -> str:
    return str(value if value is not None else "").strip()


def _num(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    try:
        return float(_text(value).replace(",", "").replace("$", ""))
    except ValueError:
        return None


def _atomic(value: Any) -> bool:
    return value is None or isinstance(value, (str, int, float, bool))


def _same(left: Any, right: Any) -> bool:
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return math.isclose(float(left), float(right), rel_tol=1e-6, abs_tol=1e-6)
    return json.dumps(left, sort_keys=True, ensure_ascii=False) == json.dumps(right, sort_keys=True, ensure_ascii=False)


def _parse_json(value: Any, label: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if isinstance(value, dict):
        return value, None
    raw = _text(value)
    if not raw:
        return None, "%s is empty" % label
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, re.S | re.I)
    if fenced:
        raw = fenced.group(1)
    else:
        start, end = raw.find("{"), raw.rfind("}")
        if start >= 0 and end > start:
            raw = raw[start : end + 1]
    try:
        parsed = json.loads(raw)
    except ValueError as exc:
        return None, "%s is not valid JSON: %s" % (label, exc)
    if not isinstance(parsed, dict):
        return None, "%s must be a JSON object" % label
    return parsed, None


def _parts(path: str) -> List[str]:
    return [part for part in re.sub(r"\[(\d+)\]", r".\1", str(path)).split(".") if part]


def _get(root: Any, path: str) -> Any:
    value = root
    for part in _parts(path):
        if isinstance(value, list):
            if not part.isdigit():
                return None
            index = int(part)
            if index >= len(value):
                return None
            value = value[index]
        elif isinstance(value, dict):
            if part not in value:
                return None
            value = value[part]
        else:
            return None
    return value


def _resolve(packet: Dict[str, Any], ref: str, dimension: str) -> Any:
    if not ref or str(ref).startswith("tickerPacket."):
        return None
    if ref.split(".")[0] in PACKET_PREFIXES:
        return _get(packet, ref)
    preferred = PACKET_PREFIX.get(dimension)
    order = ([preferred] if preferred else []) + [p for p in PACKET_PREFIXES if p != preferred]
    for prefix in order:
        value = _get(packet, "%s.%s" % (prefix, ref))
        if value is not None:
            return value
    return None


def _score(value: Any, label: str, findings: List[Dict[str, str]]) -> int:
    number = _num(value)
    if number is None or number != int(number) or number < 0 or number > 100:
        findings.append(_issue("SCORE_INVALID", "error", label, "score must be an integer between 0 and 100"))
        return 0
    return int(number)


def _pct(value: float) -> str:
    return "%.1f%%" % (value * 100.0)


def _narrative(reviews: Dict[str, Dict[str, Any]], packet: Dict[str, Any]) -> List[Dict[str, str]]:
    findings: List[Dict[str, str]] = []
    financial = _obj(packet.get("financialPacket"))
    market = _obj(financial.get("marketSnapshot"))
    balance = _obj(financial.get("balanceSheet"))
    annual = _obj(financial.get("annualHistory"))
    recent = _obj(financial.get("quarterlyMostRecent"))
    ttm = _obj(recent.get("ttm"))
    shares = _num(market.get("sharesOutstanding")) or _num(balance.get("sharesOutstanding"))
    price = _num(market.get("price"))
    cash, debt = _num(balance.get("cash")), _num(balance.get("totalDebt"))
    if debt is None:
        debt = (_num(balance.get("shortTermDebt")) or 0.0) + (_num(balance.get("longTermDebt")) or 0.0)
    annual_fcf = _num((annual.get("freeCashFlow") or [None])[-1]) if annual.get("freeCashFlow") else None
    annual_ni = _num((annual.get("netIncome") or [None])[-1]) if annual.get("netIncome") else None
    ttm_fcf, ttm_ni = _num(ttm.get("fcf")), _num(ttm.get("netIncome"))
    pe = _num(market.get("pe"))
    net_cash = cash - debt if cash is not None and debt is not None else None

    def ratio(text: str) -> Optional[float]:
        if re.search(r"fy\s*2026|fiscal\s*(?:year\s*)?2026|10-k", text, re.I):
            return annual_fcf / annual_ni if annual_fcf is not None and annual_ni else None
        return ttm_fcf / ttm_ni if ttm_fcf is not None and ttm_ni else None

    def walk(value: Any, path: str) -> None:
        if isinstance(value, str) and value.strip():
            text = value
            current = ratio(text)
            num = r"([0-9][0-9,]*(?:\.[0-9]+)?)"
            for match in re.finditer(r"fcf\s*/\s*ni\s*(?:=|is|of|at|:)?\s*" + num + r"\s*%", text, re.I):
                stated = float(match.group(1).replace(",", "")) / 100.0
                if current is not None and abs(stated - current) > 0.06:
                    findings.append(_issue("NARRATIVE_FCF_NI_CONFLICT", "warning", path, "stated FCF/NI %s but packet implies %s" % (_pct(stated), _pct(current))))
            for match in re.finditer(r"fcf\s*/\s*ni\s*(?:=|is|of|at|:)?\s*" + num + r"\s*(?:x|times)", text, re.I):
                stated = float(match.group(1).replace(",", ""))
                if current is not None and abs(stated - current) > 0.12:
                    findings.append(_issue("NARRATIVE_FCF_NI_CONFLICT", "warning", path, "stated FCF/NI %.2fx but packet implies %.2fx" % (stated, current)))
            for match in re.finditer(r"(?:free cash flow|fcf)[^.]{0,80}?" + num + r"\s*(?:x|times)\s*(?:net income|ni)", text, re.I):
                stated = float(match.group(1).replace(",", ""))
                if current is not None and abs(stated - current) > 0.12:
                    findings.append(_issue("NARRATIVE_FCF_NI_CONFLICT", "warning", path, "stated FCF %.2fx net income but packet implies %.2fx" % (stated, current)))
            for match in re.finditer(r"(?:free cash flow|fcf)[^.]{0,100}?\b(exceeds|exceeded|above|greater than|below|less than|under)\b[^.]{0,60}?(?:net income|ni)", text, re.I):
                if current is None:
                    continue
                above = bool(re.search(r"exceed|above|greater", match.group(1), re.I))
                if (above and current < 1.0) or ((not above) and current > 1.0):
                    findings.append(_issue("NARRATIVE_FCF_NI_CONFLICT", "warning", path, "FCF direction contradicts packet ratio %.2fx" % current))
            if shares:
                for match in re.finditer(r"shares outstanding[^.]{0,50}?" + num + r"\s*(billion|b|million|m)", text, re.I):
                    stated = float(match.group(1).replace(",", "")) * (1000.0 if match.group(2).lower() in ("b", "billion") else 1.0)
                    if abs(stated - shares) / max(1.0, shares) > 0.06:
                        findings.append(_issue("NARRATIVE_SHARES_CONFLICT", "warning", path, "stated %.0fM shares but packet has %.0fM" % (stated, shares)))
            if pe:
                for match in re.finditer(r"p/e[^.]{0,30}?" + num + r"\s*x", text, re.I):
                    stated = float(match.group(1).replace(",", ""))
                    if abs(stated - pe) / max(1.0, pe) > 0.10:
                        findings.append(_issue("NARRATIVE_PE_CONFLICT", "warning", path, "stated P/E %.1fx but packet has %.1fx" % (stated, pe)))
            if net_cash is not None:
                for match in re.finditer(r"net cash[^.]{0,50}?\$?\s*(-|−)?" + num + r"\s*(billion|b|million|m)", text, re.I):
                    sign = -1.0 if match.group(1) else 1.0
                    stated = sign * float(match.group(2).replace(",", "")) * (1000.0 if match.group(3).lower() in ("b", "billion") else 1.0)
                    if net_cash < 0 and stated >= 0:
                        findings.append(_issue("NARRATIVE_NET_CASH_CONFLICT", "warning", path, "text says net cash %.0fM but packet has net debt %.0fM" % (stated, abs(net_cash))))
                    elif abs(stated - net_cash) / max(1.0, abs(net_cash)) > 0.08:
                        findings.append(_issue("NARRATIVE_NET_CASH_CONFLICT", "warning", path, "stated net cash %.0fM but packet has %.0fM" % (stated, net_cash)))
        elif isinstance(value, list):
            for index, item in enumerate(value):
                walk(item, "%s[%d]" % (path, index))
        elif isinstance(value, dict):
            for key, item in value.items():
                if key not in ("evidence_records", "falsification_conditions"):
                    walk(item, "%s.%s" % (path, key))

    for dimension, review in reviews.items():
        walk(review, "reviews.%s" % dimension)
    return findings


def _audit_evidence(reviews: Dict[str, Dict[str, Any]], packet: Dict[str, Any], findings: List[Dict[str, str]]) -> Dict[str, Any]:
    verified: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []
    by_dimension = {dimension: 0 for dimension in DIMENSIONS}
    for dimension, review in reviews.items():
        records = review.get("evidence_records") if isinstance(review.get("evidence_records"), list) else []
        for index, item in enumerate(records):
            path = "%s.evidence_records[%d]" % (dimension, index)
            if not isinstance(item, dict):
                rejected.append({"dimension": dimension, "path": path, "reason": "not an object"})
                continue
            ref = item.get("source_ref")
            value = item.get("source_value")
            if not _text(item.get("claim")) or not _text(ref) or value is None or not _text(item.get("period")) or not _text(item.get("unit")):
                findings.append(_issue("EVIDENCE_QUARANTINED", "warning", path, "evidence fields incomplete; entry dropped, not used"))
                rejected.append({"dimension": dimension, "path": path, "reason": "evidence fields incomplete"})
                continue
            if not _atomic(value):
                findings.append(_issue("EVIDENCE_QUARANTINED", "warning", path, "source_value is not atomic; entry dropped"))
                rejected.append({"dimension": dimension, "path": path, "reason": "source_value must be atomic"})
                continue
            resolved = _resolve(packet, _text(ref), dimension)
            if resolved is None:
                findings.append(_issue("EVIDENCE_QUARANTINED", "warning", path, "source_ref cannot be resolved (%s); entry dropped" % ref))
                rejected.append({"dimension": dimension, "path": path, "reason": "unresolved source_ref"})
                continue
            if not _atomic(resolved):
                findings.append(_issue("EVIDENCE_QUARANTINED", "warning", path, "source_ref is not an atomic leaf; entry dropped"))
                rejected.append({"dimension": dimension, "path": path, "reason": "non-atomic source_ref"})
                continue
            if not _same(resolved, value):
                findings.append(_issue("EVIDENCE_QUARANTINED", "warning", path, "source_value does not match the packet at %s; entry dropped" % ref))
                rejected.append({"dimension": dimension, "path": path, "reason": "source_value mismatch"})
                continue
            key = (dimension, _text(ref), json.dumps(value, sort_keys=True))
            if any((entry["dimension"], entry["source_ref"], json.dumps(entry["source_value"], sort_keys=True)) == key for entry in verified):
                continue
            verified.append({"dimension": dimension, "source_ref": _text(ref), "source_value": value})
            by_dimension[dimension] += 1
    for dimension in DIMENSIONS:
        if by_dimension.get(dimension, 0) == 0:
            findings.append(_issue("NO_VERIFIED_EVIDENCE_%s" % dimension.upper(), "error", dimension, "no verified evidence remains after quarantine"))
    return {"verified": verified, "rejected": rejected, "byDimension": by_dimension}


def _audit_trace_records(reviews: Dict[str, Dict[str, Any]], packet: Dict[str, Any], findings: List[Dict[str, str]]) -> None:
    """Validity/falsification refs must be atomic leaves too."""
    for dimension, review in reviews.items():
        for label in ("validity_basis", "falsification_conditions"):
            records = review.get(label) if isinstance(review.get(label), list) else []
            for index, item in enumerate(records):
                path = "%s.%s[%d]" % (dimension, label, index)
                if not isinstance(item, dict):
                    findings.append(_issue("TRACE_QUARANTINED", "warning", path, "record must be an object; dropped"))
                    continue
                if not _text(item.get("source_ref")) or item.get("source_value") is None:
                    findings.append(_issue("TRACE_QUARANTINED", "warning", path, "source_ref/source_value missing; dropped"))
                    continue
                resolved = _resolve(packet, _text(item.get("source_ref")), dimension)
                if resolved is None:
                    findings.append(_issue("TRACE_QUARANTINED", "warning", path, "source_ref cannot be resolved; dropped: %s" % item.get("source_ref")))
                elif not _atomic(resolved):
                    findings.append(_issue("TRACE_QUARANTINED", "warning", path, "source_ref is not an atomic leaf; dropped"))
                elif not _same(resolved, item.get("source_value")):
                    findings.append(_issue("TRACE_QUARANTINED", "warning", path, "source_value mismatch; dropped"))
                if label == "falsification_conditions" and not _text(item.get("action")):
                    findings.append(_issue("TRACE_QUARANTINED", "warning", path, "falsification action missing; dropped"))


def _artifact_path(value: Any) -> Optional[str]:
    if isinstance(value, str):
        return value
    if isinstance(value, list) and value:
        return _artifact_path(value[0])
    if isinstance(value, dict):
        for key in ("path", "file", "filePath", "filename"):
            if isinstance(value.get(key), str):
                return value[key]
    return None


def _audit_workbook(workbook: Any, findings: List[Dict[str, str]]) -> Dict[str, Any]:
    """Structural check of the xlsx artifact (sheet names/count), not cell values."""
    import zipfile

    path = _artifact_path(workbook)
    if not path:
        return {"present": False}
    try:
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            if "xl/workbook.xml" not in names:
                findings.append(_issue("WORKBOOK_INVALID", "error", "workbook", "xl/workbook.xml is missing"))
                return {"present": True, "sheets": 0}
            workbook_xml = archive.read("xl/workbook.xml").decode("utf-8", "replace")
    except Exception as exc:
        findings.append(_issue("WORKBOOK_INVALID", "error", "workbook", "cannot open workbook: %s" % exc))
        return {"present": True, "sheets": 0}
    sheets = re.findall(r'<sheet[^>]+name="([^"]+)"', workbook_xml)
    required = ("Cover", "Assumptions", "Historical", "Sensitivity", "Checks")
    missing = [name for name in required if name not in sheets]
    if missing:
        findings.append(_issue("WORKBOOK_SHEETS_MISSING", "error", "workbook", "missing sheets: %s" % ", ".join(missing)))
    if len(sheets) < 15:
        findings.append(_issue("WORKBOOK_TOO_FEW_SHEETS", "warning", "workbook", "only %d sheets; expected at least 15" % len(sheets)))
    return {"present": True, "sheets": len(sheets), "names": sheets[:40]}


def _model_audit(model: Dict[str, Any], packet: Dict[str, Any], findings: List[Dict[str, str]]) -> Dict[str, Any]:
    if not model:
        findings.append(_issue("MODEL_MISSING", "error", "model", "cloud model is required"))
        return {"verdict": "model_missing"}
    market = _obj(_obj(packet.get("financialPacket")).get("marketSnapshot"))
    if not model.get("model_ready"):
        findings.append(_issue("MODEL_NOT_READY", "error", "model", "model_ready is false"))
    for check in (model.get("modelChecks") or []):
        if isinstance(check, dict) and check.get("severity") == "error" and not check.get("passed"):
            findings.append(_issue("MODEL_CHECK_FAILED", "error", "model", "model check failed: %s" % check.get("name")))
    scenarios = _obj(model.get("scenarios"))
    for name, result in scenarios.items():
        for check in (result.get("checks") or []):
            if isinstance(check, dict) and check.get("severity") == "error" and not check.get("passed"):
                findings.append(_issue("MODEL_CHECK_FAILED", "error", "scenarios.%s" % name, "scenario check failed: %s" % check.get("name")))
    if _text(model.get("ticker")).upper() != _text(_obj(packet.get("identityPacket")).get("ticker")).upper():
        findings.append(_issue("MODEL_TICKER_MISMATCH", "error", "model.ticker", "model ticker does not match packet"))
    if _num(model.get("price")) is not None and _num(market.get("price")) is not None and not _same(model.get("price"), market.get("price")):
        findings.append(_issue("MODEL_PRICE_MISMATCH", "error", "model.price", "model price does not match packet"))
    base = _obj(scenarios.get(model.get("baseScenario") or "base"))
    summary = _obj(base.get("summary"))
    value = _num(summary.get("valuePerShare"))
    if value is not None and value <= 0:
        findings.append(_issue("MODEL_VALUE_NON_POSITIVE", "warning", "scenarios.base.summary.valuePerShare", "model value is non-positive; MOS is intentionally null"))
    mos = _num(summary.get("marginOfSafetyPct"))
    verdict = "model_incomplete" if mos is None else ("margin_of_safety_present" if mos >= 0.3 else "at_or_near_model_value" if mos >= 0 else "price_above_model_value")
    return {"verdict": verdict, "valuePerShare": value, "marginOfSafetyPct": mos, "terminalPctOfEv": _num(summary.get("terminalPctOfEv"))}


def _score_reviews(reviews: Dict[str, Dict[str, Any]], evidence: Dict[str, Any], model_audit: Dict[str, Any], findings: List[Dict[str, str]]) -> Dict[str, Any]:
    biz, moat, fin, val = reviews["business"], reviews["moat"], reviews["financial"], reviews["valuation"]
    components = {
        "understandability": _score(biz.get("understandability_score"), "business.understandability_score", findings),
        "business_model": _score(biz.get("business_model_score"), "business.business_model_score", findings),
        "moat": _score(moat.get("moat_score"), "moat.moat_score", findings),
        "management_capital_allocation": round((_score(moat.get("management_culture_score"), "moat.management_culture_score", findings) + _score(moat.get("capital_allocation_score"), "moat.capital_allocation_score", findings)) / 2),
        "financial_quality": _score(fin.get("financial_quality_score"), "financial.financial_quality_score", findings),
        "valuation_opportunity_cost": round((_score(val.get("valuation_score"), "valuation.valuation_score", findings) + _score(val.get("margin_of_safety_score"), "valuation.margin_of_safety_score", findings)) / 2),
    }
    veto: List[str] = []
    if biz.get("circle_of_competence") == "fail":
        veto.append("circle_of_competence_fail")
    for dimension in DIMENSIONS:
        if evidence["byDimension"].get(dimension, 0) == 0:
            veto.append("missing_verified_evidence_%s" % dimension)
    if (fin.get("survival_risks") or []) and _num(fin.get("balance_sheet_score")) is not None and float(fin["balance_sheet_score"]) < WEAK_SCORE_THRESHOLD:
        veto.append("survival_risk_with_weak_balance_sheet")
    if (moat.get("governance_red_flags") or []) and components["management_capital_allocation"] < WEAK_SCORE_THRESHOLD:
        veto.append("governance_red_flags_with_weak_management_score")
    if (fin.get("accounting_red_flags") or []) and components["financial_quality"] < WEAK_SCORE_THRESHOLD:
        veto.append("accounting_red_flags_with_weak_financial_score")
    if _num(val.get("margin_of_safety_score")) is not None and float(val["margin_of_safety_score"]) < WEAK_SCORE_THRESHOLD:
        veto.append("insufficient_margin_of_safety")
    if val.get("judgment_state") == "evidence_insufficient":
        veto.append("evidence_insufficient_for_valuation_anchor")
    if val.get("judgment_state") == "insufficient_margin_of_safety":
        veto.append("insufficient_margin_of_safety_verdict")
    total_evidence = len(evidence["verified"]) + len(evidence["rejected"])
    rejection_threshold = max(EXCESSIVE_REJECTED_EVIDENCE_MIN, int(math.ceil(total_evidence * 0.25)))
    if len(evidence["rejected"]) >= rejection_threshold:
        veto.append("excessive_rejected_evidence")
    if model_audit.get("verdict") == "model_incomplete":
        pass  # warning already emitted; a negative model is not a veto.
    overall = round(sum(components[key] * WEIGHTS[key] for key in WEIGHTS))
    unknowns = []
    for dimension in DIMENSIONS:
        for item in (reviews[dimension].get("unknowns") or []):
            text = _text(item)
            if text:
                unknowns.append(text)
    unknowns = list(dict.fromkeys(unknowns))
    unique_veto = list(dict.fromkeys(veto))
    audit_status = "fail" if "excessive_rejected_evidence" in unique_veto else "vetoed" if unique_veto else "warn" if evidence["rejected"] or len(unknowns) > HIGH_CONFIDENCE_MAX_UNKNOWNS else "pass"
    confidence = "low" if unique_veto else "high" if len(evidence["verified"]) >= HIGH_CONFIDENCE_MIN_EVIDENCE and len(unknowns) <= HIGH_CONFIDENCE_MAX_UNKNOWNS else "medium"
    decision = "pass" if unique_veto else "watchlist" if val.get("judgment_state") == "evidence_thin" or biz.get("circle_of_competence") == "uncertain" else "deep_research" if overall >= DEEP_RESEARCH_THRESHOLD else "watchlist" if overall >= WATCHLIST_THRESHOLD else "pass"
    return {"components": components, "overall_score": overall, "veto_items": unique_veto, "audit_status": audit_status, "confidence": confidence, "decision": decision, "unknowns": unknowns}


def audit(inputs: Dict[str, Any]) -> Dict[str, Any]:
    findings: List[Dict[str, str]] = []
    packet, error = _parse_json(inputs.get("tickerPacket"), "tickerPacket")
    if error:
        return {"accepted": False, "findings": [_issue("PACKET_NOT_JSON", "error", "tickerPacket", error)], "audit": {}}
    packet = packet or {}
    reviews: Dict[str, Dict[str, Any]] = {}
    for dimension in DIMENSIONS:
        input_key = "management" if dimension == "moat" else dimension
        review, error = _parse_json(inputs.get(input_key), input_key)
        if error:
            findings.append(_issue("REVIEW_NOT_JSON", "error", dimension, error))
            reviews[dimension] = {}
        else:
            reviews[dimension] = review or {}
            if _text(review.get("dimension")) and _text(review.get("dimension")).lower() != dimension:
                findings.append(_issue("REVIEW_DIMENSION_MISMATCH", "error", dimension, "dimension field does not match %s" % dimension))
    evidence = _audit_evidence(reviews, packet, findings)
    _audit_trace_records(reviews, packet, findings)
    for dimension in DIMENSIONS:
        if not reviews[dimension]:
            findings.append(_issue("REVIEW_MISSING", "error", dimension, "review is missing or invalid"))
    model = inputs.get("model") if isinstance(inputs.get("model"), dict) else {}
    model_audit = _model_audit(model, packet, findings)
    workbook_audit = _audit_workbook(inputs.get("workbook"), findings)
    findings.extend(_narrative(reviews, packet))
    scores = _score_reviews(reviews, evidence, model_audit, findings)
    for veto in scores["veto_items"]:
        findings.append(_issue("VETO_%s" % veto.upper(), "error", "audit", "audit veto: %s" % veto))
    hard_errors = [item for item in findings if item["severity"] == "error"]
    accepted = not hard_errors and not scores["veto_items"]
    audit_doc = {
        "schemaVersion": "loomloom-cloud-audit/v1",
        "ticker": _text(_obj(packet.get("identityPacket")).get("ticker")).upper(),
        "accepted": accepted,
        "decision": scores["decision"],
        "overall_score": scores["overall_score"],
        "component_scores": scores["components"],
        "confidence": scores["confidence"],
        "audit_status": scores["audit_status"],
        "veto_items": scores["veto_items"],
        "unknowns": scores["unknowns"],
        "evidence": {"verified": len(evidence["verified"]), "rejected": len(evidence["rejected"]), "byDimension": evidence["byDimension"]},
        "rejected_evidence": evidence["rejected"],
        "narrative_findings": [item for item in findings if item["code"].startswith("NARRATIVE_")],
        "model": model_audit,
        "workbook": workbook_audit,
        "review_summaries": {dimension: _text(reviews[dimension].get("summary")) for dimension in DIMENSIONS},
        "findings": findings,
    }
    return {"accepted": accepted, "findings": findings, "audit": audit_doc, "model": model}


def main(inputs: Any) -> Dict[str, Any]:
    if not isinstance(inputs, dict):
        inputs = {}
    return audit(inputs)


if __name__ == "__main__":
    import sys

    print(json.dumps(main(json.load(sys.stdin)), ensure_ascii=False, indent=2))
