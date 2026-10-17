"""Rewrites statements so the program reports what it does: lines, bindings, writes,
branches and frames. Python's evaluation order is preserved by evaluating targets into
temporaries before writing.
"""

import ast
import builtins

from reify_expressions import MUTATING_FUNCTIONS, ExpressionRewriter
from reify_protocol import ALLOWED_MODULES, NO_BINDING, RESERVED_PREFIX, TRACER, Api
from reify_tables import Scope, Tables


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
    def __init__(self, tree, table, diagnostics, positions):
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
        if isinstance(target, (ast.Attribute, ast.Subscript)):
            setup, placed, report = self.place(target, loc, scope, ast.Store())
            return [*setup, self.assign(placed, source), report]
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
        setup, placed, report = self.place(target, loc, scope, ast.Store())
        return [*setup, ast.AugAssign(target=placed, op=node.op, value=value), report]

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
        setup, placed, _ = self.place(target, loc, scope, ast.Del())
        return [
            *setup,
            ast.Delete(targets=[placed]),
            self.hook_stmt(Api.mark, self.num(loc), self.load(placed.value.id), ast.Constant("del")),
        ]

    def place(self, target, loc, scope, ctx):
        """`(setup, target, report)` for an attribute or subscript target: `setup` evaluates its
        object (and key) into temporaries in CPython's order, `target` reads them back, and
        `report` tells the tracer what a store there changed."""
        obj = self.temp("o")
        setup = [self.assign(self.store(obj), self.expr(target.value, scope))]
        if isinstance(target, ast.Attribute):
            placed = ast.Attribute(value=self.load(obj), attr=target.attr, ctx=ctx)
            report = self.hook_stmt(Api.write, self.num(loc), self.load(obj), ast.Constant(target.attr))
        elif isinstance(target.slice, ast.Slice):
            placed = ast.Subscript(value=self.load(obj), slice=self.expr(target.slice, scope), ctx=ctx)
            report = self.hook_stmt(Api.mark, self.num(loc), self.load(obj), ast.Constant("slice"))
        else:
            key = self.temp("k")
            setup.append(self.assign(self.store(key), self.expr(target.slice, scope)))
            placed = ast.Subscript(value=self.load(obj), slice=self.load(key), ctx=ctx)
            report = self.hook_stmt(Api.write, self.num(loc), self.load(obj), self.load(key))
        return setup, placed, report

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
        node.target, binds = self.unpack(node.target, loop, scope)
        prologue = [self.hook_stmt(Api.line, self.num(loop)), *binds]
        node.body = prologue + self.block(node.body, scope)
        node.orelse = self.block(node.orelse, scope) if node.orelse else []
        return [node]

    def stmt_With(self, node, loc, scope):
        prologue = []
        for item in node.items:
            item.context_expr = self.expr(item.context_expr, scope)
            if item.optional_vars is None:
                continue
            item.optional_vars, binds = self.unpack(item.optional_vars, loc, scope)
            prologue += binds
        node.body = prologue + self.block(node.body, scope)
        return [node]

    def unpack(self, target, loc, scope):
        """`(target, statements)` for a target Python binds itself (`for` and `with`): names stay
        and are reported; any other target binds a temporary that is then assigned through
        `assign_target`."""
        names, simple = _names_in_target(target)
        if simple:
            return target, self.bind_stmt(loc, scope, [name.id for name in names])
        temp = self.temp("u")
        return self.store(temp), self.assign_target(target, self.load(temp), loc, scope)

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
