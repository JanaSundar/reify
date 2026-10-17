/**
 * Single source of truth for the calls injected by the JavaScript instrumentation and
 * implemented by the JavaScript tracer. Short names keep instrumented code compact.
 */
export const TRACER_PARAM = "__lc$t";
export const CONSOLE_PARAM = "console";
/** Where the runtime leaves the tracer for the modules of a project (see `docs/multi-file-projects.md`). */
export const TRACER_GLOBAL = "__reify_tracer";

export const TraceApi = {
  /** `ln(loc)` — statement starts. */
  line: "ln",
  /** `lt(loc, test)` — loop header re-check: line + branch, returns test. */
  loopTest: "lt",
  /** `br(loc, test)` — condition evaluated, returns test. */
  branch: "br",
  /** `en(loc, name, b1, v1, ...)` — function entered with parameter bindings. */
  enter: "en",
  /** `rt(loc, value)` — return value recorded, returns value. */
  ret: "rt",
  /** `ex(loc, error)` — exception leaves the current function. */
  unwind: "ex",
  /** `lv()` — function frame left (from `finally`). */
  leave: "lv",
  /** `d(loc, b1, v1, ...)` — bindings declared. */
  declare: "d",
  /** `d1(loc, b, value)` — single binding declared, returns value (for-loop init). */
  declareOne: "d1",
  /** `a(loc, result, b1, v1, ...)` — bindings assigned after `result` evaluated; returns result. */
  assign: "a",
  /** `w(loc, object, key, result)` — `object[key]` written; returns result. */
  write: "w",
  /** `pw(loc, result, o1, k1, ...)` — member targets of a destructuring assignment; returns result. */
  patternWrite: "pw",
  /** `m(loc, object, op, result)` — `object` mutated by a method call; returns result. */
  mutate: "m",
  /** `ck(loc, binding, error)` — catch entered; re-throws fatal errors, declares the param. */
  caught: "ck",
  /** `dr(b1, b2, ...)` — block-scoped bindings leave scope. */
  drop: "dr",
} as const;

export type TraceApiName = (typeof TraceApi)[keyof typeof TraceApi];

/** Binding id used when a construct has no traceable binding. */
export const NO_BINDING = -1;
