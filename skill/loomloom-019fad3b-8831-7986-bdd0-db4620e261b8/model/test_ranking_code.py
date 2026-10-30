#!/usr/bin/env python3
"""Tests for deterministic cloud ranking."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ranking_code


def rows():
    return [
        {"ticker": "AAPL", "score": 86, "decision": "watchlist", "price": 220.5, "modelValue": 122.81, "mos": -0.7954, "evidenceVerified": 35, "evidenceRejected": 3},
        {"ticker": "NVDA", "score": 82, "decision": "watchlist", "price": 212.21, "modelValue": 136.64, "mos": -0.5531, "evidenceVerified": 35, "evidenceRejected": 3},
        {"ticker": "ORCL", "score": 70, "decision": "watchlist", "price": 125.54, "modelValue": -34.73, "mos": None, "evidenceVerified": 42, "evidenceRejected": 4, "veto": ["excessive_rejected_evidence"]},
    ]


class RankingTest(unittest.TestCase):
    def test_scores_sort_and_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            old = os.getcwd()
            os.chdir(directory)
            try:
                result = ranking_code.main({"rankRows": json.dumps(rows()), "topN": 2})
                self.assertEqual([row["ticker"] for row in result["ranking"]["rows"]], ["AAPL", "NVDA", "ORCL"])
                self.assertEqual(result["ranking"]["summary"]["topN"], 2)
                self.assertEqual(result["ranking"]["summary"]["vetoed"], 1)
                self.assertEqual(result["ranking"]["summary"]["negativeModelValue"], 1)
                self.assertTrue(os.path.exists(result["report"]))
            finally:
                os.chdir(old)

    def test_invalid_rows_are_excluded(self):
        data = rows() + [{"ticker": "", "score": 99}, {"ticker": "BAD", "score": 101}]
        with tempfile.TemporaryDirectory() as directory:
            old = os.getcwd()
            os.chdir(directory)
            try:
                result = ranking_code.main({"rankRows": json.dumps(data), "topN": 1})
                self.assertEqual(result["ranking"]["summary"]["validRows"], 3)
                self.assertEqual(result["ranking"]["summary"]["invalidRows"], 2)
                self.assertEqual(len(result["ranking"]["rows"]), 3)
            finally:
                os.chdir(old)

    def test_extracts_compact_rows_from_result_rows(self):
        payload = {"rows": [{"values": [
            {"stepId": "stp_audit1", "portId": "audit", "value": {"ticker": "NVDA", "overall_score": 82, "decision": "watchlist", "confidence": "medium", "accepted": True, "audit_status": "warn", "evidence": {"verified": 35, "rejected": 3}, "findings": [], "veto_items": [], "model": {"valuePerShare": 136.64, "marginOfSafetyPct": -0.5531}}},
            {"stepId": "stp_audit1", "portId": "model", "value": {"ticker": "NVDA", "companyName": "NVIDIA", "price": 212.21}},
        ]}]}
        with tempfile.TemporaryDirectory() as directory:
            old = os.getcwd()
            os.chdir(directory)
            try:
                result = ranking_code.main({"resultRows": json.dumps(payload), "topN": 3})
                self.assertEqual(result["ranking"]["rows"][0]["ticker"], "NVDA")
                self.assertEqual(result["ranking"]["rows"][0]["evidenceVerified"], 35)
                self.assertEqual(result["ranking"]["rows"][0]["modelValue"], 136.64)
            finally:
                os.chdir(old)

    def test_top_n_is_clamped(self):
        with tempfile.TemporaryDirectory() as directory:
            old = os.getcwd()
            os.chdir(directory)
            try:
                result = ranking_code.main({"rankRows": json.dumps(rows()), "topN": 999})
                self.assertEqual(result["ranking"]["summary"]["topN"], 100)
            finally:
                os.chdir(old)


if __name__ == "__main__":
    unittest.main()
