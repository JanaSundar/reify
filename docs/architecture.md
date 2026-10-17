# Architecture

Reify records what a user's program actually does and lets them replay it. The core
promise: **visualizations are derived from real execution, never from algorithm templates.**

## Subsystems and data flow

```
 Editor (CodeMirror 6) ──RUN──▶ XState execution machine ──invokes──▶ ExecutionCoordinator
                                         ▲                              │          │
                       lifecycle events  │                     compile  │          │ execute
                       (run id checked)  │                              ▼          ▼
                                         │                  compiler worker   runtime worker (fresh per run)
                                         │                  Babel: strip TS,  new Function + JsTracer,
                                         │                  check, instrument TraceRecorder (budgets, batching)
                                         │                              │          │ batched events
                                         └──────────────────────────────┴──────────▼
                                                                              TraceStore
                                                     event log · snapshots · position · step views
                                                                                  │ useSyncExternalStore
                                                                                  ▼
                                                     Inspector · call stack · facts · console · timeline
```

| Owner                                  | Holds                                                        | Never holds             |
| -------------------------------------- | ------------------------------------------------------------ | ----------------------- |
| XState machine (`src/machine`)         | lifecycle status, run id, progress counters, outcome/failure | trace events, snapshots |
| `TraceStore` (`src/engine/core/trace`) | events, snapshots, playback position, console lines          | lifecycle status        |
| React local state                      | open panels, playback speed, followed object                 | anything shared         |

## Modules

- `src/engine/core/protocol`: language-neutral contracts (values, events, program tables,
  limits, worker messages and their validators) and `eventCodec` (binary encoding of event
  batches: an `Int32Array` word stream sent as a transferable buffer plus a per-batch table of
  distinct strings).
- `src/engine/core/runtime`: `TraceRecorder` (budgets, batching, poisoning) and `lockdownGlobals`.
- `src/engine/core/trace`: `applyEvent` (state reducer), `buildStepView` (immutable view and
  facts), `TraceStore` (ingestion, snapshots, seeking, subscriptions).
- `src/engine/core/coordinator`: `ExecutionCoordinator` (one active run, workers, timeouts,
  cancellation, stale-message rejection).
- `src/engine/languages`: the seam for languages. `registry.ts` (workers) creates them lazily.
  A language provides a `LanguageCompiler` and a `LanguageRuntime`.
- `src/engine/languages/javascript`: the first adapter (JavaScript and TypeScript share it).
- `src/engine/workers`: thin worker entry points around the testable `handlers.ts`.
- `src/features/*`: UI. `src/app`: routes (static SEO pages plus the client-only playground).

`src/engine` must not import React, Next.js or UI code (enforced by oxlint).

## Steps

A _step_ begins at a `Line`, `Call` or `Return` event and includes every event until the next
one. The view shown for a step is the state **after** that step's events, with the step's facts
("Sets `i` to 1", "Condition on line 4 is true") and the changed variables and cells.

## Instrumentation (JavaScript)

Rules that keep instrumented code faithful to the original:

1. **Wrap values, never restructure control flow.** `if (t)` becomes `if (br(L, t))`, and
   `x = e` becomes `a(L, x = e, b, x)`. The original expression runs once, in its original order;
   `&&`, `||`, `??` and ternaries are untouched inside.
2. **Capture before writing.** `obj[key] op= v` becomes
   `(_o = obj, _k = key, w(L, _o, _k, _o[_k] op= v))`.
3. **Balanced frames.** Function bodies become
   `try { en(...); body } catch (e) { ex(L, e); throw e } finally { lv() }`.
4. **Block scopes.** Blocks and `for` headers that own `let`/`const` are wrapped in
   `try { ... } finally { dr(bindings) }`, so shadowed variables appear and disappear correctly.
5. **Locations are tables.** Injected calls carry small integer loc and binding ids; `ProgramInfo`
   maps them to original source ranges. TypeScript is stripped first while keeping original node
   locations, so highlights always point at the user's source.
6. **Reject rather than mislead.** Unsupported constructs fail compilation with a diagnostic;
   partially traced ones produce warnings (`src/engine/languages/javascript/compiler/checks.ts`).

Correctness is checked by differential tests (`tests/engine/differential.test.ts`): instrumented
and plain execution must print the same output and throw the same errors, for a corpus of DSA
programs and for randomly generated programs (fast-check).

## Values and the heap

Objects get stable ids on first sight (WeakMap). Encoding is shallow and iterative, so deep or
cyclic structures cannot overflow the stack, and it reads through property descriptors so user
getters never run during inspection. Single-slot writes are sent as `Write` deltas; bulk
mutations (`push`, `sort`, `Map.set`, ...) re-capture the object. Collections are capped
(`maxCollectionItems`) and report how many entries were omitted.

## Replay

Seeking clones the nearest snapshot at or before the target step and replays at most one
snapshot interval of events. Snapshot density halves automatically when `maxSnapshots` is
exceeded. Playback never re-runs user code.

## Visualization primitives

`src/features/viz` draws values from the recorded `StepView`; there is no second model of
runtime state. `ValueView` (inspector) picks the primitive from the heap object's runtime
kind: `ArrayView` (indexed cells, matrix for grids), `ObjectView` and `MapView` (shared
`EntryRows`: `:` for properties, `→` for typed map keys), `SetView` (value chips).

- **Changes** come from `StepView.mutations`: each object mutated in a step with its state
  before the step and the operation. `changesOf` turns that into added/updated entries,
  removals and "no change" (e.g. `Set.add` of a present value).
- **Identity**: map rows by key, set chips by value, object rows by name, nodes by heap id.
  List cells get presentation-only keys from `reconcileKeys` (permutations move cells, slot
  writes change values in place, length changes align with an LCS). Keys never feed back
  into runtime state, and `AnimatePresence` only keeps exiting elements visually.
- **Structures**: `recognizeStructure` infers linked lists (`next`) and trees
  (`left`/`right`, `children`) from shape only when every node matches, nothing is shared
  and the size is bounded; the UI labels them "inferred" and can show the plain object.
  Anything ambiguous stays an object.
- **Motion**: presets in `viz/atoms.tsx` (short tweens, no overshoot); reduced motion is
  honoured globally by `MotionProvider`.

## Adding a language

1. Implement `LanguageCompiler` and `LanguageRuntime` under `src/engine/languages/<id>/`,
   emitting the neutral events from `core/protocol`.
2. Register them in `registry.ts` and map the file extension to the language id in
   `languageOf` (`src/features/workspace/files.ts`).
3. Run the corpus through the shared differential harness for that language.

## Test cases

A test run reuses the compile step, then sends a `test` request to a fresh runtime worker.
For each case the JavaScript runtime builds a new program instance (so cases cannot share
state), evaluates the case's argument and expectation expressions in the program's scope,
calls the chosen function and compares the return value (or the first argument, for
in-place algorithms) with `deepEqual`. Budgets apply per case and no events are recorded
(`TraceRecorder` with a `null` sink). Each result streams back as a `test-result` message;
the machine keeps them in `context.testResults`. "Trace" on a case appends a call to the
source and records an ordinary trace.

## Complexity

- **Static** (`languages/javascript/compiler/complexity.ts`): walks the type-stripped AST;
  loops multiply by n (or log n when the range halves), calls inside loops multiply by the
  callee's cost, linear built-ins (`includes`, `shift`, `slice`, ...) count as O(n),
  `sort` as O(n log n), and recursion is classified by self-call count, halving arguments
  and memoization. The result is a language-neutral `ComplexityClass` with notes.
- **Measured** (`core/analysis/complexity.ts`): each test result carries the operations
  spent in the call and the input size n (elements, nodes and characters reachable from the
  arguments, or the largest numeric argument). `estimateComplexity` fits
  `steps ≈ a + b·f(n)` for each candidate class in log space and prefers the simpler class
  when fits are close. It needs at least three sizes spanning a 4× range.
