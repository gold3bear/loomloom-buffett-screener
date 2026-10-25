#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Judge one round of the four reviews inside a Loop.

The body produces four review JSON strings. This Code node checks structure and
evidence resolvability. On the first failed round it returns `continue`; on the
final allowed round it accepts the candidate so the outer audit can reject it
explicitly instead of publishing nothing.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any, Dict, List, Optional, Tuple

DIMENSIONS = ("business", "moat", "financial", "valuation")
INPUT_KEYS = {"business": "business", "moat": "management", "financial": "financial", "valuation": "valuation"}
PACKET_PREFIX = {"business": "qualitativePacket", "moat": "qualitativePacket", "financial": "financialPacket", "valuation": "financialPacket"}
PACKET_PREFIXES = ("identityPacket", "financialPacket", "qualitativePacket")
SCORE_FIELDS = {
    "business": ("business_model_score", "understandability_score"),
    "moat": ("moat_score", "management_culture_score", "capital_allocation_score"),
    "financial": ("financial_quality_score", "cash_flow_quality_score", "balance_sheet_score"),
    "valuation": ("valuation_score", "margin_of_safety_score"),
}


def _obj(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _text(value: Any) -> str:
    return str(value if value is not None else "").strip()


def _num(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _atomic(value: Any) -> bool:
    return value is None or isinstance(value, (str, int, float, bool))


def _same(left: Any, right: Any) -> bool:
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return math.isclose(float(left), float(right), rel_tol=1e-6, abs_tol=1e-6)
    return json.dumps(left, sort_keys=True, ensure_ascii=False) == json.dumps(right, sort_keys=True, ensure_ascii=False)


def _parse(value: Any, label: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
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
            if not part.isdigit() or int(part) >= len(value):
                return None
            value = value[int(part)]
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
    if str(ref).split(".")[0] in PACKET_PREFIXES:
        return _get(packet, ref)
    preferred = PACKET_PREFIX.get(dimension)
    order = ([preferred] if preferred else []) + [item for item in PACKET_PREFIXES if item != preferred]
    for prefix in order:
        value = _get(packet, "%s.%s" % (prefix, ref))
        if value is not None:
            return value
    return None


def _check_review(dimension: str, review: Dict[str, Any], packet: Dict[str, Any]) -> Tuple[bool, List[str]]:
    errors: List[str] = []
    if _text(review.get("dimension")).lower() != dimension:
        errors.append("dimension field must be %s" % dimension)
    for field in SCORE_FIELDS[dimension]:
        value = _num(review.get(field))
        if value is None or value != int(value) or value < 0 or value > 100:
            errors.append("%s must be 0-100" % field)
    records = review.get("evidence_records") if isinstance(review.get("evidence_records"), list) else []
    valid = 0
    for index, item in enumerate(records):
        if not isinstance(item, dict):
            continue
        ref = _text(item.get("source_ref"))
        value = item.get("source_value")
        if not ref or value is None or not _text(item.get("claim")):
            continue
        resolved = _resolve(packet, ref, dimension)
        if resolved is None or not _atomic(resolved) or not _atomic(value) or not _same(resolved, value):
            continue
        valid += 1
    if valid == 0:
        errors.append("no verified evidence")
    return (not errors), errors


def main(inputs: Any) -> Dict[str, Any]:
    if not isinstance(inputs, dict):
        inputs = {}
    packet, error = _parse(inputs.get("tickerPacket"), "tickerPacket")
    packet = packet or {}
    round_number = int(_num(inputs.get("round")) or 0)
    errors: List[str] = []
    if error:
        errors.append(error)
    for dimension in DIMENSIONS:
        key = INPUT_KEYS[dimension]
        review, parse_error = _parse(inputs.get(key), key)
        if parse_error:
            errors.append(parse_error)
            continue
        ok, review_errors = _check_review(dimension, review or {}, packet)
        if not ok:
            errors.extend("%s: %s" % (dimension, item) for item in review_errors)
    # First failed round gets one retry; the final round accepts so the outer
    # audit can reject the candidate with explicit findings.
    action = "accept" if not errors else ("continue" if round_number < 1 else "accept")
    feedback = "ok" if not errors else "; ".join(errors[:12])
    # Re-export the round's review texts through Code ports. This lets the outer
    # audit consume plain Code strings instead of traversing Loop model outputs.
    return {
        "action": action,
        "feedback": feedback,
        "round": str(round_number + 1),
        "business": _text(inputs.get("business")),
        "management": _text(inputs.get("management")),
        "financial": _text(inputs.get("financial")),
        "valuation": _text(inputs.get("valuation")),
    }
