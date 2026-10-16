# ADR 0002: Python support with Pyodide

**Status:** proposed (2026-10-16)

## Context

Reify traces JavaScript and TypeScript by instrumenting the source with Babel and running it
natively in a fresh worker. Python needs an interpreter in the browser. Whichever one we pick
has to run real Python semantics (people practise the same code they submit elsewhere), allow
precise tracing, and fit the existing compiler-worker / runtime-worker split.

| Option                            | Semantics                  | Stdlib                    | Notes                                                          |
| --------------------------------- | -------------------------- | ------------------------- | -------------------------------------------------------------- |
| **Pyodide** (CPython 3.14 → WASM) | Real CPython               | Full (`collections`, ...) | Mature. Largest download. Exposes a JS bridge to lock down.    |
| RustPython (Rust → WASM)          | Reimplementation, gaps     | Partial                   | Describes itself as not production-ready. Slower than CPython. |
| MicroPython (WASM)                | Subset, differs in details | Minimal                   | Small and fast to load, but not the Python people submit.      |
| Brython / Skulpt (Python → JS)    | Approximate                | Partial                   | Translated to JS, so behaviour drifts from CPython.            |

## Decision

- **Interpreter: Pyodide**, pinned to an exact 314.0.x release and self-hosted from
  `public/pyodide/`, copied from the `pyodide` npm package at build time. Self-hosting keeps
  versions reproducible and lets a future CSP use `script-src 'self'`. No packages are loaded at
  runtime: only the bundled stdlib.
- **Tracing: source instrumentation with CPython's own `ast`**, following the JavaScript
  rules in `architecture.md` (wrap values, capture before writing, balanced frames, location
  tables, reject rather than mislead). Parsing with the same CPython that runs the code means
  there is no grammar version skew. `sys.monitoring` was considered. It needs no rewriting, but
  assignments and writes would have to be found by diffing locals and the heap on every line,
  which is slower and cannot say which write happened.
- **v1 tracer in pure Python, behind a seam; Rust later.** The spike measured the hot path
  (see "Spike results"): calling the hooks costs little, and building and handing over events
  costs a lot. v1 appends event words to an `array("i")`. The seam is the hook protocol plus
  that word format, so a Rust (PyO3) extension built for Pyodide can replace the tracer later
  without touching the instrumenter or the JS decoder. That is the Rust/WASM step ADR 0001
  reserves for a measured hot path.

## Design

### Engine (`src/engine/languages/python/`)

- **Compiler** (`PythonCompiler`, compiler worker): loads Pyodide once per session and runs
  `instrument.py` there. That script parses with `ast`, reports `SyntaxError` and unsupported
  constructs as `Diagnostic`s with ranges, builds the `locs` and `bindings` tables
  (`ProgramInfo`), and returns `ast.unparse` of the instrumented tree as `code`. Injected
  calls carry integer loc and binding ids, exactly like JS.
- **Runtime** (`PythonRuntime`, fresh runtime worker): loads Pyodide, installs the tracer,
  locks the interpreter down and runs `code` synchronously, which fits
  `LanguageRuntime.execute`.
- **Tracer** (`tracer.py`, Python): implements the injected hooks (`ln`, `br`, `lt`, `en`,
  `rt`, `ex`, `lv`, `a`, `w`, `m`, `ck`, `dr`), declared once in a `pythonTraceApi` table
  shared by the instrumenter and the tracer. It encodes each event as integer words in an
  `array("i")`, with strings interned in a per-run table, and hands JS **one buffer per flush**.
  JS reads the buffer through `getBuffer("i32")` with no per-event proxies, decodes the words
  into `TraceEvent`s (one decoder, in `languages/python`) and feeds `TraceRecorder.emit`, so
  the binary codec for worker → main transfer stays in one place.
- **Budgets**: limits raise inside Python as `ReifyLimit(BaseException)`, so `except
  Exception` cannot catch them, and every `except` prologue (`ck`) re-raises once the tracer is
  poisoned. Step and depth counting therefore lives in the Python tracer, with limits passed in
  from `ExecutionLimits`. This mirror of `TraceRecorder`'s rules is the one deliberate
  duplication, and it is covered by the same budget tests.

### Instrumentation rules for Python

| Construct                       | Rewritten as                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| any statement                   | `__r.ln(L)` before it                                                                               |
| `if t:` / `while t:`            | `if __r.br(L, t):` / `while __r.lt(L, t):`                                                          |
| `for x in it:`                  | header `ln` per iteration, then `__r.a(L, b, x)` at the top of the body                             |
| `x = e`, `x += e`, unpacking    | the original statement, then `__r.a(L, b1, x1, ...)` (names are bound by then)                      |
| `o[k] = v`, `o.f = v`           | `__v = v; __o = o; __k = k; __o[__k] = __v; __r.w(L, __o, __k)` (CPython order: value, object, key) |
| `xs.append(v)`, `heappush`, ... | `__r.m(L, (__o := xs), "append", __o.append(v))`                                                    |
| function body                   | `__r.en(...)`; `try: body` / `except BaseException as e: __r.ex(L, e); raise` / `finally: __r.lv()` |
| `return e`                      | `return __r.rt(L, e)`                                                                               |
| `except E as e:`                | `__r.ck(L, b, e)` first (re-raises `ReifyLimit`)                                                    |
| `del x`                         | `__r.dr(b)` after it                                                                                |
| `print(...)`                    | `builtins.print` replaced so output becomes `Console` events                                        |

Python has function scope only, so `Drop` comes from `del`, not block exits. Temporaries use
the `__r` prefix and the tracer hides them from frames.

**Supported in v1:** functions, recursion, closures (`nonlocal`), classes and instances,
`for`/`while`/`else`, `try`/`except`/`finally`, `with`, `match`, f-strings, lambdas,
decorators (`functools.cache`, ...), and imports from an allowlist: `collections`, `heapq`,
`bisect`, `math`, `itertools`, `functools`, `typing`, `dataclasses`, `string`, `re`,
`random` (seeded).
**Rejected in v1:** `async`/`await`, generators (`yield`), `exec`/`eval`/`compile`, and any
other import.
**Warned (partially traced):** comprehensions and generator expressions are recorded as a
single expression, with no step per iteration.

### Values

| Python                                | Heap kind               | Notes                                                                                                                                           |
| ------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `int`, `float`, `str`, `bool`, `None` | primitive               | Display text is `True`, `None`, `'abc'`; `None` is type `null`                                                                                  |
| `list`, `tuple`, `deque`              | `list` (`typeName` set) |                                                                                                                                                 |
| `dict`, `defaultdict`, `Counter`      | `map`                   |                                                                                                                                                 |
| `set`, `frozenset`                    | `set`                   |                                                                                                                                                 |
| class instances                       | `instance`              | Read from `__dict__`/`__slots__` directly, so properties and `__getattr__` never run. `ListNode`/`TreeNode` are recognised by the existing viz. |
| functions, classes                    | `callable`              |                                                                                                                                                 |
| anything else                         | `opaque`                | Summary from the type name, never `repr()` of user objects                                                                                      |

Heap ids come from `id()`. The tracer keeps a reference to every object it has seen so ids
are never reused. Encoding is iterative and capped by `maxCollectionItems` and
`maxObjectsPerCapture`.

### Protocol changes (small, language-neutral)

- `BindingKind`: add `"local"` and `"nonlocal"`; `"global"` already exists.
- Runtime worker: post `{ type: "ready" }` once its language runtime has loaded. The
  coordinator starts the execution timer on `ready` (with a separate load timeout), so a
  3-second Pyodide start-up does not eat the 10-second run budget.
- Prewarm by language: the spare runtime worker is told which runtime to load (today it
  always warms JavaScript).

### Workspace and UI

- Declare the languages once as an `as const` list (id, label, badge, extensions) and derive
  `languageOf`, `withExtension`, the language menu and the badges from it (today they are
  hard-coded in `files.ts` and `Workspace.tsx`).
- `.py` files; `@codemirror/lang-python` in `CodeEditor`.
- Python versions of the examples and a Python starter suite. Test `args` and `expected` are
  already "expressions in the program's language", so Python evaluates them.
- Tests: each case gets a fresh module namespace. The comparison is `==` plus an exact type
  match for `list`/`tuple`. `inputSize` is computed in Python (`len` of sequences, node
  count, or the largest int).
- A first-run loading state ("Loading Python...") while Pyodide downloads.

### Security (update `security.md`)

Pyodide gives Python a bridge to JavaScript (`import js`, `pyodide.ffi`), so before user code
runs the runtime:

1. removes `js`, `pyodide_js`, `_pyodide`, `pyodide.ffi` and `micropip` from `sys.modules`
   and installs a `sys.meta_path` finder that refuses them and anything outside the import
   allowlist;
2. disables `loadPackage`;
3. runs the existing `lockdownGlobals` on the worker.

This stays best effort, just as for JS: the worker is the boundary, and `terminate()` still
stops `while True: pass`.

## Spike results (phase 0, 2026-10-16)

Pyodide 314.0.7, self-hosted from `public/pyodide/314.0.7/` (`scripts/copy-pyodide.mjs`),
spike page `/spike/pyodide`. Browser figures are from the in-app Chromium against `next dev`;
Node figures are from Node 26.

| Measure                                                           | Result                                      |
| ----------------------------------------------------------------- | ------------------------------------------- |
| Download (`pyodide.mjs`, `.asm.mjs`, `.asm.wasm`, stdlib, lock)   | 13.5 MB raw, 6.3 MB gzip, **5.5 MB brotli** |
| Fresh worker → Pyodide ready, HTTP cache warm (browser, 5 runs)   | **1.14–1.18 s**                             |
| Load in Node (cold / second instance)                             | 1.38 s / 1.07 s                             |
| `fib(25)` plain                                                   | 12 ms                                       |
| `fib(25)` traced, word-buffer tracer (485,570 steps, 3.6 M words) | **≈ 570 ms** (browser), 737 ms (Node)       |
| `ReifyLimit(BaseException)` escapes `except Exception`            | yes                                         |

Where the tracing time goes (Node, `fib(25)`): hook calls that do nothing take 57 ms. Building
event tuples in Python takes 271 ms. Converting those tuples to JS with `toJs()` takes
1,697 ms in total, which is why v1 hands over an `array("i")` buffer (737 ms). A run at the default
200,000-step budget costs about 40% of these figures.

Findings that change the design:

- **Turbopack runs `type: "module"` workers as classic scripts** (its chunk loader uses
  `importScripts`, in dev and in production builds). Pyodide 314 refuses classic workers.
  The runtime hides `importScripts` while Pyodide loads, the same capability
  `lockdownGlobals` removes later, and imports `pyodide.mjs` from `public/` with
  `turbopackIgnore`. Dynamic `import()` works in that worker.
- **Caching**: `public/` files are served with `max-age=0`, so every fresh worker revalidates
  13 MB. The path is versioned, so add `Cache-Control: public, max-age=31536000, immutable`
  for `/pyodide/:path*` in `next.config.ts`.
- **Go/no-go**: traced `fib(25)` is far inside the 3 s target. Warm start-up is 1.15 s, just
  over the 1 s target. The spare-worker prewarm hides it after the first run, and Pyodide's
  memory snapshots (`_makeSnapshot` / `_loadSnapshot`) are the lever if it needs to shrink.
  **Go.**
- Not yet measured: a cold download over a real network, compression on Vercel, and Safari
  or Firefox.

## Plan

0. **Spike: done** (see "Spike results").
1. **Plumbing.** The single language list, `.py` files, `lang-python`, registry entries, the
   `ready` message, language-aware prewarm, the load timeout, immutable caching for
   `/pyodide/`, and copying Pyodide as part of `dev`/`build`. Coordinator tests with fakes.
2. **Compiler.** `instrument.py` and `PythonCompiler`: diagnostics, tables, rewriting. Unit
   tests on source → (diagnostics, tables, instrumented code).
3. **Runtime and tracer.** Value encoding, batching, budgets, console, outcomes, lockdown.
   Differential tests under Vitest, using Pyodide in Node: instrumented and plain runs must
   print the same output and raise the same errors for a Python DSA corpus and for
   fast-check-generated programs.
4. **Tests and complexity.** `runTest`, `inputSize`, and the measured complexity, which works
   unchanged. A static complexity port over Python's `ast` comes later; until then
   `ProgramInfo.complexity` is `null`.
5. **Polish.** Examples, loading UX, benchmarks in `performance.md`, and updates to
   `architecture.md` and `security.md`.

## Consequences

- Python is a multi-megabyte, one-time download (cached by the browser), loaded only when a
  `.py` file runs. JS users pay nothing.
- Each run starts a fresh Pyodide in a fresh worker, for isolation. The spare-worker prewarm
  hides that start-up for every run after the first.
- Tracing overhead is Python-speed event encoding, about 1.2 µs per step in the browser.
  The tracer seam lets a Rust (PyO3) tracer replace it if real programs need more.
