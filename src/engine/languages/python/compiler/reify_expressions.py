"""Rewrites inside expressions: mutating calls, walrus bindings, and constructs that are
rejected or only partly traced.
"""

import ast

from reify_protocol import Api


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
