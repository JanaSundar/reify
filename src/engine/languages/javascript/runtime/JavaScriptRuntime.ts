import type { ExecutionLimits, RunOutcome } from "../../../core/protocol/limits";
import type { TraceRecorder } from "../../../core/runtime/TraceRecorder";
import type { LanguageRuntime } from "../../types";
import { CONSOLE_PARAM, TRACER_PARAM } from "../traceApi";
import { JsTracer } from "./JsTracer";

/** Executes instrumented JavaScript (sloppy-mode script semantics) with a tracer. */
export class JavaScriptRuntime implements LanguageRuntime {
  constructor(readonly languageId: string) {}

  execute(code: string, recorder: TraceRecorder, limits: ExecutionLimits): RunOutcome {
    const tracer = new JsTracer(recorder, limits);
    let program: (tracer: JsTracer, console: JsTracer["console"]) => unknown;
    try {
      program = new Function(TRACER_PARAM, CONSOLE_PARAM, code) as typeof program;
    } catch (error) {
      return { kind: "exception", message: `Could not load program: ${String(error)}`, loc: null };
    }
    try {
      program(tracer, tracer.console);
      return { kind: "ok" };
    } catch (error) {
      const limit = tracer.limitFor(error);
      if (limit) return { kind: "limit", limit: limit.limit, message: limit.message };
      const message = tracer.uncaught(error);
      return { kind: "exception", message, loc: tracer.currentLoc >= 0 ? tracer.currentLoc : null };
    }
  }
}
