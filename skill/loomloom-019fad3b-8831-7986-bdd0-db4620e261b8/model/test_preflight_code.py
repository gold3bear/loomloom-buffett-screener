#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for the cloud preflight Code node."""

from __future__ import annotations

import copy
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import preflight_code  # noqa: E402


def load(name):
    with open(os.path.join(HERE, "fixtures", name), "r", encoding="utf-8") as handle:
        return json.load(handle)


PACKETS = load("aapl-packets.json")
ASSUMPTIONS = load("aapl-assumptions.json")


def run(packets=None, assumptions=None, as_of="2026-09-02"):
    return preflight_code.main(
        {
            "tickerPacket": json.dumps(packets if packets is not None else PACKETS),
            "assumptions": json.dumps(assumptions if assumptions is not None else ASSUMPTIONS),
            "asOf": as_of,
        }
    )


def codes(result):
    return {finding["code"] for finding in result["findings"]}


class PreflightTests(unittest.TestCase):
    def test_complete_packet_is_ready(self):
        result = run()
        self.assertTrue(result["ready"], result["findings"])
        self.assertEqual(result["summary"]["ticker"], "AAPL")
        self.assertEqual(result["summary"]["asOf"], "2026-09-02")
        self.assertEqual(result["summary"]["errors"], 0)
        self.assertGreater(result["summary"]["checks"], 100)

    def test_missing_market_cap_blocks(self):
        packets = copy.deepcopy(PACKETS)
        packets["financialPacket"]["marketSnapshot"].pop("marketCapUsd")
        result = run(packets=packets)
        self.assertFalse(result["ready"])
        self.assertIn("MARKET_CAP_MISSING", codes(result))

    def test_market_cap_mismatch_blocks(self):
        packets = copy.deepcopy(PACKETS)
        packets["financialPacket"]["marketSnapshot"]["marketCapUsd"] *= 1.05
        result = run(packets=packets)
        self.assertFalse(result["ready"])
        self.assertIn("MARKET_CAP_MISMATCH", codes(result))

    def test_stale_price_blocks(self):
        packets = copy.deepcopy(PACKETS)
        packets["financialPacket"]["marketSnapshot"]["asOf"] = "2026-08-01"
        result = run(packets=packets)
        self.assertFalse(result["ready"])
        self.assertIn("STALE_PRICE", codes(result))

    def test_c_tier_blocks(self):
        packets = copy.deepcopy(PACKETS)
        packets["qualitativePacket"]["moatEvidence"][0]["sourceTier"] = "C"
        result = run(packets=packets)
        self.assertFalse(result["ready"])
        self.assertIn("TIER_C_NOT_EVIDENCE", codes(result))

    def test_missing_source_tier_is_a_warning(self):
        packets = copy.deepcopy(PACKETS)
        for group in ("businessModel", "moatEvidence", "managementCulture", "capitalAllocation", "riskFactors", "contraryEvidence"):
            for item in packets["qualitativePacket"][group]:
                item.pop("sourceTier", None)
        result = run(packets=packets)
        self.assertTrue(result["ready"])
        self.assertIn("SOURCE_TIER_MISSING", codes(result))

    def test_missing_driver_blocks(self):
        assumptions = copy.deepcopy(ASSUMPTIONS)
        assumptions["scenarios"]["base"].pop("wacc")
        result = run(assumptions=assumptions)
        self.assertFalse(result["ready"])
        self.assertIn("SCENARIO_DRIVER_MISSING", codes(result))

    def test_wacc_at_or_below_terminal_blocks(self):
        assumptions = copy.deepcopy(ASSUMPTIONS)
        assumptions["scenarios"]["base"]["terminalGrowth"] = 0.09
        result = run(assumptions=assumptions)
        self.assertFalse(result["ready"])
        self.assertIn("SCENARIO_WACC_NOT_ABOVE_TERMINAL", codes(result))

    def test_unbalanced_opening_balance_sheet_blocks(self):
        packets = copy.deepcopy(PACKETS)
        packets["financialPacket"]["balanceSheet"]["otherAssets"] = 100000
        result = run(packets=packets)
        self.assertFalse(result["ready"])
        self.assertIn("OPENING_BALANCE_SHEET_UNBALANCED", codes(result))

    def test_invalid_as_of_is_reported(self):
        result = run(as_of="2026-13-40")
        self.assertFalse(result["ready"])
        self.assertIn("INVALID_AS_OF", codes(result))

    def test_missing_balance_sheet_fields_block(self):
        packets = copy.deepcopy(PACKETS)
        packets["financialPacket"]["balanceSheet"].pop("equity")
        result = run(packets=packets)
        self.assertFalse(result["ready"])
        self.assertIn("BALANCE_SHEET_EQUITY_MISSING", codes(result))

    def test_bad_packet_json_is_reported(self):
        result = preflight_code.main({"tickerPacket": "{not json", "assumptions": json.dumps(ASSUMPTIONS), "asOf": "2026-09-02"})
        self.assertFalse(result["ready"])
        self.assertEqual(result["findings"][0]["code"], "PACKET_NOT_JSON")


if __name__ == "__main__":
    unittest.main(verbosity=2)
