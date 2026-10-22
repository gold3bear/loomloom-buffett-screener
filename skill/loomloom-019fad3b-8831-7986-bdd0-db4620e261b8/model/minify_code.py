#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Produce the compact cloud copy of the valuation engine.

The Cloud Code node limits `code.source` to 65,536 bytes. The reviewed engine in
`valuation_model.py` is larger than that because it carries the local CLI,
docstrings, comments, and type annotations. This tool emits a semantically
equivalent source file:

* comments and blank lines are removed by the AST round-trip;
* module/class/function docstrings are removed;
* type annotations are removed (they have no runtime effect here);
* the local `_cli` entry point and the `if __name__ == "__main__"` block are
  removed;
* the now-unused `argparse`, `os`, and `sys` imports are removed.

Everything that affects behaviour is preserved. The generated file is checked in
as `valuation_model.cloud.py`, so the template embeds a reviewable artifact
rather than a build-time secret. Run with `--check` to verify it is current and
within the size limit.
"""

from __future__ import annotations

import argparse
import ast
import sys
from typing import Optional

MAX_BYTES = 65536


def _strip_docstring(body):
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
        return body[1:] or [ast.Pass()]
    return body


class _Compact(ast.NodeTransformer):
    def visit_Module(self, node):
        node.body = _strip_docstring(node.body)
        node.body = [
            statement
            for statement in node.body
            if not (
                isinstance(statement, ast.If)
                and isinstance(statement.test, ast.Compare)
                and isinstance(statement.test.left, ast.Name)
                and statement.test.left.id == "__name__"
            )
        ]
        node.body = [statement for statement in node.body if not (isinstance(statement, ast.FunctionDef) and statement.name == "_cli")]
        node.body = [
            statement
            for statement in node.body
            if not (
                isinstance(statement, ast.Import)
                and all(alias.name in ("argparse", "os", "sys") for alias in statement.names)
            )
        ]
        self.generic_visit(node)
        return node

    def _function(self, node):
        node.body = _strip_docstring(node.body)
        node.returns = None
        for argument in list(node.args.args) + list(node.args.kwonlyargs):
            argument.annotation = None
        if node.args.vararg is not None:
            node.args.vararg.annotation = None
        if node.args.kwarg is not None:
            node.args.kwarg.annotation = None
        self.generic_visit(node)
        return node

    visit_FunctionDef = _function
    visit_AsyncFunctionDef = _function

    def visit_ClassDef(self, node):
        node.body = _strip_docstring(node.body)
        self.generic_visit(node)
        return node

    def visit_AnnAssign(self, node):
        self.generic_visit(node)
        if node.value is None:
            return None
        return ast.copy_location(ast.Assign(targets=[node.target], value=node.value), node)


def compact(source: str) -> str:
    tree = ast.parse(source)
    transformed = _Compact().visit(tree)
    ast.fix_missing_locations(transformed)
    output = ast.unparse(transformed) + "\n"
    compile(output, "<compact>", "exec")
    return output


def main(argv: Optional[list] = None) -> int:
    if sys.version_info < (3, 12):
        sys.stderr.write(
            "minify_code.py requires CPython 3.12+ because ast.unparse formatting changed across versions; "
            "the cloud runtime is python-pure@1 (CPython 3.12).\n"
        )
        return 2
    parser = argparse.ArgumentParser(description="Generate the compact cloud copy of the valuation engine")
    parser.add_argument("--input", default="model/valuation_model.py")
    parser.add_argument("--output", default="model/valuation_model.cloud.py")
    parser.add_argument("--check", action="store_true", help="verify the output file is current and within the size limit")
    parser.add_argument("--max-bytes", type=int, default=MAX_BYTES)
    args = parser.parse_args(argv)

    with open(args.input, "r", encoding="utf-8") as handle:
        source = handle.read()
    output = compact(source)
    size = len(output.encode("utf-8"))
    if size > args.max_bytes:
        sys.stderr.write("compact source is %d bytes, over the %d-byte limit\n" % (size, args.max_bytes))
        return 1

    if args.check:
        try:
            with open(args.output, "r", encoding="utf-8") as handle:
                current = handle.read()
        except FileNotFoundError:
            sys.stderr.write("%s does not exist; run without --check\n" % args.output)
            return 1
        if current != output:
            sys.stderr.write("%s is stale; run without --check\n" % args.output)
            return 1
        print("%s is current: %d bytes (limit %d)" % (args.output, size, args.max_bytes))
        return 0

    with open(args.output, "w", encoding="utf-8") as handle:
        handle.write(output)
    print("wrote %s: %d bytes (limit %d)" % (args.output, size, args.max_bytes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
