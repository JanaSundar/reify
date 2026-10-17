"""Reify's Python instrumenter. Runs inside Pyodide in the compiler worker; never executes user code.

It parses with CPython's own `ast` and `symtable`, reports syntax errors and unsupported
constructs, builds the location and binding tables the trace refers to, and rewrites the
program so it reports what it does. The rules mirror the JavaScript instrumenter: wrap
values, never restructure control flow; capture before writing; balanced frames; reject
rather than mislead.

`compile_json(source)` is the entry point: it returns a JSON `CompileResult`. The work is
split across `reify_tables` (positions, scopes, tables), `reify_statements` and
`reify_expressions` (the rewrites) and `reify_complexity` (the static estimate); hook names
live in `reify_protocol.Api`.
"""

import ast
import json
import symtable

from reify_complexity import complexity_shape
from reify_protocol import RESERVED_PREFIX
from reify_statements import Instrumenter
from reify_tables import Diagnostics, Positions


def _identifiers(node):
    """Every identifier a node introduces or uses (not attribute names)."""
    if isinstance(node, ast.Name):
        return [node.id]
    if isinstance(node, ast.arg):
        return [node.arg]
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [node.name]
    if isinstance(node, ast.alias):
        return [node.asname or node.name.split(".")[0]]
    if isinstance(node, (ast.Global, ast.Nonlocal)):
        return list(node.names)
    if isinstance(node, (ast.ExceptHandler, ast.MatchAs, ast.MatchStar)):
        return [node.name] if node.name else []
    if isinstance(node, ast.MatchMapping):
        return [node.rest] if node.rest else []
    return []


def _check_reserved(tree, diagnostics):
    for node in ast.walk(tree):
        if any(name.startswith(RESERVED_PREFIX) for name in _identifiers(node)):
            diagnostics.error(
                "reserved-name", f"Names starting with `{RESERVED_PREFIX}` are reserved.", node
            )


def _syntax_diagnostic(error, positions):
    line = error.lineno or 1
    column = max((error.offset or 1) - 1, 0)
    end_line = error.end_lineno or line
    end_column = max((error.end_offset or (column + 2)) - 1, column + 1)
    if end_line == line and end_column <= column:
        end_column = column + 1
    kind = type(error).__name__
    message = error.msg if kind == "SyntaxError" else f"{kind}: {error.msg}"
    return {
        "severity": "error",
        "code": "syntax",
        "message": message,
        "range": {"line": line, "column": column, "endLine": end_line, "endColumn": end_column},
    }


def _complexity(tree):
    """The shape for the static estimate, or None when it cannot be made: it never blocks a run."""
    try:
        return complexity_shape(tree)
    except Exception:
        return None


def compile_program(source):
    """Returns a `CompileResult` dict for `source`."""
    source = source.replace("\r\n", "\n").replace("\r", "\n")
    positions = Positions(source)
    try:
        # A full compile reports every syntax error CPython would (e.g. `return` outside a
        # function), without running anything.
        compile(source, "<reify>", "exec", dont_inherit=True)
        tree = ast.parse(source, "<reify>")
        table = symtable.symtable(source, "<reify>", "exec")
    except SyntaxError as error:
        return {"ok": False, "diagnostics": [_syntax_diagnostic(error, positions)]}
    except ValueError as error:  # e.g. null bytes in the source
        return {
            "ok": False,
            "diagnostics": [{"severity": "error", "code": "syntax", "message": str(error), "range": None}],
        }
    except (RecursionError, MemoryError):
        return {
            "ok": False,
            "diagnostics": [
                {
                    "severity": "error",
                    "code": "syntax",
                    "message": "The program is nested too deeply to compile.",
                    "range": None,
                }
            ],
        }

    diagnostics = Diagnostics(positions)
    _check_reserved(tree, diagnostics)
    complexity = _complexity(tree)
    instrumenter = Instrumenter(tree, table, diagnostics, positions)
    instrumented = instrumenter.run()
    if diagnostics.errors:
        return {"ok": False, "diagnostics": diagnostics.errors}

    ast.fix_missing_locations(instrumented)
    code = ast.unparse(instrumented)
    try:
        compile(code, "<reify-instrumented>", "exec", dont_inherit=True)
    except SyntaxError as error:
        return {
            "ok": False,
            "diagnostics": [
                {
                    "severity": "error",
                    "code": "internal",
                    "message": f"Instrumentation produced invalid code ({error.msg}). Please report this program.",
                    "range": None,
                }
            ],
        }
    return {
        "ok": True,
        "code": code,
        "program": {
            "languageId": "python",
            "locs": instrumenter.tables.locs,
            "bindings": instrumenter.tables.bindings,
            "warnings": diagnostics.warnings,
            "complexity": complexity,
        },
    }


def compile_json(source):
    return json.dumps(compile_program(source))
