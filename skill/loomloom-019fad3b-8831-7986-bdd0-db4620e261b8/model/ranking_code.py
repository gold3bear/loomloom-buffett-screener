#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deterministic cross-row ranking for v9 cloud audit rows.

Input is a JSON array of compact rows (or full audit objects). No network, no LLM.
"""

from __future__ import annotations

import json
import math
from typing import Any, Dict, List, Optional


def _num(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _text(value: Any) -> str:
    return str(value if value is not None else "").strip()


def _obj(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _first_number(*values: Any) -> Optional[float]:
    for value in values:
        number = _num(value)
        if number is not None:
            return number
    return None


def _normalise(raw: Any, index: int) -> Optional[Dict[str, Any]]:
    row = _obj(raw)
    audit = _obj(row.get("audit"))
    if audit:
        row = {**row, **audit}
    ticker = _text(row.get("ticker") or row.get("symbol")).upper()
    score = _first_number(row.get("score"), row.get("overall_score"), row.get("overallScore"))
    if not ticker or score is None or score < 0 or score > 100:
        return None
    evidence = _obj(row.get("evidence"))
    veto = row.get("veto") if isinstance(row.get("veto"), list) else row.get("veto_items")
    veto = veto if isinstance(veto, list) else []
    findings = row.get("findings") if isinstance(row.get("findings"), list) else []
    decision = _text(row.get("decision") or "unrated").lower()
    return {
        "index": index,
        "ticker": ticker,
        "companyName": _text(row.get("companyName") or row.get("company_name")),
        "score": round(score, 2),
        "decision": decision,
        "confidence": _text(row.get("confidence") or "unknown").lower(),
        "price": _first_number(row.get("price")),
        "modelValue": _first_number(row.get("modelValue"), row.get("valuePerShare"), row.get("model_value")),
        "mos": _first_number(row.get("mos"), row.get("marginOfSafetyPct"), row.get("margin_of_safety")),
        "evidenceVerified": int(_first_number(row.get("evidenceVerified"), evidence.get("verified")) or 0),
        "evidenceRejected": int(_first_number(row.get("evidenceRejected"), evidence.get("rejected")) or 0),
        "vetoed": bool(row.get("vetoed")) or bool(veto),
        "vetoItems": [str(item) for item in veto[:20]],
        "findingCodes": [str(_obj(item).get("code") or item) for item in findings[:20]],
    }


def _sort_key(row: Dict[str, Any]):
    mos = row["mos"]
    return (
        -row["score"],
        -(mos if mos is not None else -1e9),
        -row["evidenceVerified"],
        row["ticker"],
    )


def main(inputs: Any) -> Dict[str, Any]:
    if not isinstance(inputs, dict):
        inputs = {}
    raw = inputs.get("rankRows")
    if isinstance(raw, str):
        try:
            rows = json.loads(raw)
        except ValueError as exc:
            raise ValueError("rankRows is not valid JSON: %s" % exc)
    else:
        rows = raw
    if not isinstance(rows, list):
        raise ValueError("rankRows must be a JSON array")
    top_n = int(_num(inputs.get("topN")) or 20)
    top_n = max(1, min(100, top_n))
    normalised = [item for item in (_normalise(value, index) for index, value in enumerate(rows)) if item]
    normalised.sort(key=_sort_key)
    for rank, row in enumerate(normalised, start=1):
        row["rank"] = rank
    decisions: Dict[str, int] = {}
    for row in normalised:
        decisions[row["decision"]] = decisions.get(row["decision"], 0) + 1
    average = round(sum(row["score"] for row in normalised) / len(normalised), 2) if normalised else None
    summary = {
        "rows": len(rows),
        "validRows": len(normalised),
        "invalidRows": len(rows) - len(normalised),
        "topN": top_n,
        "decisions": decisions,
        "averageScore": average,
        "vetoed": sum(1 for row in normalised if row["vetoed"]),
        "negativeModelValue": sum(1 for row in normalised if row["modelValue"] is not None and row["modelValue"] <= 0),
    }
    top = normalised[:top_n]
    lines = [
        "# US Value Screen — Cloud Ranking",
        "",
        "> Deterministic cross-row ranking of v9 audit rows. Research aid only; not investment advice.",
        "",
        "## Summary",
        "",
        "- Rows: **%d** (%d valid, %d invalid)" % (summary["rows"], summary["validRows"], summary["invalidRows"]),
        "- Average score: **%s**" % ("—" if average is None else average),
        "- Vetoed: **%d**; non-positive model value: **%d**" % (summary["vetoed"], summary["negativeModelValue"]),
        "- Decisions: %s" % (", ".join("%s=%d" % item for item in sorted(decisions.items())) or "—"),
        "",
        "## Top %d" % top_n,
        "",
        "| # | Ticker | Score | Decision | Price | Model value | MOS | Evidence | Veto |",
        "|---:|---|---:|---|---:|---:|---:|---|---|",
    ]
    for row in top:
        mos = "—" if row["mos"] is None else "%.2f%%" % (row["mos"] * 100)
        model_value = "—" if row["modelValue"] is None else "%.2f" % row["modelValue"]
        price = "—" if row["price"] is None else "%.2f" % row["price"]
        lines.append("| %d | %s | %.2f | %s | %s | %s | %s | %d/%d | %s |" % (
            row["rank"], row["ticker"], row["score"], row["decision"], price, model_value, mos,
            row["evidenceVerified"], row["evidenceRejected"], "YES" if row["vetoed"] else "no",
        ))
    lines += ["", "> Ranking is by score, then MOS, then verified evidence. Vetoed rows remain visible; do not treat rank as a buy list.", ""]
    with open("ranking.md", "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))
    return {"ranking": {"summary": summary, "rows": normalised}, "report": "ranking.md"}
