#!/usr/bin/env python3
"""Tests for the retry-loop judge."""

from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import review_check_code


def packet():
    return {
        "financialPacket": {"marketSnapshot": {"price": 100.0}},
        "qualitativePacket": {"businessModel": [{"fact": "x"}]},
    }


def review(dimension, ref="financialPacket.marketSnapshot.price", value=100.0):
    scores = {
        "business": {"business_model_score": 80, "understandability_score": 80},
        "moat": {"moat_score": 80, "management_culture_score": 80, "capital_allocation_score": 80},
        "financial": {"financial_quality_score": 80, "cash_flow_quality_score": 80, "balance_sheet_score": 80},
        "valuation": {"valuation_score": 80, "margin_of_safety_score": 80},
    }[dimension]
    return json.dumps({
        "dimension": dimension,
        **scores,
        "evidence_records": [{"claim": "price", "source_ref": ref, "source_value": value, "period": "2026-10-22", "unit": "USD"}],
    })


def inputs(financial=None, round_number="0"):
    return {
        "tickerPacket": json.dumps(packet()),
        "business": review("business"),
        "management": review("moat"),
        "financial": financial or review("financial"),
        "valuation": review("valuation"),
        "round": round_number,
    }


class JudgeTest(unittest.TestCase):
    def test_valid_round_is_accepted(self):
        result = review_check_code.main(inputs())
        self.assertEqual(result["action"], "accept")
        self.assertEqual(result["feedback"], "ok")

    def test_invalid_round_retries_then_accepts(self):
        bad = review("financial", ref="financialPacket.marketSnapshot.price", value=999.0)
        first = review_check_code.main(inputs(financial=bad, round_number="0"))
        self.assertEqual(first["action"], "continue")
        self.assertIn("financial", first["feedback"])
        second = review_check_code.main(inputs(financial=bad, round_number="1"))
        self.assertEqual(second["action"], "accept")

    def test_reviews_are_reexported(self):
        result = review_check_code.main(inputs())
        for key in ("business", "management", "financial", "valuation"):
            self.assertIn('"dimension"', result[key])


if __name__ == "__main__":
    unittest.main()
