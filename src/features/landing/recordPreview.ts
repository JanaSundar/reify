import type { TraceEvent } from "@/engine/core/protocol/events";
import { DEFAULT_LIMITS } from "@/engine/core/protocol/limits";
import { TraceRecorder } from "@/engine/core/runtime/TraceRecorder";
import { TraceStore } from "@/engine/core/trace/TraceStore";
import { JavaScriptRuntime } from "@/engine/languages/javascript/runtime/JavaScriptRuntime";
import type { CompiledPreview } from "./previewProgram";

/**
 * Runs the precompiled preview program with the real tracer and loads the recording into a
 * real trace store, exactly as the playground does (minus the worker: it's a few steps).
 */
export const recordPreview = (preview: CompiledPreview): TraceStore => {
  const events: TraceEvent[] = [];
  const recorder = new TraceRecorder(DEFAULT_LIMITS, (batch) => events.push(...batch));
  const outcome = new JavaScriptRuntime("javascript").execute(
    preview.code,
    recorder,
    DEFAULT_LIMITS,
  );
  recorder.close();
  const store = new TraceStore();
  store.begin(1, preview.program, preview.source);
  store.append(1, events);
  store.finish(1, outcome, null);
  return store;
};
