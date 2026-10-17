"""Editor intelligence for Python: completions and hover text.

Everything comes from the syntax tree and from `dir()` of built-in types and a short list of
standard-library modules. User code is never executed. Positions in and out are UTF-16 offsets
(what the editor uses); the code works on `str` indexes in between.
"""

import ast
import builtins
import importlib
import inspect
import json
import keyword
import re

from reify_instrument import syntax_diagnostics

# Imported on demand for attribute completion. Only plain library modules: importing must
# never print, open windows or touch the network.
SAFE_MODULES = frozenset(
    "math random string itertools functools collections heapq bisect re json datetime time "
    "typing dataclasses enum statistics decimal fractions operator copy textwrap sys os "
    "abc array calendar cmath contextlib queue struct types".split()
)

# A value of each built-in type, only ever passed to `dir()` and `callable()`.
SAMPLES = {
    "str": "",
    "list": [],
    "dict": {},
    "set": set(),
    "tuple": (),
    "int": 0,
    "float": 0.0,
    "bool": True,
    "bytes": b"",
}

# Methods whose result type is certain; keeps `"a b".split().` and `x.strip().` useful.
STR_RETURNING = frozenset(
    "capitalize casefold center expandtabs format join ljust lower lstrip replace rjust "
    "rstrip strip swapcase title translate upper zfill".split()
)
LIST_RETURNING = frozenset({"split", "splitlines", "rsplit"})

MAX_COMPLETIONS = 80
MAX_DEPTH = 8
IDENTIFIER_BEFORE = re.compile(r"[^\W\d]\w*$|$")


# ---------------------------------------------------------------- positions


def _index(source, offset):
    """UTF-16 offset to `str` index."""
    units = 0
    for i, char in enumerate(source):
        if units >= offset:
            return i
        units += 2 if ord(char) > 0xFFFF else 1
    return len(source)


def _utf16(text):
    return len(text) + sum(1 for char in text if ord(char) > 0xFFFF)


def _node_index(source, lineno, byte_col):
    """`str` index of a node position (CPython columns are UTF-8 bytes)."""
    lines = source.split("\n")
    line = lines[lineno - 1] if 1 <= lineno <= len(lines) else ""
    column = len(line.encode("utf-8")[:byte_col].decode("utf-8", errors="ignore"))
    return sum(len(text) + 1 for text in lines[: lineno - 1]) + column


# ---------------------------------------------------------------- scopes


class Binding:
    __slots__ = ("kind", "node", "value")

    def __init__(self, kind, node=None, value=None):
        self.kind = kind
        self.node = node
        self.value = value


class Scope:
    def __init__(self, node, names):
        self.node = node
        self.names = names

    @property
    def is_class(self):
        return isinstance(self.node, ast.ClassDef)


class _Collector(ast.NodeVisitor):
    """The names one scope binds. Nested functions, classes and comprehensions are not entered."""

    def __init__(self):
        self.names = {}

    def add(self, name, kind, node=None, value=None):
        self.names[name] = Binding(kind, node, value)

    def visit_FunctionDef(self, node):
        self.add(node.name, "function", node)

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        self.add(node.name, "class", node)

    def visit_Lambda(self, node):
        pass

    visit_ListComp = visit_SetComp = visit_DictComp = visit_GeneratorExp = visit_Lambda

    def visit_Import(self, node):
        for alias in node.names:
            bound = alias.asname or alias.name.split(".")[0]
            self.add(bound, "module", node, alias.name if alias.asname else bound)

    def visit_ImportFrom(self, node):
        for alias in node.names:
            if alias.name != "*":
                self.add(alias.asname or alias.name, "import", node)

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Store):
            self.add(node.id, "variable", node)

    def visit_Assign(self, node):
        self.generic_visit(node)
        for target in node.targets:
            if isinstance(target, ast.Name):
                self.add(target.id, "variable", node, node.value)

    def visit_AnnAssign(self, node):
        self.generic_visit(node)
        if isinstance(node.target, ast.Name):
            self.add(node.target.id, "variable", node, node.value)

    def visit_ExceptHandler(self, node):
        if node.name:
            self.add(node.name, "variable", node)
        self.generic_visit(node)


def _bindings(body, params=None):
    collector = _Collector()
    for statement in body:
        collector.visit(statement)
    if params is not None:
        for arg in _all_args(params):
            collector.add(arg.arg, "parameter", arg)
    return collector.names


def _all_args(arguments):
    found = [*arguments.posonlyargs, *arguments.args, *arguments.kwonlyargs]
    return [*found, *[a for a in (arguments.vararg, arguments.kwarg) if a]]


def scope_chain(tree, line):
    """Module scope first, then every function or class scope that contains `line`."""
    chain = [Scope(tree, _bindings(tree.body))]
    body = tree.body
    while True:
        inner = next(
            (
                node
                for node in body
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
                and node.lineno <= line <= (node.end_lineno or node.lineno)
            ),
            None,
        )
        if inner is None:
            return chain
        params = None if isinstance(inner, ast.ClassDef) else inner.args
        chain.append(Scope(inner, _bindings(inner.body, params)))
        body = inner.body


def lookup(chain, name):
    """The binding `name` refers to from the innermost scope (class scopes only when innermost)."""
    for depth, scope in enumerate(reversed(chain)):
        if scope.is_class and depth > 0:
            continue
        if name in scope.names:
            return scope, scope.names[name]
    return None, None


# ---------------------------------------------------------------- types


def _builtin_type(name):
    return ("builtin", name) if name in SAMPLES else None


def _enclosing_class(chain, scope):
    index = chain.index(scope)
    return chain[index - 1].node if index > 0 and chain[index - 1].is_class else None


def infer(node, chain, depth=0):
    """What `node` evaluates to, as `("builtin", name)`, `("module", name)` or
    `("class", ClassDef, is_instance)`; None when it cannot be told without running the code."""
    if depth > MAX_DEPTH:
        return None
    if isinstance(node, ast.Constant):
        return _builtin_type(type(node.value).__name__)
    if isinstance(node, ast.JoinedStr):
        return ("builtin", "str")
    containers = {
        ast.List: "list", ast.ListComp: "list", ast.Dict: "dict", ast.DictComp: "dict",
        ast.Set: "set", ast.SetComp: "set", ast.Tuple: "tuple",
    }  # fmt: skip
    for kind, name in containers.items():
        if isinstance(node, kind):
            return ("builtin", name)
    if isinstance(node, ast.Name):
        return _infer_name(node.id, chain, depth)
    if isinstance(node, ast.Call):
        return _infer_call(node, chain, depth)
    if isinstance(node, ast.Attribute):
        owner = infer(node.value, chain, depth + 1)
        if owner and owner[0] == "class":
            value = class_attributes(owner[1], chain).get(node.attr)
            return infer(value, chain, depth + 1) if value is not None else None
    return None


def _infer_name(name, chain, depth):
    scope, binding = lookup(chain, name)
    if binding is None:
        return _builtin_type(name) if name in SAMPLES else None
    if binding.kind == "module":
        return ("module", binding.value)
    if binding.kind == "class":
        return ("class", binding.node, False)
    if binding.kind == "variable" and binding.value is not None:
        return infer(binding.value, chain, depth + 1)
    if binding.kind == "parameter":
        function = scope.node
        owner = _enclosing_class(chain, scope)
        first = _all_args(function.args)[:1]
        if owner is not None and first and first[0] is binding.node:
            return ("class", owner, True)
        annotation = binding.node.annotation
        if isinstance(annotation, ast.Name):
            return _infer_annotation(annotation.id, chain)
    return None


def _infer_annotation(name, chain):
    _, binding = lookup(chain, name)
    if binding is not None and binding.kind == "class":
        return ("class", binding.node, True)
    return _builtin_type(name) if binding is None else None


def _infer_call(node, chain, depth):
    function = node.func
    if isinstance(function, ast.Name):
        _, binding = lookup(chain, function.id)
        if binding is None:
            known = {"input": "str", "len": "int", "sorted": "list", "repr": "str", "str": "str"}
            result = known.get(function.id) or (function.id if function.id in SAMPLES else None)
            return _builtin_type(result) if result else None
        if binding.kind == "class":
            return ("class", binding.node, True)
        if binding.kind == "function" and isinstance(binding.node.returns, ast.Name):
            return _infer_annotation(binding.node.returns.id, chain)
        return None
    if isinstance(function, ast.Attribute):
        owner = infer(function.value, chain, depth + 1)
        if owner == ("builtin", "str"):
            if function.attr in STR_RETURNING:
                return ("builtin", "str")
            if function.attr in LIST_RETURNING:
                return ("builtin", "list")
    return None


def class_attributes(node, chain, seen=None):
    """name -> assigned value node (or None) for a user class: its body, `self.x = ...` in its
    methods, and the user-defined classes it inherits from."""
    seen = seen or set()
    if id(node) in seen:
        return {}
    seen.add(id(node))
    attributes = {}
    for base in node.bases:
        if isinstance(base, ast.Name):
            _, binding = lookup(chain, base.id)
            if binding is not None and binding.kind == "class":
                attributes.update(class_attributes(binding.node, chain, seen))
    for statement in node.body:
        if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            attributes[statement.name] = None
            if isinstance(statement, ast.ClassDef):
                continue
            for inner in ast.walk(statement):
                for target, value in _self_stores(inner, statement):
                    attributes[target] = value
    for name, binding in _bindings(
        [s for s in node.body if not isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef))]
    ).items():
        attributes[name] = binding.value
    return attributes


def _self_stores(node, function):
    first = _all_args(function.args)[:1]
    if not first or not isinstance(node, (ast.Assign, ast.AnnAssign)):
        return
    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
    for target in targets:
        if (
            isinstance(target, ast.Attribute)
            and isinstance(target.value, ast.Name)
            and target.value.id == first[0].arg
        ):
            yield target.attr, getattr(node, "value", None)


def _builtin_base(node):
    """Built-in classes a user class inherits from (`Exception`, `dict`, ...)."""
    return [
        getattr(builtins, base.id)
        for base in node.bases
        if isinstance(base, ast.Name) and inspect.isclass(getattr(builtins, base.id, None))
    ]


# ---------------------------------------------------------------- completions


def _public(name, wants_private):
    return wants_private or not name.startswith("_")


def _member_kind(value):
    if inspect.isclass(value):
        return "class"
    if inspect.ismodule(value):
        return "namespace"
    if callable(value):
        return "method"
    return "property"


def members(kind, chain, wants_private):
    """(name, completion type) pairs for attributes of an inferred type."""
    tag = kind[0]
    if tag == "builtin":
        sample = SAMPLES[kind[1]]
        return [
            (name, _member_kind(getattr(sample, name, None)))
            for name in dir(sample)
            if _public(name, wants_private)
        ]
    if tag == "module" and kind[1] in SAFE_MODULES:
        module = importlib.import_module(kind[1])
        return [
            (name, _member_kind(getattr(module, name, None)))
            for name in dir(module)
            if _public(name, wants_private)
        ]
    if tag == "class":
        found = {}
        for base in _builtin_base(kind[1]):
            for name in dir(base):
                if _public(name, wants_private):
                    found[name] = _member_kind(getattr(base, name, None))
        for name, value in class_attributes(kind[1], chain).items():
            if _public(name, wants_private):
                is_method = any(
                    isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef)) and s.name == name
                    for s in ast.walk(kind[1])
                )
                found[name] = "method" if is_method else "property"
        return sorted(found.items())
    return []


def _receiver(text):
    """The expression just before a trailing dot (`a.b(c)` of `a.b(c).`), or None."""
    i = len(text) - 1
    depth = 0
    while i >= 0:
        char = text[i]
        if char in ")]}":
            depth += 1
        elif char in "([{":
            if depth == 0:
                break
            depth -= 1
        elif char in "'\"" and depth == 0 and i == len(text) - 1:
            quote_start = text.rfind(char, 0, i)
            if quote_start < 0:
                return None
            i = quote_start
        elif depth == 0 and not (char.isalnum() or char in "_."):
            break
        i -= 1
    receiver = text[i + 1 :].strip()
    return receiver or None


def _repaired_tree(source, index):
    """The tree with the cursor's line replaced by `pass`: the line being typed rarely parses."""
    lines = source.split("\n")
    line_no = source.count("\n", 0, index)
    line = lines[line_no]
    lines[line_no] = line[: len(line) - len(line.lstrip())] + "pass"
    try:
        return ast.parse("\n".join(lines)), line_no + 1
    except SyntaxError:
        return None, line_no + 1


def _builtin_names():
    names = []
    for name in dir(builtins):
        if name.startswith("_"):
            continue
        value = getattr(builtins, name)
        kind = "class" if inspect.isclass(value) else "function" if callable(value) else "constant"
        names.append((name, kind))
    return names


BUILTINS = _builtin_names()
BINDING_TYPES = {
    "function": "function",
    "class": "class",
    "module": "namespace",
    "import": "variable",
    "parameter": "variable",
    "variable": "variable",
}


def complete(source, offset, explicit):
    index = _index(source, offset)
    before = source[:index]
    prefix = IDENTIFIER_BEFORE.search(before).group(0)
    head = before[: len(before) - len(prefix)]
    dotted = head.endswith(".")
    if not prefix and not dotted and not explicit:
        return None
    tree, line = _repaired_tree(source, index)
    chain = scope_chain(tree, line) if tree is not None else None

    # (name, completion type, rank): lower ranks are offered first.
    options = []
    if dotted:
        receiver = _receiver(head[:-1])
        kind = None
        if receiver and chain is not None:
            try:
                kind = infer(ast.parse(receiver, mode="eval").body, chain)
            except SyntaxError:
                kind = None
        if kind is not None:
            options = [(n, t, 0) for n, t in members(kind, chain, prefix.startswith("_"))]
    else:
        seen = set()
        if chain is not None:
            for depth, scope in enumerate(reversed(chain)):
                if scope.is_class and depth > 0:
                    continue
                for name, binding in scope.names.items():
                    if name not in seen:
                        seen.add(name)
                        options.append((name, BINDING_TYPES[binding.kind], 0))
        options += [(n, t, 1) for n, t in BUILTINS if n not in seen]
        options += [(k, "keyword", 2) for k in keyword.kwlist + keyword.softkwlist]
    wanted = prefix.lower()
    matches = sorted((o for o in options if wanted in o[0].lower()), key=lambda o: (o[2], o[0]))
    if not matches:
        return None
    return {
        "from": _utf16(source[: index - len(prefix)]),
        "options": [
            {"label": name, "type": kind, **({} if kind == "keyword" else {"detail": kind})}
            for name, kind, _ in matches[:MAX_COMPLETIONS]
        ],
    }


# ---------------------------------------------------------------- hover


def _first_line(text):
    return (inspect.cleandoc(text).splitlines() or [""])[0] if text else ""


def _describe_builtin(name, value):
    try:
        signature = str(inspect.signature(value))
    except (TypeError, ValueError):
        signature = "(...)"
    if inspect.isclass(value):
        return f"class {name}{signature}", _first_line(value.__doc__)
    if callable(value):
        return f"def {name}{signature}", _first_line(value.__doc__)
    return f"{name}: {type(value).__name__}", ""


def _describe_binding(name, scope, binding, chain):
    node = binding.node
    if binding.kind == "function":
        prefix = "async def" if isinstance(node, ast.AsyncFunctionDef) else "def"
        returns = f" -> {ast.unparse(node.returns)}" if node.returns else ""
        return f"{prefix} {name}({ast.unparse(node.args)}){returns}", _first_line(
            ast.get_docstring(node)
        )
    if binding.kind == "class":
        bases = f"({', '.join(ast.unparse(b) for b in node.bases)})" if node.bases else ""
        return f"class {name}{bases}", _first_line(ast.get_docstring(node))
    if binding.kind == "module":
        return f"module {binding.value}", ""
    kind = infer(ast.Name(id=name, ctx=ast.Load()), chain)
    label = "parameter" if binding.kind == "parameter" else "variable"
    return f"({label}) {name}{': ' + _type_text(kind) if kind else ''}", ""


def _type_text(kind):
    if kind[0] == "builtin":
        return kind[1]
    if kind[0] == "module":
        return f"module {kind[1]}"
    return kind[1].name if kind[2] else f"type[{kind[1].name}]"


def hover(source, offset):
    index = _index(source, offset)
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None
    found = None
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            start = _node_index(source, node.lineno, node.col_offset)
            end = _node_index(source, node.end_lineno, node.end_col_offset)
        elif isinstance(node, ast.Attribute):
            end = _node_index(source, node.end_lineno, node.end_col_offset)
            start = end - len(node.attr)
        else:
            continue
        if start <= index <= end and (found is None or end - start < found[2] - found[1]):
            found = (node, start, end)
    if found is None:
        return None
    node, start, end = found
    chain = scope_chain(tree, node.lineno)
    text = documentation = None
    if isinstance(node, ast.Name):
        scope, binding = lookup(chain, node.id)
        if binding is not None:
            text, documentation = _describe_binding(node.id, scope, binding, chain)
        elif hasattr(builtins, node.id):
            text, documentation = _describe_builtin(node.id, getattr(builtins, node.id))
    else:
        owner = infer(node.value, chain)
        text, documentation = _describe_attribute(owner, node.attr, chain)
    if not text:
        return None
    result = {"from": _utf16(source[:start]), "to": _utf16(source[:end]), "text": text}
    if documentation:
        result["documentation"] = documentation
    return result


def _describe_attribute(owner, attribute, chain):
    if owner is None:
        return None, None
    if owner[0] == "builtin":
        value = getattr(SAMPLES[owner[1]], attribute, None)
        return _describe_builtin(f"{owner[1]}.{attribute}", value) if value is not None else (None, None)
    if owner[0] == "module" and owner[1] in SAFE_MODULES:
        value = getattr(importlib.import_module(owner[1]), attribute, None)
        return _describe_builtin(f"{owner[1]}.{attribute}", value) if value is not None else (None, None)
    if owner[0] == "class":
        for statement in owner[1].body:
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)) and statement.name == attribute:
                returns = f" -> {ast.unparse(statement.returns)}" if statement.returns else ""
                return (
                    f"def {owner[1].name}.{attribute}({ast.unparse(statement.args)}){returns}",
                    _first_line(ast.get_docstring(statement)),
                )
        kind = infer(class_attributes(owner[1], chain).get(attribute), chain) if attribute in class_attributes(owner[1], chain) else None
        return (f"(property) {attribute}{': ' + _type_text(kind) if kind else ''}", "")
    return None, None


# ---------------------------------------------------------------- entry points


def diagnostics_json(source):
    return json.dumps(syntax_diagnostics(source))


def complete_json(source, offset, explicit):
    return json.dumps(complete(source, offset, explicit))


def hover_json(source, offset):
    return json.dumps(hover(source, offset))
