#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for the cloud audit/report Code nodes."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import audit_code  # noqa: E402
import report_code  # noqa: E402


def packet() -> dict:
    return {
        "identityPacket": {"ticker": "TEST", "companyName": "Test Co", "fiscalPeriod": "FY2026", "dataAsOf": "2026-10-23"},
        "financialPacket": {
            "marketSnapshot": {"price": 100, "currency": "USD", "asOf": "2026-10-22", "pe": 10, "sharesOutstanding": 100, "marketCapUsd": 10000},
            "annualHistory": {"fiscalYearEnd": ["2024-12-31", "2025-12-31", "2026-12-31"], "revenue": [800, 900, 1000], "netIncome": [70, 85, 100], "freeCashFlow": [50, 65, 80]},
            "quarterlyMostRecent": {"ttm": {"revenue": 1000, "netIncome": 100, "fcf": 80}},
            "balanceSheet": {"cash": 100, "totalDebt": 200, "equity": 300, "sharesOutstanding": 100},
        },
        "qualitativePacket": {
            "businessModel": [{"fact": "Sells software", "source": "https://example.com", "date": "2026-10-23", "sourceTier": "S"}],
            "moatEvidence": [{"fact": "High switching costs", "source": "https://example.com", "date": "2026-10-23", "sourceTier": "S"}],
            "managementCulture": [],
            "capitalAllocation": [],
            "riskFactors": [],
            "contraryEvidence": [],
            "unknowns": [],
        },
    }


def reviews() -> dict:
    return {
        "business": {"dimension": "business", "business_model_score": 80, "understandability_score": 80, "circle_of_competence": "pass", "summary": "Clear business", "positive_points": [], "contrary_points": [], "unknowns": [], "evidence_records": [{"claim": "ticker", "source_ref": "identityPacket.ticker", "source_value": "TEST", "period": "FY2026", "unit": "text"}]},
        "moat": {"dimension": "moat", "moat_score": 80, "management_culture_score": 80, "capital_allocation_score": 80, "summary": "Stable moat", "positive_points": [], "contrary_points": [], "governance_red_flags": [], "unknowns": [], "evidence_records": [{"claim": "fact", "source_ref": "qualitativePacket.businessModel[0].fact", "source_value": "Sells software", "period": "2026-10-23", "unit": "text"}]},
        "financial": {"dimension": "financial", "financial_quality_score": 80, "cash_flow_quality_score": 80, "balance_sheet_score": 80, "summary": "Healthy", "positive_points": [], "contrary_points": [], "accounting_red_flags": [], "survival_risks": [], "unknowns": [], "evidence_records": [{"claim": "price", "source_ref": "financialPacket.marketSnapshot.price", "source_value": 100, "period": "2026-10-22", "unit": "USD"}]},
        "valuation": {"dimension": "valuation", "valuation_score": 70, "margin_of_safety_score": 70, "judgment_state": "eligible_for_manual_deep_research", "summary": "Open to research", "positive_points": [], "contrary_points": [], "valuation_red_flags": [], "unknowns": [], "evidence_records": [{"claim": "pe", "source_ref": "financialPacket.marketSnapshot.pe", "source_value": 10, "period": "2026-10-22", "unit": "x"}]},
    }


def model() -> dict:
    return {
        "model_ready": True, "ticker": "TEST", "price": 100, "baseScenario": "base",
        "modelChecks": [{"name": "check", "severity": "error", "passed": True}],
        "scenarios": {"base": {"summary": {"valuePerShare": 120, "marginOfSafetyPct": 0.1667, "enterpriseValue": 12000, "equityValue": 11900, "netDebt": 100, "terminalPctOfEv": 0.5}, "checks": [{"name": "balance", "severity": "error", "passed": True}]}},
        "reverseDcf": {"impliedAverageRevenueGrowth": 0.05},
    }


def audit(review_data=None, model_data=None):
    return audit_code.audit({
        "tickerPacket": json.dumps(packet()), "business": json.dumps((review_data or reviews())["business"]),
        "management": json.dumps((review_data or reviews())["moat"]), "financial": json.dumps((review_data or reviews())["financial"]),
        "valuation": json.dumps((review_data or reviews())["valuation"]), "model": model_data if model_data is not None else model(),
    })


class AuditTests(unittest.TestCase):
    def test_valid_reviews_model_are_accepted(self):
        result = audit()
        self.assertTrue(result["accepted"], result["findings"])
        self.assertEqual(result["audit"]["evidence"]["verified"], 4)
        self.assertEqual(result["audit"]["ticker"], "TEST")
        self.assertIn(result["audit"]["decision"], ("deep_research", "watchlist"))

    def test_empty_array_reference_is_rejected(self):
        data = reviews()
        data["moat"]["evidence_records"][0]["source_ref"] = "qualitativePacket.unknowns[0]"
        result = audit(data)
        self.assertFalse(result["accepted"])
        self.assertTrue(any(item["code"] == "NO_VERIFIED_EVIDENCE_MOAT" for item in result["findings"]))

    def test_object_reference_is_rejected(self):
        data = reviews()
        data["moat"]["evidence_records"][0]["source_ref"] = "qualitativePacket.businessModel"
        data["moat"]["evidence_records"][0]["source_value"] = "Sells software"
        result = audit(data)
        self.assertFalse(result["accepted"])
        self.assertTrue(any(item["code"] == "NO_VERIFIED_EVIDENCE_MOAT" for item in result["findings"]))

    def test_array_falsification_reference_is_rejected(self):
        data = reviews()
        data["valuation"]["falsification_conditions"] = [{"condition": "x", "source_ref": "qualitativePacket.riskFactors", "source_value": "x", "action": "rerun_required"}]
        result = audit(data)
        self.assertFalse(result["accepted"])
        self.assertTrue(any(item["code"] == "TRACE_REF_NOT_ATOMIC" for item in result["findings"]))

    def test_bad_evidence_is_quarantined_when_a_valid_one_remains(self):
        data = reviews()
        data["moat"]["evidence_records"].append({"claim": "price", "source_ref": "financialPacket.marketSnapshot.price", "source_value": 100, "period": "2026-10-22", "unit": "USD"})
        data["moat"]["evidence_records"][0]["source_value"] = "wrong text"
        result = audit(data)
        self.assertTrue(result["accepted"], result["findings"])
        self.assertTrue(any(item["code"] == "EVIDENCE_QUARANTINED" for item in result["findings"]))
        self.assertGreaterEqual(result["audit"]["evidence"]["byDimension"]["moat"], 1)

    def test_narrative_conflict_is_a_warning(self):
        data = reviews()
        data["financial"]["summary"] = "FCF is 1.6x net income."
        result = audit(data)
        self.assertTrue(result["accepted"])
        self.assertTrue(any(item["code"] == "NARRATIVE_FCF_NI_CONFLICT" for item in result["findings"]))

    def test_non_ready_model_is_rejected(self):
        data = model()
        data["model_ready"] = False
        result = audit(model_data=data)
        self.assertFalse(result["accepted"])
        self.assertTrue(any(item["code"] == "MODEL_NOT_READY" for item in result["findings"]))


class ReportTests(unittest.TestCase):
    def test_report_writes_markdown_artifact(self):
        result = audit()
        with tempfile.TemporaryDirectory() as directory:
            previous = os.getcwd()
            os.chdir(directory)
            try:
                out = report_code.main({"tickerPacket": json.dumps(packet()), "audit": result["audit"], "model": model()})
                self.assertEqual(out["report"], "report.md")
                with open("report.md", encoding="utf-8") as handle:
                    text = handle.read()
                self.assertIn("# TEST | Cloud Research Report", text)
                self.assertIn("## Investment model", text)
                self.assertIn("## Evidence", text)
            finally:
                os.chdir(previous)


if __name__ == "__main__":
    unittest.main()
