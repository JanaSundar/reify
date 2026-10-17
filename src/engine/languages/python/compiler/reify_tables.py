"""Where things are in the source: character positions, diagnostics, scopes, and the
location and binding tables (`ProgramInfo.locs` / `ProgramInfo.bindings`) the trace refers to.
"""

import ast

from reify_protocol import RESERVED_PREFIX, SINGLE_FILE_ID


def _table_type(table):
    kind = table.get_type()
    return getattr(kind, "value", kind)


class Positions:
    """Source ranges in characters (CPython reports UTF-8 byte columns)."""

    def __init__(self, source):
        self.lines = source.split("\n")

    def _col(self, lineno, byte_col):
        if not 1 <= lineno <= len(self.lines):
            return byte_col
        encoded = self.lines[lineno - 1].encode("utf-8")
        return len(encoded[:byte_col].decode("utf-8", errors="ignore"))

    def line_end(self, lineno):
        return len(self.lines[lineno - 1]) if 1 <= lineno <= len(self.lines) else 0

    def span(self, start, end=None):
        end = end or start
        return {
            "line": start.lineno,
            "column": self._col(start.lineno, start.col_offset),
            "endLine": end.end_lineno,
            "endColumn": self._col(end.end_lineno, end.end_col_offset),
        }

    def header(self, node):
        """The part of a statement that executes at its step (an `if` header, not its body)."""
        last = None
        if isinstance(node, (ast.If, ast.While)):
            last = node.test
        elif isinstance(node, ast.For):
            last = node.iter
        elif isinstance(node, ast.With):
            last = node.items[-1].optional_vars or node.items[-1].context_expr
        elif isinstance(node, ast.Match):
            last = node.subject
        elif isinstance(node, ast.ExceptHandler):
            last = node.type
        elif isinstance(node, ast.match_case):
            start = node.pattern
            return self.span(start, node.guard or node.pattern)
        if last is not None:
            return self.span(node, last)
        if isinstance(node, (ast.FunctionDef, ast.ClassDef, ast.Try, ast.TryStar, ast.ExceptHandler)):
            return {
                "line": node.lineno,
                "column": self._col(node.lineno, node.col_offset),
                "endLine": node.lineno,
                "endColumn": self.line_end(node.lineno),
            }
        return self.span(node)


class Diagnostics:
    def __init__(self, positions):
        self.positions = positions
        self.errors = []
        self.warnings = []
        self._warned = set()

    def error(self, code, message, node=None):
        self.errors.append(self._make("error", code, message, node))

    def warn(self, code, message, node=None):
        if code in self._warned:
            return
        self._warned.add(code)
        self.warnings.append(self._make("warning", code, message, node))

    def _make(self, severity, code, message, node):
        span = self.positions.span(node) if node is not None and hasattr(node, "lineno") else None
        return {"severity": severity, "code": code, "message": message, "range": span}


class Scope:
    """A Python scope being instrumented: the module, a function or a class body."""

    def __init__(self, kind, table, parent):
        self.kind = kind  # "module" | "function" | "class"
        self.table = table  # symtable.SymbolTable, or None when it could not be matched
        self.parent = parent

    def symbol(self, name):
        if self.table is None:
            return None
        try:
            return self.table.lookup(name)
        except KeyError:
            return None

    def child(self, kind, node):
        table = None
        if self.table is not None:
            for candidate in self.table.get_children():
                if (
                    _table_type(candidate) == kind
                    and candidate.get_name() == node.name
                    and candidate.get_lineno() == node.lineno
                ):
                    table = candidate
                    break
        return Scope(kind, table, self)

    def module(self):
        scope = self
        while scope.parent is not None:
            scope = scope.parent
        return scope


class Tables:
    """Location and binding tables (`ProgramInfo.locs` / `ProgramInfo.bindings`)."""

    def __init__(self, positions):
        self.positions = positions
        self.locs = []
        self.bindings = []
        self._binding_ids = {}

    def loc(self, role, span, reads=()):
        self.locs.append({**span, "file": SINGLE_FILE_ID, "role": role, "reads": list(reads)})
        return len(self.locs) - 1

    def binding(self, scope, name, kind, line):
        """Binding id of `name` assigned in `scope`, resolved the way CPython resolves it."""
        return self.binding_ref(scope, name, kind, line)[0]

    def binding_ref(self, scope, name, kind, line):
        """`(binding id, owned by an enclosing scope)`, or `(None, False)` when untraced."""
        if name.startswith(RESERVED_PREFIX):
            return None, False
        owner = self._owner(scope, name)
        if owner is None:
            return None, False
        return self._binding_for(owner, name, kind, line), owner is not scope

    def _binding_for(self, owner, name, kind, line):
        key = (id(owner), name)
        found = self._binding_ids.get(key)
        if found is not None:
            return found
        if owner.kind == "module" and kind not in ("function", "class"):
            kind = "global"
        self.bindings.append({"name": name, "kind": kind, "line": line})
        self._binding_ids[key] = len(self.bindings) - 1
        return self._binding_ids[key]

    def _owner(self, scope, name):
        if scope.kind == "class":
            return None  # class attributes are not variables of any frame
        symbol = scope.symbol(name)
        if symbol is None or scope.kind == "module":
            return scope
        if symbol.is_declared_global():
            return scope.module()
        if symbol.is_nonlocal():
            outer = scope.parent
            while outer is not None:
                if outer.kind == "function":
                    found = outer.symbol(name)
                    if found is not None and found.is_local():
                        return outer
                outer = outer.parent
            return None
        return scope
