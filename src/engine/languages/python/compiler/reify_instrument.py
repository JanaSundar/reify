"""Reify's Python instrumenter. Runs inside Pyodide in the compiler worker; never executes user code.

It parses with CPython's own `ast` and `symtable`, reports syntax errors and unsupported
constructs, builds the location and binding tables the trace refers to, and rewrites the
program so it reports what it does. The rules mirror the JavaScript instrumenter: wrap
values, never restructure control flow; capture before writing; balanced frames; reject
rather than mislead.

`compile_json(source)` is the entry point: it returns a JSON `CompileResult`.
"""

import ast
import builtins
import json
import symtable

# The tracer object the runtime injects. Dunder names are never name-mangled in class bodies.
TRACER = "__reify__"
RESERVED_PREFIX = "__reify"


class Api:
    """Hook names on the tracer, shared with the runtime's tracer."""

    line = "ln"  # ln(loc): a statement starts
    loop_test = "lt"  # lt(loc, test) -> test: `while` header check (line + branch)
    branch = "br"  # br(loc, test) -> test: a condition was evaluated
    enter = "en"  # en(loc, name, b1, v1, ...): function entered with its parameters
    ret = "rt"  # rt(loc, value) -> value: return value
    unwind = "ex"  # ex(loc, error): an exception leaves the function
    leave = "lv"  # lv(): the function frame is left
    bind = "a"  # a(loc, b1, v1, ...): names bound (the tracer decides declare or assign)
    bind_outer = "ao"  # ao(loc, b1, v1, ...): `global` / `nonlocal` names bound
    bind_one = "a1"  # a1(loc, b, value) -> value: walrus binding
    write = "w"  # w(loc, obj, key): obj[key] or obj.key was written
    mutate = "m"  # m(loc, obj, method) -> callable: obj.method(...) that mutates obj
    mutate_fn = "mf"  # mf(loc, fn) -> callable: fn(obj, ...) that mutates its first argument
    mark = "mk"  # mk(loc, obj, op): obj changed in a way only a re-capture describes
    caught = "ck"  # ck(loc, b, error): except clause entered (re-raises budget errors)
    drop = "dr"  # dr(loc, b1, ...): names deleted
    base_exception = "BaseException"  # the tracer's reference to builtins.BaseException


ALLOWED_MODULES = (
    "bisect",
    "collections",
    "dataclasses",
    "functools",
    "heapq",
    "itertools",
    "math",
    "random",
    "re",
    "string",
    "typing",
)

MUTATING_METHODS = frozenset(
    {
        # list
        "append",
        "extend",
        "insert",
        "pop",
        "remove",
        "clear",
        "sort",
        "reverse",
        # dict / set
        "update",
        "setdefault",
        "popitem",
        "add",
        "discard",
        "intersection_update",
        "difference_update",
        "symmetric_difference_update",
        # collections.deque
        "appendleft",
        "popleft",
        "extendleft",
        "rotate",
    }
)

# Functions that mutate their first argument, by module.
MUTATING_FUNCTIONS = {
    "heapq": frozenset({"heappush", "heappop", "heapify", "heapreplace", "heappushpop"}),
    "bisect": frozenset({"insort", "insort_left", "insort_right"}),
    "random": frozenset({"shuffle"}),
}

FORBIDDEN_CALLS = {
    "eval": "`eval` is not available.",
    "exec": "`exec` is not available.",
    "compile": "`compile` is not available.",
    "__import__": "`__import__` is not available; use an `import` statement.",
    "breakpoint": "`breakpoint()` is not available; use the playground's breakpoints.",
    "input": "`input()` is not available: put the input data in the code.",
}

NO_BINDING = -1


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
        self.locs.append({**span, "role": role, "reads": list(reads)})
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


def _names_in_target(target):
    """Name nodes bound by an assignment target, and whether the target is only names."""
    names = []
    simple = True

    def walk(node):
        nonlocal simple
        if isinstance(node, ast.Name):
            names.append(node)
        elif isinstance(node, (ast.Tuple, ast.List)):
            for element in node.elts:
                walk(element)
        elif isinstance(node, ast.Starred):
            walk(node.value)
        else:
            simple = False

    walk(target)
    return names, simple


def _pattern_names(pattern):
    names = []
    for node in ast.walk(pattern):
        if isinstance(node, (ast.MatchAs, ast.MatchStar)) and node.name:
            names.append(node.name)
        elif isinstance(node, ast.MatchMapping) and node.rest:
            names.append(node.rest)
    return names


class Instrumenter:
    def __init__(self, source, tree, table, diagnostics, positions):
        self.source = source
        self.tree = tree
        self.diagnostics = diagnostics
        self.positions = positions
        self.tables = Tables(positions)
        self.module_scope = Scope("module", table, None)
        self.temp_count = 0
        # Module aliases (`import heapq as hq`) and imported mutating functions
        # (`from heapq import heappush`), for recognising mutations of arguments.
        self.module_aliases = {}
        self.function_aliases = set()
        self.assigned_names = self._assigned_in_module(table)

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _assigned_in_module(table):
        names = set()

        def visit(t):
            for symbol in t.get_symbols():
                if symbol.is_assigned() or symbol.is_parameter() or symbol.is_imported():
                    names.add(symbol.get_name())
            for child in t.get_children():
                visit(child)

        visit(table)
        return names

    def temp(self, kind):
        self.temp_count += 1
        return f"{RESERVED_PREFIX}_{kind}{self.temp_count}__"

    @staticmethod
    def hook(name, *args):
        return ast.Call(
            func=ast.Attribute(value=ast.Name(id=TRACER, ctx=ast.Load()), attr=name, ctx=ast.Load()),
            args=list(args),
            keywords=[],
        )

    def hook_stmt(self, name, *args):
        return ast.Expr(value=self.hook(name, *args))

    @staticmethod
    def num(value):
        return ast.Constant(value=value)

    def reads(self, *roots):
        seen = []
        for root in roots:
            if root is None:
                continue
            for node in ast.walk(root):
                if (
                    isinstance(node, ast.Name)
                    and isinstance(node.ctx, ast.Load)
                    and not node.id.startswith(RESERVED_PREFIX)
                    and not (node.id in builtins.__dict__ and node.id not in self.assigned_names)
                    and node.id not in seen
                ):
                    seen.append(node.id)
        return seen

    def read_roots(self, node):
        if isinstance(node, (ast.If, ast.While)):
            return [node.test]
        if isinstance(node, ast.For):
            return [node.iter]
        if isinstance(node, ast.With):
            return [item.context_expr for item in node.items]
        if isinstance(node, ast.Match):
            return [node.subject]
        if isinstance(node, (ast.FunctionDef, ast.ClassDef, ast.Try, ast.TryStar)):
            return [*node.decorator_list] if hasattr(node, "decorator_list") else []
        return [node]

    def statement_loc(self, node):
        return self.tables.loc(
            "statement", self.positions.header(node), self.reads(*self.read_roots(node))
        )

    def bind_stmt(self, loc, scope, names, kind="local"):
        """`a(loc, b1, v1, ...)` / `ao(...)` for the names a statement bound, or nothing."""
        local, outer = [], []
        for name in names:
            binding, is_outer = self.tables.binding_ref(scope, name, kind, self._line_of(loc))
            if binding is not None:
                (outer if is_outer else local).extend(
                    [self.num(binding), ast.Name(id=name, ctx=ast.Load())]
                )
        out = []
        if local:
            out.append(self.hook_stmt(Api.bind, self.num(loc), *local))
        if outer:
            out.append(self.hook_stmt(Api.bind_outer, self.num(loc), *outer))
        return out

    def _line_of(self, loc):
        return self.tables.locs[loc]["line"]

    def expr(self, node, scope):
        return None if node is None else ExpressionRewriter(self, scope).visit(node)

    def assign(self, target, value):
        return ast.Assign(targets=[target], value=value)

    def store(self, name):
        return ast.Name(id=name, ctx=ast.Store())

    def load(self, name):
        return ast.Name(id=name, ctx=ast.Load())

    # ------------------------------------------------------------------ statements

    def block(self, statements, scope):
        out = []
        for statement in statements:
            out.extend(self.statement(statement, scope))
        return out or [ast.Pass()]

    def statement(self, node, scope):
        if isinstance(node, (ast.Global, ast.Nonlocal, ast.Pass)):
            return [node]
        if isinstance(node, (ast.AsyncFunctionDef, ast.AsyncFor, ast.AsyncWith)):
            self.diagnostics.error(
                "unsupported-async", "`async` code is not supported yet.", node
            )
            return [node]
        if isinstance(node, ast.For):
            return self.for_loop(node, scope)
        if isinstance(node, ast.While):
            return self.while_loop(node, scope)

        loc = self.statement_loc(node)
        line = self.hook_stmt(Api.line, self.num(loc))
        handler = getattr(self, f"stmt_{type(node).__name__}", None)
        body = handler(node, loc, scope) if handler else [self.generic_statement(node, scope)]
        return [line, *body]

    def generic_statement(self, node, scope):
        """Statements with no bindings of their own: rewrite their expressions in place."""
        for field, value in ast.iter_fields(node):
            if isinstance(value, ast.expr):
                setattr(node, field, self.expr(value, scope))
        return node

    def stmt_Expr(self, node, loc, scope):
        node.value = self.expr(node.value, scope)
        return [node]

    def stmt_Assign(self, node, loc, scope):
        value = self.expr(node.value, scope)
        targets = [_names_in_target(target) for target in node.targets]
        if all(simple for _, simple in targets):
            node.value = value
            names = [name.id for found, _ in targets for name in found]
            return [node, *self.bind_stmt(loc, scope, names)]
        temp = self.temp("v")
        out = [self.assign(self.store(temp), value)]
        for target in node.targets:
            out += self.assign_target(target, self.load(temp), loc, scope)
        return out

    def stmt_AnnAssign(self, node, loc, scope):
        if node.value is None:
            return [node]
        names, simple = _names_in_target(node.target)
        if simple:
            node.value = self.expr(node.value, scope)
            return [node, *self.bind_stmt(loc, scope, [name.id for name in names])]
        temp = self.temp("v")
        return [
            self.assign(self.store(temp), self.expr(node.value, scope)),
            *self.assign_target(node.target, self.load(temp), loc, scope),
        ]

    def assign_target(self, target, source, loc, scope):
        """Assigns `source` to `target` in CPython's order, reporting every write."""
        if isinstance(target, ast.Name):
            return [self.assign(target, source), *self.bind_stmt(loc, scope, [target.id])]
        if isinstance(target, ast.Attribute):
            obj = self.temp("o")
            return [
                self.assign(self.store(obj), self.expr(target.value, scope)),
                self.assign(
                    ast.Attribute(value=self.load(obj), attr=target.attr, ctx=ast.Store()), source
                ),
                self.hook_stmt(Api.write, self.num(loc), self.load(obj), ast.Constant(target.attr)),
            ]
        if isinstance(target, ast.Subscript):
            obj = self.temp("o")
            out = [self.assign(self.store(obj), self.expr(target.value, scope))]
            if isinstance(target.slice, ast.Slice):
                out += [
                    self.assign(
                        ast.Subscript(
                            value=self.load(obj),
                            slice=self.expr(target.slice, scope),
                            ctx=ast.Store(),
                        ),
                        source,
                    ),
                    self.hook_stmt(Api.mark, self.num(loc), self.load(obj), ast.Constant("slice")),
                ]
                return out
            key = self.temp("k")
            return out + [
                self.assign(self.store(key), self.expr(target.slice, scope)),
                self.assign(
                    ast.Subscript(value=self.load(obj), slice=self.load(key), ctx=ast.Store()),
                    source,
                ),
                self.hook_stmt(Api.write, self.num(loc), self.load(obj), self.load(key)),
            ]
        if isinstance(target, (ast.Tuple, ast.List)):
            # Unpack into temporaries first (CPython unpacks fully, then assigns left to right).
            parts = []
            elements = []
            for element in target.elts:
                name = self.temp("e")
                inner = element.value if isinstance(element, ast.Starred) else element
                parts.append((inner, name))
                stored = self.store(name)
                elements.append(
                    ast.Starred(value=stored, ctx=ast.Store())
                    if isinstance(element, ast.Starred)
                    else stored
                )
            out = [self.assign(ast.Tuple(elts=elements, ctx=ast.Store()), source)]
            for inner, name in parts:
                out += self.assign_target(inner, self.load(name), loc, scope)
            return out
        return [self.assign(target, source)]

    def stmt_AugAssign(self, node, loc, scope):
        value = self.expr(node.value, scope)
        target = node.target
        if isinstance(target, ast.Name):
            node.value = value
            return [node, *self.bind_stmt(loc, scope, [target.id])]
        obj = self.temp("o")
        out = [self.assign(self.store(obj), self.expr(target.value, scope))]
        if isinstance(target, ast.Attribute):
            new_target = ast.Attribute(value=self.load(obj), attr=target.attr, ctx=ast.Store())
            report = self.hook_stmt(Api.write, self.num(loc), self.load(obj), ast.Constant(target.attr))
        elif isinstance(target.slice, ast.Slice):
            new_target = ast.Subscript(
                value=self.load(obj), slice=self.expr(target.slice, scope), ctx=ast.Store()
            )
            report = self.hook_stmt(Api.mark, self.num(loc), self.load(obj), ast.Constant("slice"))
        else:
            key = self.temp("k")
            out.append(self.assign(self.store(key), self.expr(target.slice, scope)))
            new_target = ast.Subscript(value=self.load(obj), slice=self.load(key), ctx=ast.Store())
            report = self.hook_stmt(Api.write, self.num(loc), self.load(obj), self.load(key))
        return out + [ast.AugAssign(target=new_target, op=node.op, value=value), report]

    def stmt_Delete(self, node, loc, scope):
        out = []
        for target in node.targets:
            out += self.delete_target(target, loc, scope)
        return out

    def delete_target(self, target, loc, scope):
        if isinstance(target, ast.Name):
            binding, is_outer = self.tables.binding_ref(scope, target.id, "local", self._line_of(loc))
            drop = (
                []
                if binding is None or is_outer
                else [self.hook_stmt(Api.drop, self.num(loc), self.num(binding))]
            )
            return [ast.Delete(targets=[target]), *drop]
        if isinstance(target, (ast.Tuple, ast.List)):
            out = []
            for element in target.elts:
                out += self.delete_target(element, loc, scope)
            return out
        obj = self.temp("o")
        out = [self.assign(self.store(obj), self.expr(target.value, scope))]
        if isinstance(target, ast.Attribute):
            deleted = ast.Attribute(value=self.load(obj), attr=target.attr, ctx=ast.Del())
        else:
            deleted = ast.Subscript(
                value=self.load(obj), slice=self.expr(target.slice, scope), ctx=ast.Del()
            )
        return out + [
            ast.Delete(targets=[deleted]),
            self.hook_stmt(Api.mark, self.num(loc), self.load(obj), ast.Constant("del")),
        ]

    def stmt_Return(self, node, loc, scope):
        ret = self.tables.loc("return", self.positions.span(node), self.reads(node.value))
        value = self.expr(node.value, scope) if node.value is not None else ast.Constant(None)
        return [ast.Return(value=self.hook(Api.ret, self.num(ret), value))]

    def stmt_If(self, node, loc, scope):
        condition = self.tables.loc("condition", self.positions.header(node), self.reads(node.test))
        node.test = self.hook(Api.branch, self.num(condition), self.expr(node.test, scope))
        node.body = self.block(node.body, scope)
        node.orelse = self.block(node.orelse, scope) if node.orelse else []
        return [node]

    def while_loop(self, node, scope):
        loop = self.tables.loc("loop", self.positions.header(node), self.reads(node.test))
        node.test = self.hook(Api.loop_test, self.num(loop), self.expr(node.test, scope))
        node.body = self.block(node.body, scope)
        node.orelse = self.block(node.orelse, scope) if node.orelse else []
        return [node]

    def for_loop(self, node, scope):
        # The header steps once per iteration, binding the loop variables.
        loop = self.tables.loc("loop", self.positions.header(node), self.reads(node.iter))
        node.iter = self.expr(node.iter, scope)
        names, simple = _names_in_target(node.target)
        prologue = [self.hook_stmt(Api.line, self.num(loop))]
        if simple:
            prologue += self.bind_stmt(loop, scope, [name.id for name in names])
        else:
            temp = self.temp("i")
            original = node.target
            node.target = self.store(temp)
            prologue += self.assign_target(original, self.load(temp), loop, scope)
        node.body = prologue + self.block(node.body, scope)
        node.orelse = self.block(node.orelse, scope) if node.orelse else []
        return [node]

    def stmt_With(self, node, loc, scope):
        prologue = []
        for item in node.items:
            item.context_expr = self.expr(item.context_expr, scope)
            if item.optional_vars is None:
                continue
            names, simple = _names_in_target(item.optional_vars)
            if simple:
                prologue += self.bind_stmt(loc, scope, [name.id for name in names])
            else:
                temp = self.temp("w")
                original = item.optional_vars
                item.optional_vars = self.store(temp)
                prologue += self.assign_target(original, self.load(temp), loc, scope)
        node.body = prologue + self.block(node.body, scope)
        return [node]

    def stmt_Raise(self, node, loc, scope):
        node.exc = self.expr(node.exc, scope)
        node.cause = self.expr(node.cause, scope)
        return [node]

    def stmt_Try(self, node, loc, scope):
        node.body = self.block(node.body, scope)
        for handler in node.handlers:
            handler.type = self.expr(handler.type, scope)
            head = self.tables.loc("statement", self.positions.header(handler), self.reads(handler.type))
            binding = (
                self.tables.binding(scope, handler.name, "catch", handler.lineno)
                if handler.name
                else None
            )
            caught = self.hook_stmt(
                Api.caught,
                self.num(head),
                self.num(NO_BINDING if binding is None else binding),
                self.load(handler.name) if handler.name else ast.Constant(None),
            )
            handler.body = [caught, *self.block(handler.body, scope)]
        node.orelse = self.block(node.orelse, scope) if node.orelse else []
        node.finalbody = self.block(node.finalbody, scope) if node.finalbody else []
        return [node]

    stmt_TryStar = stmt_Try

    def stmt_Match(self, node, loc, scope):
        node.subject = self.expr(node.subject, scope)
        for case in node.cases:
            case.guard = self.expr(case.guard, scope)
            head = self.tables.loc("statement", self.positions.header(case))
            prologue = [self.hook_stmt(Api.line, self.num(head))]
            prologue += self.bind_stmt(head, scope, _pattern_names(case.pattern))
            case.body = prologue + self.block(case.body, scope)
        return [node]

    def stmt_Import(self, node, loc, scope):
        names = []
        for alias in node.names:
            root = alias.name.split(".")[0]
            if not self.check_module(alias.name, node):
                continue
            bound = alias.asname or root
            names.append(bound)
            if alias.asname or "." not in alias.name:
                self.module_aliases[bound] = alias.name
        return [node, *self.bind_stmt(loc, scope, names)]

    def stmt_ImportFrom(self, node, loc, scope):
        if node.level:
            self.diagnostics.error("unsupported-module", "Relative imports are not supported.", node)
            return [node]
        if not self.check_module(node.module or "", node):
            return [node]
        names = []
        for alias in node.names:
            if alias.name == "*":
                self.diagnostics.error(
                    "unsupported-module", "`from ... import *` is not supported; import names explicitly.", node
                )
                continue
            bound = alias.asname or alias.name
            names.append(bound)
            root = node.module.split(".")[0]
            if alias.name in MUTATING_FUNCTIONS.get(root, ()):
                self.function_aliases.add(bound)
        return [node, *self.bind_stmt(loc, scope, names)]

    def check_module(self, module, node):
        if module.split(".")[0] in ALLOWED_MODULES:
            return True
        self.diagnostics.error(
            "unsupported-module",
            f"`{module}` cannot be imported. Available modules: {', '.join(ALLOWED_MODULES)}.",
            node,
        )
        return False

    def stmt_FunctionDef(self, node, loc, scope):
        node.decorator_list = [self.expr(d, scope) for d in node.decorator_list]
        arguments = node.args
        arguments.defaults = [self.expr(d, scope) for d in arguments.defaults]
        arguments.kw_defaults = [self.expr(d, scope) for d in arguments.kw_defaults]

        inner = scope.child("function", node)
        call = self.tables.loc("call", self.positions.header(node))
        params = [
            *arguments.posonlyargs,
            *arguments.args,
            *([arguments.vararg] if arguments.vararg else []),
            *arguments.kwonlyargs,
            *([arguments.kwarg] if arguments.kwarg else []),
        ]
        pairs = []
        for param in params:
            binding = self.tables.binding(inner, param.arg, "param", param.lineno)
            if binding is not None:
                pairs += [self.num(binding), self.load(param.arg)]

        body = list(node.body)
        docstring = []
        if (
            body
            and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)
        ):
            docstring = [body.pop(0)]
        error = self.temp("x")
        node.body = [
            *docstring,
            self.hook_stmt(Api.enter, self.num(call), ast.Constant(node.name), *pairs),
            ast.Try(
                body=self.block(body, inner),
                handlers=[
                    ast.ExceptHandler(
                        type=ast.Attribute(
                            value=self.load(TRACER), attr=Api.base_exception, ctx=ast.Load()
                        ),
                        name=error,
                        body=[
                            self.hook_stmt(Api.unwind, self.num(call), self.load(error)),
                            ast.Raise(exc=None, cause=None),
                        ],
                    )
                ],
                orelse=[],
                finalbody=[self.hook_stmt(Api.leave)],
            ),
        ]
        return [node, *self.bind_stmt(loc, scope, [node.name], kind="function")]

    def stmt_ClassDef(self, node, loc, scope):
        node.decorator_list = [self.expr(d, scope) for d in node.decorator_list]
        node.bases = [self.expr(b, scope) for b in node.bases]
        for keyword in node.keywords:
            keyword.value = self.expr(keyword.value, scope)
        node.body = self.block(node.body, scope.child("class", node))
        return [node, *self.bind_stmt(loc, scope, [node.name], kind="class")]

    # ------------------------------------------------------------------ entry

    def run(self):
        self.tree.body = self.block(self.tree.body, self.module_scope)
        return self.tree


class ExpressionRewriter(ast.NodeTransformer):
    """Rewrites inside expressions: mutating calls, walrus bindings, forbidden names."""

    def __init__(self, instrumenter, scope):
        self.instrumenter = instrumenter
        self.scope = scope

    @property
    def diagnostics(self):
        return self.instrumenter.diagnostics

    def loc(self, role, node):
        i = self.instrumenter
        return i.tables.loc(role, i.positions.span(node), i.reads(node))

    def visit_Call(self, node):
        func = node.func
        if isinstance(func, ast.Name) and func.id in FORBIDDEN_CALLS:
            self.diagnostics.error("unsupported-eval", FORBIDDEN_CALLS[func.id], node)
        self.generic_visit(node)
        func = node.func
        i = self.instrumenter
        # `xs.append(v)` → `__reify__.m(L, xs, "append")(v)`: same evaluation order (receiver,
        # attribute, arguments, call), and the tracer re-captures `xs` afterwards. Calls on an
        # imported module (`random.shuffle`) are functions, not methods.
        is_module = isinstance(func, ast.Attribute) and (
            isinstance(func.value, ast.Name) and func.value.id in i.module_aliases
        )
        if isinstance(func, ast.Attribute) and func.attr in MUTATING_METHODS and not is_module:
            node.func = i.hook(
                Api.mutate, i.num(self.loc("call", node)), func.value, ast.Constant(func.attr)
            )
            return node
        if self.mutates_first_argument(func):
            node.func = i.hook(Api.mutate_fn, i.num(self.loc("call", node)), func)
        return node

    def mutates_first_argument(self, func):
        i = self.instrumenter
        if isinstance(func, ast.Name):
            return func.id in i.function_aliases
        if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
            module = i.module_aliases.get(func.value.id)
            return module is not None and func.attr in MUTATING_FUNCTIONS.get(module, ())
        return False

    def visit_NamedExpr(self, node):
        self.generic_visit(node)
        i = self.instrumenter
        loc = self.loc("expression", node)
        binding = i.tables.binding(self.scope, node.target.id, "local", node.lineno)
        if binding is None:
            return node
        return i.hook(Api.bind_one, i.num(loc), i.num(binding), node)

    def visit_Lambda(self, node):
        self.diagnostics.warn(
            "partial-lambda", "Lambda bodies run as a single step; their insides are not traced.", node
        )
        self.generic_visit(node)
        return node

    def _comprehension(self, node):
        self.diagnostics.warn(
            "partial-comprehension",
            "Comprehensions and generator expressions run as a single step; "
            "their iterations are not traced.",
            node,
        )
        self.generic_visit(node)
        return node

    visit_ListComp = visit_SetComp = visit_DictComp = visit_GeneratorExp = _comprehension

    def visit_Yield(self, node):
        self.diagnostics.error(
            "unsupported-generator", "Generators (`yield`) are not supported yet.", node
        )
        return node

    visit_YieldFrom = visit_Yield

    def visit_Await(self, node):
        self.diagnostics.error("unsupported-async", "`await` is not supported yet.", node)
        return node


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
    instrumenter = Instrumenter(source, tree, table, diagnostics, positions)
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
            "complexity": None,
        },
    }


def compile_json(source):
    return json.dumps(compile_program(source))
