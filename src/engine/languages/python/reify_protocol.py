"""The small compiler/runtime contract installed in every Python interpreter.

The compiler uses these values while producing instrumented code; the runtime uses them
while interpreting that code. Keeping them here means runtime workers need not load the
full compiler merely to import a few constants.
"""

# The tracer object the runtime injects. Dunder names are never name-mangled in class bodies.
TRACER = "__reify__"
RESERVED_PREFIX = "__reify"
NO_BINDING = -1

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
