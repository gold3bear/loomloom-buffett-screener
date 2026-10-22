#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for the compact cloud copy of the valuation engine."""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import minify_code  # noqa: E402
import valuation_model as full_engine  # noqa: E402

CLOUD_PATH = os.path.join(HERE, "valuation_model.cloud.py")
SOURCE_PATH = os.path.join(HERE, "valuation_model.py")


def load_cloud_module():
    spec = importlib.util.spec_from_file_location("valuation_model_cloud", CLOUD_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def fixture(name):
    with open(os.path.join(HERE, "fixtures", name), "r", encoding="utf-8") as handle:
        return handle.read()


class CompactEngineTests(unittest.TestCase):
    @unittest.skipIf(sys.version_info < (3, 12), "ast.unparse output is version-specific; the cloud copy is generated with CPython 3.12")
    def test_cloud_source_is_current(self):
        with open(SOURCE_PATH, "r", encoding="utf-8") as handle:
            expected = minify_code.compact(handle.read())
        with open(CLOUD_PATH, "r", encoding="utf-8") as handle:
            actual = handle.read()
        self.assertEqual(actual, expected)

    def test_cloud_source_fits_the_code_limit(self):
        size = os.path.getsize(CLOUD_PATH)
        self.assertLessEqual(size, minify_code.MAX_BYTES, size)

    def test_cloud_source_compiles(self):
        with open(CLOUD_PATH, "r", encoding="utf-8") as handle:
            source = handle.read()
        compile(source, CLOUD_PATH, "exec")
        self.assertNotIn("argparse", source)
        self.assertNotIn('if __name__ == "__main__"', source)

    def test_cloud_and_full_engines_produce_identical_models(self):
        cloud = load_cloud_module()
        packets = fixture("aapl-packets.json")
        assumptions = fixture("aapl-assumptions.json")
        full_model = full_engine.build_model(packets, assumptions)
        cloud_model = cloud.build_model(packets, assumptions)
        self.assertEqual(json.dumps(full_model, sort_keys=True, ensure_ascii=False), json.dumps(cloud_model, sort_keys=True, ensure_ascii=False))

    def test_cloud_entrypoint_returns_model_and_workbook(self):
        cloud = load_cloud_module()
        model = cloud.build_model(fixture("aapl-packets.json"), fixture("aapl-assumptions.json"))
        self.assertTrue(model["model_ready"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
