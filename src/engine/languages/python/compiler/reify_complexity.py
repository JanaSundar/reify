"""Describes the cost-relevant shape of a Python program for the static complexity estimate:
which loops run over which sizes, which built-ins scan or sort, which user functions are
called and how they recurse. It does no arithmetic; `core/analysis/staticEstimate.ts` turns
the shape into an estimate and its explanation, the same way for every language.

`complexity_shape(tree)` returns a `CostShape` dict. Sizes are named by their source: a
collection (`xs`), a bound (`n`), or None when unknown.
"""

import ast
import re

LABEL_LIMIT = 48

# Built-in functions that consume a whole iterable (O(n) per call). Lazy ones (`range`,
# `map`, `zip`, `enumerate`) cost nothing until a loop iterates them.
LINEAR_FUNCTIONS = frozenset(
    {"sum", "min", "max", "any", "all", "list", "tuple", "set", "frozenset", "dict"}
    | {"Counter", "deque", "heapify"}
)
SORT_FUNCTIONS = frozenset({"sorted"})
SORT_METHODS = frozenset({"sort"})
# Methods that scan their receiver (`join` scans its argument).
LINEAR_METHODS = frozenset(
    {"index", "count", "remove", "insert", "copy", "extend", "reverse"}
    | {"split", "replace", "find", "rfind"}
)
# Wrappers whose size is their first argument's: `for i, x in enumerate(xs)` runs over xs.
SAME_SIZE_FUNCTIONS = frozenset(
    {"len", "enumerate", "reversed", "sorted", "list", "set", "tuple", "iter", "zip"}
)
SAME_SIZE_METHODS = frozenset({"items", "keys", "values", "copy"})
MEMO_DECORATORS = frozenset({"cache", "lru_cache"})
MEMO_NAME = re.compile(r"memo|cache|^dp$", re.IGNORECASE)

FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)
LOOPS = (ast.For, ast.AsyncFor, ast.While)
COMPREHENSIONS = (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)


def _label(node):
    text = " ".join(ast.unparse(node).split())
    return text if len(text) <= LABEL_LIMIT else text[: LABEL_LIMIT - 1] + "…"


def _number(node, value):
    return isinstance(node, ast.Constant) and type(node.value) is int and node.value == value


def _halves(op, right):
    return (isinstance(op, (ast.FloorDiv, ast.Div, ast.Mult)) and _number(right, 2)) or (
        isinstance(op, (ast.RShift, ast.LShift)) and _number(right, 1)
    )


def is_halving(node):
    """`n // 2`, `n / 2`, `n * 2`, `n >> 1`, or the augmented forms."""
    if isinstance(node, ast.BinOp):
        return _halves(node.op, node.right)
    return isinstance(node, ast.AugAssign) and _halves(node.op, node.value)


def some_descendant(node, predicate, stop_at=lambda _: False):
    if predicate(node):
        return True
    return any(
        not stop_at(child) and some_descendant(child, predicate, stop_at)
        for child in ast.iter_child_nodes(node)
    )


def size_of(node):
    """The size an expression stands for, by source name: `xs`, `len(xs)`, `range(n)` and
    `enumerate(xs)` name their collection or bound; None when it cannot be told."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Call):
        func = node.func
        if isinstance(func, ast.Name) and node.args:
            if func.id == "range":
                return size_of(node.args[0] if len(node.args) == 1 else node.args[1])
            if func.id in SAME_SIZE_FUNCTIONS:
                return size_of(node.args[0])
        if isinstance(func, ast.Attribute) and func.attr in SAME_SIZE_METHODS:
            return size_of(func.value)
        return None
    if isinstance(node, ast.Subscript):
        return size_of(node.value) if isinstance(node.slice, ast.Slice) else _label(node)
    if isinstance(node, ast.BinOp):
        return size_of(node.left) or size_of(node.right)
    if isinstance(node, ast.Attribute):
        return _label(node)
    return None


def _alias_of(value):
    """The size a value copies or measures: `ys = sorted(xs)`, `n = len(xs)`, `zs = xs[1:]`."""
    if isinstance(value, ast.Name):
        return value.id
    if isinstance(value, ast.Call) and value.args and isinstance(value.func, ast.Name):
        return size_of(value) if value.func.id in SAME_SIZE_FUNCTIONS else None
    if isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute):
        return size_of(value) if value.func.attr in SAME_SIZE_METHODS else None
    if isinstance(value, ast.Subscript) and isinstance(value.slice, ast.Slice):
        return size_of(value)
    return None


def aliases(statements):
    """`{name: size}` for names assigned another size in these statements (not in nested
    functions)."""
    found = {}

    def visit(node):
        if isinstance(node, FUNCTIONS):
            return
        target = None
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            target = node.target
        if isinstance(target, ast.Name):
            alias = _alias_of(node.value)
            if alias is not None and alias != target.id:
                found[target.id] = alias
        for child in ast.iter_child_nodes(node):
            visit(child)

    for statement in statements:
        visit(statement)
    return found


def _while_size(node, halving):
    """What a `while` loop runs over: the name it halves, or the bound in its test."""
    if halving:
        for child in ast.walk(node):
            if isinstance(child, ast.AugAssign) and is_halving(child) and isinstance(child.target, ast.Name):
                return child.target.id
        return None  # e.g. `while lo <= hi: mid = (lo + hi) // 2`
    test = node.test
    if isinstance(test, ast.Compare) and len(test.comparators) == 1:
        return size_of(test.comparators[0])  # `i < len(xs)`, `i < n`
    if isinstance(test, (ast.Name, ast.Call, ast.Attribute)):
        return size_of(test)  # `while queue:`, `while len(stack):`
    return None


def _measured_as(found, name):
    """`found` with built-ins of unknown size measured as `name`: in `a = sorted([4, 2, 3])`
    the sort's size is the size of `a`."""
    return [
        {**node, "over": name} if node["kind"] == "scan" and node["over"] is None else node
        for node in found
    ]


def _decorator_name(node):
    if isinstance(node, ast.Call):
        node = node.func
    if isinstance(node, ast.Attribute):
        return node.attr
    return node.id if isinstance(node, ast.Name) else None


def _key(fn):
    return f"{fn.name}@{fn.lineno}"


class ShapeBuilder:
    def __init__(self, tree):
        self.tree = tree
        in_class = {
            id(statement)
            for node in ast.walk(tree)
            if isinstance(node, ast.ClassDef)
            for statement in node.body
        }
        # User functions by name, split by whether a class defines them: `f(...)` calls a
        # function, `obj.f(...)` a method.
        self.functions, self.methods = {}, {}
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                (self.methods if id(node) in in_class else self.functions)[node.name] = node

    def resolve(self, func):
        if isinstance(func, ast.Name):
            return self.functions.get(func.id)
        if isinstance(func, ast.Attribute):
            return self.methods.get(func.attr)
        return None

    def build(self):
        functions = {
            **{_key(fn): self.function(fn, method=False) for fn in self.functions.values()},
            **{_key(fn): self.function(fn, method=True) for fn in self.methods.values()},
        }
        return {
            "body": self.nodes(self.tree.body),
            "functions": functions,
            "aliases": aliases(self.tree.body),
        }

    # ------------------------------------------------------------------ nodes

    def nodes(self, list_):
        return [found for node in list_ for found in self.node(node)]

    def node(self, node):
        if isinstance(node, FUNCTIONS):
            return []  # a definition costs nothing until called
        if isinstance(node, (ast.For, ast.AsyncFor)):
            label = f"for {_label(node.target)} in {_label(node.iter)}"
            body = self.nodes([node.target, *node.body, *node.orelse])
            loop = self.loop(node, label, size_of(node.iter), body, self.halves(node))
            return [*self.node(node.iter), loop]
        if isinstance(node, ast.While):
            halving = self.halves(node)
            body = self.nodes([node.test, *node.body, *node.orelse])
            label = f"while {_label(node.test)}"
            return [self.loop(node, label, _while_size(node, halving), body, halving)]
        if isinstance(node, COMPREHENSIONS):
            return self.comprehension(node)
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            return [*self.nodes([node.targets[0]]), *_measured_as(self.node(node.value), node.targets[0].id)]
        if isinstance(node, ast.Call):
            return self.call(node)
        if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Slice):
            return [*self.nodes(ast.iter_child_nodes(node)), self.scan(node, size_of(node.value))]
        return self.nodes(ast.iter_child_nodes(node))

    def halves(self, loop):
        return some_descendant(
            loop,
            is_halving,
            lambda n: isinstance(n, FUNCTIONS) or (isinstance(n, LOOPS) and n is not loop),
        )

    @staticmethod
    def loop(node, label, over, body, halving):
        return {
            "kind": "loop",
            "line": node.lineno,
            "label": label,
            "over": over,
            "halving": halving,
            "body": body,
        }

    def scan(self, node, over, sort=False, each=()):
        return {
            "kind": "scan",
            "line": node.lineno,
            "label": _label(node),
            "over": over,
            "sort": sort,
            "each": list(each),
        }

    def comprehension(self, node):
        # `[e for a in xs for b in ys if c]` is a loop per `for`, the innermost last; only
        # the outermost iterable is evaluated once, before the loops.
        results = [node.key, node.value] if isinstance(node, ast.DictComp) else [node.elt]
        body = self.nodes(results)
        for level, generator in reversed(list(enumerate(node.generators))):
            inner = [*self.nodes(generator.ifs), *body]
            if level > 0:
                inner = [*self.nodes([generator.iter]), *inner]
            label = f"for {_label(generator.target)} in {_label(generator.iter)}"
            body = [self.loop(node, label, size_of(generator.iter), inner, halving=False)]
        return [*self.nodes([node.generators[0].iter]), *body]

    def call(self, node):
        func = node.func
        receiver = self.nodes([func.value]) if isinstance(func, ast.Attribute) else []
        found = receiver + self.nodes([*node.args, *(k.value for k in node.keywords)])
        user = self.resolve(func)
        if user is None:
            return found + self.builtin(node)
        call = {
            "kind": "call",
            "line": node.lineno,
            "label": _label(node),
            "fn": _key(user),
            "args": [size_of(arg) for arg in node.args],
        }
        return [*found, call]

    def builtin(self, node):
        func = node.func
        first = node.args[0] if node.args else None
        if isinstance(func, ast.Name):
            if func.id in SORT_FUNCTIONS and first is not None:
                return [self.scan(node, size_of(first), sort=True, each=self.key_work(node))]
            if func.id in LINEAR_FUNCTIONS and first is not None:
                return [self.scan(node, size_of(first))]
            return []
        if not isinstance(func, ast.Attribute):
            return []
        if func.attr in SORT_METHODS:
            return [self.scan(node, size_of(func.value), sort=True, each=self.key_work(node))]
        if func.attr == "join" and first is not None:
            return [self.scan(node, size_of(first))]
        pops_front = func.attr == "pop" and first is not None and _number(first, 0)
        if func.attr in LINEAR_METHODS or pops_front:
            return [self.scan(node, size_of(func.value))]
        return []

    def key_work(self, node):
        key = next((k.value for k in node.keywords if k.arg == "key"), None)
        return self.nodes([key.body]) if isinstance(key, ast.Lambda) else []

    # ------------------------------------------------------------------ functions

    def function(self, fn, method):
        params = [*fn.args.posonlyargs, *fn.args.args]
        static = any(_decorator_name(d) == "staticmethod" for d in fn.decorator_list)
        if method and params and not static:
            params = params[1:]  # `self` / `cls`
        calls = self.self_calls(fn)
        return {
            "name": fn.name,
            "params": [param.arg for param in params],
            "recursion": self.recursion(fn, calls),
            "selfCalls": len(calls),
            "body": self.nodes(fn.body),
            "aliases": aliases(fn.body),
        }

    def recursion(self, fn, calls):
        if not calls:
            return "none"
        halving = any(
            some_descendant(arg, lambda n: is_halving(n) or (isinstance(n, ast.Name) and n.id == "mid"))
            for call in calls
            for arg in [*call.args, *(k.value for k in call.keywords)]
        )
        if len(calls) == 1:
            return "halving" if halving else "linear"
        if halving:
            return "split"
        return "memoized" if self.looks_memoized(fn) else "exponential"

    def self_calls(self, fn):
        """Calls of `fn` inside itself, not entering nested functions."""
        found = []

        def visit(node):
            if node is not fn and isinstance(node, FUNCTIONS):
                return
            if isinstance(node, ast.Call) and self.resolve(node.func) is fn:
                found.append(node)
            for child in ast.iter_child_nodes(node):
                visit(child)

        visit(fn)
        return found

    def looks_memoized(self, fn):
        if any(_decorator_name(d) in MEMO_DECORATORS for d in fn.decorator_list):
            return True
        return some_descendant(
            fn,
            lambda n: (
                isinstance(n, ast.Compare) and any(isinstance(op, (ast.In, ast.NotIn)) for op in n.ops)
            )
            or (isinstance(n, ast.Name) and MEMO_NAME.search(n.id) is not None),
        )


def complexity_shape(tree):
    """`CostShape` for a parsed module (read only: call it before instrumenting)."""
    return ShapeBuilder(tree).build()
