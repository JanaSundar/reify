"""Reify's Python tracer: the runtime half of `reify_instrument`. Runs inside Pyodide.

Each hook the instrumenter injects (`__reify__.ln(...)`, ...) turns a runtime fact into a
trace event. Events are buffered as compact lists and handed to JavaScript as one JSON
string per batch; `pythonEvents.ts` decodes them into protocol `TraceEvent`s. Event kinds
are the protocol's `EventKind` numbers.

Values are encoded without running user code: instances are read through their `__dict__`
and slots, collections through the builtin types' own methods, never `repr()` of user objects.

Budgets (steps, events, call depth) raise `ReifyLimit`, a `BaseException`, so
`except Exception` cannot catch it; once raised, the tracer is poisoned and every later hook
(including the prologue of every `except` clause) raises again.
"""

import builtins
import importlib
import json
import sys
import time
from collections import deque

from reify_protocol import ALLOWED_MODULES, NO_BINDING, RESERVED_PREFIX

# Captured before user code runs, so user code that rebinds builtins cannot change inspection.
_BaseException = builtins.BaseException
_bool = builtins.bool
_dict = builtins.dict
_float = builtins.float
_frozenset = builtins.frozenset
_int = builtins.int
_isinstance = builtins.isinstance
_len = builtins.len
_list = builtins.list
_repr = builtins.repr
_set = builtins.set
_str = builtins.str
_tuple = builtins.tuple
_type = builtins.type
_object_getattribute = object.__getattribute__
_print = builtins.print
_FunctionTypes = (_type(lambda: None), _type(len), _type([].append), _type(object.__init__))

# Protocol EventKind numbers (src/engine/core/protocol/events.ts).
LINE, CALL, RETURN, DECLARE, ASSIGN, WRITE, HEAP, BRANCH, DROP, CONSOLE, THROW = range(11)


class ReifyLimit(_BaseException):
    """A budget was exhausted. `kind` is the protocol's `LimitKind`."""

    def __init__(self, kind):
        super().__init__(kind)
        self.kind = kind


def _type_name(value):
    try:
        return _type(value).__name__
    except _BaseException:
        return "object"


def describe(error):
    """`TypeName: message`, the way CPython prints the last line of a traceback."""
    name = _type_name(error)
    try:
        text = _str(error)
    except _BaseException:
        text = ""
    return f"{name}: {text}" if text else name


class Frame:
    __slots__ = ("id", "loc", "return_loc", "return_value", "threw", "declared")

    def __init__(self, frame_id, loc, declared):
        self.id = frame_id
        self.loc = loc
        self.return_loc = None
        self.return_value = None
        self.threw = False
        self.declared = declared


class Encoder:
    """Python values → protocol `EncodedValue`s; new objects become heap events."""

    def __init__(self, tracer, limits):
        self.tracer = tracer
        self.max_items = limits["maxCollectionItems"]
        self.max_objects = limits["maxObjectsPerCapture"]
        self.max_string = limits["maxStringLength"]
        self.ids = {}  # id(obj) -> heap id
        self.keep = []  # keeps encoded objects alive, so `id()` values are never reused
        self.next_id = 1

    # ---------------------------------------------------------------- primitives

    def _truncate(self, text):
        return text if _len(text) <= self.max_string else text[: self.max_string] + "…"

    def primitive(self, value):
        """The encoded form of a primitive, or None when `value` belongs in the heap."""
        if value is None:
            return ["null", "None"]
        kind = _type(value)
        if kind is _bool:
            return ["boolean", "True" if value else "False"]
        if kind is _int:
            try:
                text = _int.__repr__(value)
            except ValueError:  # beyond CPython's int → str digit limit
                text = "<very large int>"
            return ["number", self._truncate(text)]
        if kind is _float:
            return ["number", _float.__repr__(value)]
        if kind is _str:
            return ["string", _str.__repr__(self._truncate(value))]
        return None

    def encode(self, value):
        found = self.primitive(value)
        if found is not None:
            return found
        known = self.ids.get(id(value))
        if known is not None:
            return known
        return self.capture_new(value)

    # ---------------------------------------------------------------- heap

    def register(self, value):
        heap_id = self.next_id
        self.next_id += 1
        self.ids[id(value)] = heap_id
        self.keep.append(value)
        return heap_id

    def capture_new(self, value, via=None):
        heap_id = self.register(value)
        pending = deque()
        self.tracer.emit_heap(self.snapshot(value, heap_id, pending), via)
        self.drain(pending)
        return heap_id

    def recapture(self, value, via=None):
        """Re-captures an object after it changed in bulk (method call, `del`, ...)."""
        if self.primitive(value) is not None:
            return
        heap_id = self.ids.get(id(value))
        if heap_id is None:
            self.capture_new(value, via)
            return
        pending = deque()
        self.tracer.emit_heap(self.snapshot(value, heap_id, pending), via)
        self.drain(pending)

    def drain(self, pending):
        budget = self.max_objects
        while pending:
            value, heap_id = pending.popleft()
            budget -= 1
            if budget < 0:
                summary = {"id": heap_id, "kind": "opaque", "typeName": _type_name(value)}
                summary["summary"] = "not captured yet"
                self.tracer.emit_heap(summary, None)
                continue
            self.tracer.emit_heap(self.snapshot(value, heap_id, pending), None)

    def child(self, value, pending):
        found = self.primitive(value)
        if found is not None:
            return found
        heap_id = self.ids.get(id(value))
        if heap_id is None:
            heap_id = self.register(value)
            pending.append((value, heap_id))
        return heap_id

    def snapshot(self, value, heap_id, pending):
        type_name = _type_name(value)
        base = {"id": heap_id, "typeName": type_name}
        limit = self.max_items
        if _isinstance(value, (_list, _tuple, deque)):
            size = _len(value)
            take = (_list.__getitem__(value, slice(0, limit)) if _isinstance(value, _list)
                    else _tuple.__getitem__(value, slice(0, limit)) if _isinstance(value, _tuple)
                    else [deque.__getitem__(value, i) for i in range(min(size, limit))])
            items = [self.child(item, pending) for item in take]
            return self._omitted({**base, "kind": "list", "items": items}, size - _len(items))
        if _isinstance(value, _dict):
            size = _len(value)
            entries = []
            for key, item in _dict.items(value):
                if _len(entries) >= limit:
                    break
                entries.append([self.child(key, pending), self.child(item, pending)])
            return self._omitted({**base, "kind": "map", "entries": entries}, size - _len(entries))
        if _isinstance(value, (_set, _frozenset)):
            size = _len(value)
            items = []
            for item in (_set.__iter__(value) if _isinstance(value, _set) else _frozenset.__iter__(value)):
                if _len(items) >= limit:
                    break
                items.append(self.child(item, pending))
            return self._omitted({**base, "kind": "set", "items": items}, size - _len(items))
        if _isinstance(value, _type):
            return {**base, "kind": "callable", "typeName": "class", "name": value.__name__}
        if _isinstance(value, _FunctionTypes) or _type(value).__name__ in ("builtin_function_or_method", "method"):
            return {**base, "kind": "callable", "name": self._callable_name(value)}
        if _isinstance(value, _BaseException):
            args = [self.child(arg, pending) for arg in value.args[:limit]]
            return {**base, "kind": "record", "fields": [["args", self._list_ref(args, pending)]]}
        if _isinstance(value, (bytes, bytearray, range, complex)) or _type(value).__module__ in (
            "builtins",
            "_functools",
            "functools",
            "itertools",
            "re",
            "_sre",
        ):
            return {**base, "kind": "opaque", "summary": self._opaque_summary(value, type_name)}
        fields = self._instance_fields(value)
        out = [[name, self.child(item, pending)] for name, item in fields[:limit]]
        return self._omitted({**base, "kind": "instance", "fields": out}, _len(fields) - _len(out))

    def _list_ref(self, items, pending):
        # Exception args are shown inline as a small tuple object of their own.
        heap_id = self.next_id
        self.next_id += 1
        holder = _tuple(items)
        self.keep.append(holder)
        self.tracer.emit_heap({"id": heap_id, "kind": "list", "typeName": "tuple", "items": items}, None)
        return heap_id

    @staticmethod
    def _callable_name(value):
        try:
            return _str(_object_getattribute(value, "__qualname__"))
        except _BaseException:
            try:
                return _str(_object_getattribute(value, "__name__"))
            except _BaseException:
                return "function"

    def _opaque_summary(self, value, type_name):
        if _isinstance(value, (bytes, bytearray, range, complex)):
            return self._truncate(_repr(value))  # builtin reprs: no user code
        return type_name

    @staticmethod
    def _instance_fields(value):
        fields = []
        try:
            attributes = _object_getattribute(value, "__dict__")
            if _isinstance(attributes, _dict):
                fields.extend(
                    (name, item)
                    for name, item in _dict.items(attributes)
                    if _isinstance(name, _str) and not name.startswith(RESERVED_PREFIX)
                )
        except AttributeError:
            pass
        for klass in _type(value).__mro__:
            namespace = klass.__dict__  # a mappingproxy: its `get` cannot be overridden
            slots = namespace.get("__slots__", ())
            for name in (slots,) if _isinstance(slots, _str) else slots:
                descriptor = namespace.get(name)
                if descriptor is None or name in ("__dict__", "__weakref__"):
                    continue
                try:
                    fields.append((name, descriptor.__get__(value, _type(value))))
                except AttributeError:
                    pass  # slot never assigned
        return fields

    @staticmethod
    def _omitted(snapshot, omitted):
        if omitted > 0:
            snapshot["omitted"] = omitted
        return snapshot

    # ---------------------------------------------------------------- writes

    def write(self, obj, key, loc):
        """Reports `obj[key]` / `obj.key` after a write, as a slot update when possible."""
        heap_id = self.ids.get(id(obj))
        if heap_id is None:
            self.recapture(obj)
            return
        if _isinstance(obj, _list) and _type(key) is _int:
            size = _list.__len__(obj)
            index = key + size if key < 0 else key
            if 0 <= index < min(size, self.max_items):
                self.tracer.emit(
                    [WRITE, loc, heap_id, index, self.encode(_list.__getitem__(obj, index))]
                )
                return
        elif _type(key) is _str and not _isinstance(obj, (_dict, _type)):
            try:
                attributes = _object_getattribute(obj, "__dict__")
            except AttributeError:
                attributes = None
            if _isinstance(attributes, _dict) and key in attributes:
                self.tracer.emit([WRITE, loc, heap_id, key, self.encode(attributes[key])])
                return
        self.recapture(obj, {"l": loc, "op": "write"})


class Tracer:
    """The `__reify__` object instrumented code calls. Hook names come from `Api`."""

    BaseException = _BaseException

    def __init__(self, flush, limits, recording):
        self._flush_js = flush
        self._recording = recording
        self._max_steps = limits["maxSteps"]
        self._max_events = limits["maxEvents"]
        self._max_depth = limits["maxCallDepth"]
        self._max_string = limits["maxStringLength"]
        self._batch_size = limits["batchSize"]
        self._encoder = Encoder(self, limits)
        self._buffer = []
        self._events = 0
        self._next_frame = 1
        self._global = Frame(0, -1, _set())
        self._frames = []
        self.steps = 0
        self.depth = 0
        self.peak_depth = 0
        self.last_loc = -1
        self.poisoned = None

    # ---------------------------------------------------------------- budgets and output

    def _fail(self, kind):
        if self.poisoned is None:
            self.poisoned = ReifyLimit(kind)
        raise self.poisoned

    def _step(self):
        if self.poisoned is not None:
            raise self.poisoned
        self.steps += 1
        if self.steps > self._max_steps:
            self._fail("steps")

    def emit(self, event):
        if not self._recording or self.poisoned is not None:
            return
        if self._events >= self._max_events:
            self._fail("events")
        self._events += 1
        self._buffer.append(event)
        if _len(self._buffer) >= self._batch_size:
            self.flush()

    def emit_heap(self, snapshot, via):
        if via is None:
            self.emit([HEAP, snapshot])
        else:
            self.emit([HEAP, snapshot, via["l"], via["op"]])

    def flush(self):
        if self._buffer:
            batch, self._buffer = self._buffer, []
            # ASCII escapes keep lone surrogates (valid in Python strings) intact for JSON.parse.
            self._flush_js(json.dumps(batch, separators=(",", ":")))

    def _frame(self):
        return self._frames[-1] if self._frames else self._global

    def _encode(self, value):
        return self._encoder.encode(value)

    # ---------------------------------------------------------------- control flow

    def ln(self, loc):
        self._step()
        self.last_loc = loc
        self.emit([LINE, loc])

    def lt(self, loc, test):
        self.ln(loc)
        return self.br(loc, test)

    def br(self, loc, test):
        # Returns the truth value itself: `if`/`while` only use truthiness, so the user's
        # `__bool__` runs exactly once, as in the original program.
        taken = _bool(test)
        self.emit([BRANCH, loc, 1 if taken else 0])
        return taken

    def en(self, loc, name, *pairs):
        if self.poisoned is not None:
            raise self.poisoned
        declared = _set(pairs[0::2])
        frame = Frame(self._next_frame, loc, declared)
        self._next_frame += 1
        self._frames.append(frame)
        self.depth += 1
        if self.depth > self.peak_depth:
            self.peak_depth = self.depth
        if self.depth > self._max_depth:
            self._fail("call-depth")
        self._step()
        self.last_loc = loc
        if self._recording:
            params = [[pairs[i], self._encode(pairs[i + 1])] for i in range(0, _len(pairs) - 1, 2)]
            self.emit([CALL, loc, frame.id, name, params])

    def rt(self, loc, value):
        frame = self._frame()
        frame.return_loc = loc
        frame.return_value = value
        return value

    def ex(self, loc, error):
        frame = self._frame()
        frame.threw = True
        if not self._recording or _isinstance(error, ReifyLimit) or self.poisoned is not None:
            return
        self.emit([THROW, self.last_loc if self.last_loc >= 0 else loc, self._encode(error), describe(error)])

    def lv(self):
        if not self._frames:
            return
        frame = self._frames.pop()
        self.depth -= 1
        if not self._recording or self.poisoned is not None:
            return
        value = self._encode(None if frame.threw else frame.return_value)
        loc = frame.return_loc if frame.return_loc is not None else frame.loc
        self.emit([RETURN, loc, frame.id, value, 1 if frame.threw else 0])
        frame.return_value = None

    def ck(self, loc, binding, error):
        if self.poisoned is not None:
            raise self.poisoned
        if error is None:
            error = sys.exception()
        if _isinstance(error, ReifyLimit):
            raise error
        if _isinstance(error, RecursionError):
            self._fail("call-depth")
        self.ln(loc)
        if binding != NO_BINDING:
            self._bind(loc, binding, error)

    # ---------------------------------------------------------------- bindings

    def _bind(self, loc, binding, value):
        if not self._recording:
            return
        frame = self._frame()
        encoded = self._encode(value)
        if binding in frame.declared:
            self.emit([ASSIGN, loc, binding, encoded])
        else:
            frame.declared.add(binding)
            self.emit([DECLARE, loc, binding, encoded])

    def a(self, loc, *pairs):
        for i in range(0, _len(pairs) - 1, 2):
            self._bind(loc, pairs[i], pairs[i + 1])

    def ao(self, loc, *pairs):
        # Names owned by an enclosing scope (`global` / `nonlocal`): always an assignment,
        # which the trace applies to whichever frame (or closure) holds the binding.
        if not self._recording:
            return
        for i in range(0, _len(pairs) - 1, 2):
            self.emit([ASSIGN, loc, pairs[i], self._encode(pairs[i + 1])])

    def a1(self, loc, binding, value):
        self._bind(loc, binding, value)
        return value

    def dr(self, loc, *bindings):
        frame = self._frame()
        for binding in bindings:
            frame.declared.discard(binding)
        self.emit([DROP, _list(bindings)])

    # ---------------------------------------------------------------- heap

    def w(self, loc, obj, key):
        if self._recording:
            self._encoder.write(obj, key, loc)

    def m(self, loc, obj, method):
        bound = getattr(obj, method)
        if not self._recording:
            return bound

        def call(*args, **kwargs):
            try:
                return bound(*args, **kwargs)
            finally:
                self._encoder.recapture(obj, {"l": loc, "op": method})

        return call

    def mf(self, loc, fn):
        if not self._recording:
            return fn
        op = getattr(fn, "__name__", "call")

        def call(*args, **kwargs):
            try:
                return fn(*args, **kwargs)
            finally:
                if args:
                    self._encoder.recapture(args[0], {"l": loc, "op": op})

        return call

    def mk(self, loc, obj, op):
        if self._recording:
            self._encoder.recapture(obj, {"l": loc, "op": op})

    # ---------------------------------------------------------------- output

    def console(self, text):
        if _len(text) > self._max_string:
            text = text[: self._max_string] + "…"
        self.emit([CONSOLE, self.last_loc, "log", text])

    def uncaught(self, error):
        message = describe(error)
        if self._recording and self.poisoned is None:
            self.emit([THROW, self.last_loc, self._encode(error), message])
        return message


def _make_print(tracer):
    def print(*args, sep=" ", end="\n", file=None, flush=False):
        if file is not None and file is not sys.stdout:
            return _print(*args, sep=sep, end=end, file=file, flush=flush)
        sep = " " if sep is None else sep
        end = "\n" if end is None else end
        text = sep.join(_str(arg) for arg in args)
        tracer.console(text if end == "\n" else text + end)

    return print


def _namespace(tracer):
    namespace = {"__name__": "__main__", "__builtins__": builtins.__dict__.copy()}
    namespace["__builtins__"]["print"] = _make_print(tracer)
    namespace["__reify__"] = tracer
    return namespace


def _outcome_for(error, tracer):
    if tracer.poisoned is not None or _isinstance(error, ReifyLimit):
        return {"kind": "limit", "limit": (tracer.poisoned or error).kind}
    if _isinstance(error, RecursionError):
        return {"kind": "limit", "limit": "call-depth"}
    return {
        "kind": "exception",
        "message": tracer.uncaught(error),
        "loc": tracer.last_loc if tracer.last_loc >= 0 else None,
    }


def execute(code, flush, limits_json):
    """Runs instrumented `code`, streaming events through `flush`. Returns outcome JSON."""
    limits = json.loads(limits_json)
    tracer = Tracer(flush, limits, recording=True)
    try:
        exec(compile(code, "<program>", "exec"), _namespace(tracer))
        outcome = {"kind": "ok"}
    except _BaseException as error:
        outcome = _outcome_for(error, tracer)
    try:
        tracer.flush()
    except _BaseException:
        pass
    return json.dumps({"outcome": outcome, "steps": tracer.steps})


# ------------------------------------------------------------------ test cases

MAX_WALK = 1_000_000
MAX_FORMAT_DEPTH = 6
MAX_FORMAT_ITEMS = 100


def measure_input_size(args):
    """Elements, nodes and characters reachable from the arguments; for purely numeric
    arguments (e.g. `fib(30)`), the largest of them. Mirrors the JavaScript runtime."""
    visited = _set()
    size = 0
    largest = 0
    structured = False
    stack = [(arg, True) for arg in reversed(args)]
    while stack and size <= MAX_WALK:
        value, top = stack.pop()
        if _isinstance(value, _str):
            structured = structured or top
            size += _len(value) if top else 1
            continue
        if value is None or _type(value) in (_bool, _int, _float):
            if top and _type(value) in (_int, _float) and value == value and abs(value) != _float("inf"):
                largest = max(largest, abs(_int(value)))
            elif not top:
                size += 1
            continue
        if id(value) in visited:
            continue
        visited.add(id(value))
        structured = True
        if _isinstance(value, (_list, _tuple, deque, _set, _frozenset)):
            stack.extend((item, False) for item in value)
        elif _isinstance(value, _dict):
            stack.extend((item, False) for item in _dict.values(value))
        elif not _isinstance(value, (_type, *_FunctionTypes)):
            size += 1
            for _, item in Encoder._instance_fields(value):
                if not (item is None or _type(item) in (_bool, _int, _float, _str)):
                    stack.append((item, False))
    return size if structured else largest


def deep_equal(a, b, seen=None):
    """Structural equality for test expectations: sequences in order (list and tuple alike),
    dicts and sets by content, instances by their fields (so a `ListNode` equals another
    with the same fields). Cycle-safe."""
    if a is b:
        return True
    if _type(a) is _float and _type(b) is _float and a != a and b != b:
        return True
    seen = _set() if seen is None else seen
    key = (id(a), id(b))
    if key in seen:
        return True
    primitive_types = (_bool, _int, _float, _str, _type(None), complex, bytes)
    if _isinstance(a, primitive_types) or _isinstance(b, primitive_types):
        return _type(a) in primitive_types and _type(b) in primitive_types and a == b
    seen.add(key)
    sequence = (_list, _tuple, deque)
    if _isinstance(a, sequence) or _isinstance(b, sequence):
        return (
            _isinstance(a, sequence)
            and _isinstance(b, sequence)
            and _len(a) == _len(b)
            and all(deep_equal(x, y, seen) for x, y in zip(a, b))
        )
    if _isinstance(a, _dict) or _isinstance(b, _dict):
        return (
            _isinstance(a, _dict)
            and _isinstance(b, _dict)
            and _len(a) == _len(b)
            and all(k in b and deep_equal(v, b[k], seen) for k, v in _dict.items(a))
        )
    if _isinstance(a, (_set, _frozenset)) or _isinstance(b, (_set, _frozenset)):
        return _isinstance(a, (_set, _frozenset)) and _isinstance(b, (_set, _frozenset)) and a == b
    if _isinstance(a, (_type, *_FunctionTypes)) or _isinstance(b, (_type, *_FunctionTypes)):
        return False
    fields_a = _dict(Encoder._instance_fields(a))
    fields_b = _dict(Encoder._instance_fields(b))
    if not fields_a and not fields_b:
        try:
            return _bool(a == b)
        except _BaseException:
            return False
    return fields_a.keys() == fields_b.keys() and all(
        deep_equal(v, fields_b[k], seen) for k, v in fields_a.items()
    )


def format_value(value, max_length, depth=0, seen=None):
    """Display text for test results; never calls user `__repr__`."""
    seen = _set() if seen is None else seen
    if value is None or _type(value) in (_bool, _int, _float, _str):
        text = _repr(value) if _type(value) is not _int else _int.__repr__(value)
        return text if _len(text) <= max_length else text[:max_length] + "…"
    if id(value) in seen:
        return "..."
    if depth > MAX_FORMAT_DEPTH:
        return f"<{_type_name(value)}>"
    seen = seen | {id(value)}

    def nested(item):
        return format_value(item, max_length, depth + 1, seen)

    if _isinstance(value, _list):
        text = "[" + ", ".join(nested(i) for i in value[:MAX_FORMAT_ITEMS]) + "]"
    elif _isinstance(value, _tuple):
        inner = ", ".join(nested(i) for i in value[:MAX_FORMAT_ITEMS])
        text = f"({inner},)" if _len(value) == 1 else f"({inner})"
    elif _isinstance(value, deque):
        text = "deque([" + ", ".join(nested(i) for i in _list(value)[:MAX_FORMAT_ITEMS]) + "])"
    elif _isinstance(value, _dict):
        items = _list(_dict.items(value))[:MAX_FORMAT_ITEMS]
        text = "{" + ", ".join(f"{nested(k)}: {nested(v)}" for k, v in items) + "}"
    elif _isinstance(value, (_set, _frozenset)):
        text = "{" + ", ".join(nested(i) for i in _list(value)[:MAX_FORMAT_ITEMS]) + "}" if value else "set()"
    elif _isinstance(value, _type):
        text = f"<class {value.__name__}>"
    elif _isinstance(value, _FunctionTypes):
        text = f"<function {Encoder._callable_name(value)}>"
    else:
        fields = Encoder._instance_fields(value)
        text = f"{_type_name(value)}(" + ", ".join(f"{k}={nested(v)}" for k, v in fields) + ")"
    return text if _len(text) <= max_length else text[:max_length] + "…"


def run_test(code, entry, target, args_source, expected_source, limits_json):
    """Runs one test case in a fresh namespace without recording events. Returns JSON with
    the `TestResult` fields this side knows (the caller adds the case id)."""
    limits = json.loads(limits_json)
    max_length = limits["maxStringLength"]
    tracer = Tracer(lambda batch: None, limits, recording=False)
    result = {"status": "error", "actual": None, "expected": None, "message": None,
              "steps": 0, "maxDepth": 0, "inputSize": None}

    def finish(**fields):
        result.update(fields)
        result["maxDepth"] = tracer.peak_depth
        return json.dumps(result)

    def failure(error, context):
        # Limits come back as `limit` (a LimitKind); the caller words the message.
        if tracer.poisoned is not None or _isinstance(error, ReifyLimit):
            return {"status": "limit", "limit": (tracer.poisoned or error).kind}
        if _isinstance(error, RecursionError):
            return {"status": "limit", "limit": "call-depth"}
        return {"message": f"{context}{describe(error)}"}

    namespace = _namespace(tracer)
    try:
        exec(compile(code, "<program>", "exec"), namespace)
    except _BaseException as error:
        return finish(**failure(error, "The program raised before the test ran: "))
    fn = namespace.get(entry)
    if not callable(fn):
        return finish(message=f"No function named “{entry}” was found.")
    try:
        args = eval(f"({args_source}\n,)" if args_source.strip() else "()", namespace)
        expected = eval(f"({expected_source}\n)", namespace)
    except SyntaxError as error:
        return finish(message=f"This test case is not valid Python: {error.msg}")
    except _BaseException as error:
        return finish(**failure(error, "Evaluating the test case raised: "))
    args = _list(args)
    input_size = measure_input_size(args)
    expected_text = format_value(expected, max_length)
    before = tracer.steps
    started = time.perf_counter()
    try:
        returned = fn(*args)
    except _BaseException as error:
        return finish(**failure(error, ""), steps=tracer.steps - before, inputSize=input_size,
                      expected=expected_text)
    elapsed = (time.perf_counter() - started) * 1000
    actual = args[0] if target == "first-argument" and args else returned
    return finish(
        status="pass" if deep_equal(actual, expected) else "fail",
        actual=format_value(actual, max_length),
        expected=expected_text,
        steps=tracer.steps - before,
        inputSize=input_size,
        ms=elapsed,
    )


# ------------------------------------------------------------------ lockdown

# Pyodide's bridges to JavaScript. User code must not reach the worker's JS globals.
BLOCKED_MODULES = ("js", "pyodide", "pyodide_js", "_pyodide", "micropip")


class _BlockBridges:
    """`sys.meta_path` finder that refuses Pyodide's JavaScript bridge modules."""

    @staticmethod
    def find_spec(name, path=None, target=None):
        if name.split(".")[0] in BLOCKED_MODULES:
            raise ImportError(f"`{name}` is not available.")
        return None


def lock_down():
    """Best effort, before user code runs: pre-imports the allowed modules (some need
    capabilities the worker lockdown removes, e.g. `random` seeds from `crypto`), then
    removes the JavaScript bridge modules and blocks importing them again."""
    for module in ALLOWED_MODULES:
        importlib.import_module(module)
    for name in _list(sys.modules):
        if name.split(".")[0] in BLOCKED_MODULES:
            del sys.modules[name]
    sys.meta_path.insert(0, _BlockBridges)
