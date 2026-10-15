import { EventKind, type ConsoleLevel, type FrameId } from "../../../core/protocol/events";
import type { ExecutionLimits } from "../../../core/protocol/limits";
import type { BindingId, LocId } from "../../../core/protocol/program";
import { isResourceLimitError, ResourceLimitError } from "../../../core/runtime/ResourceLimitError";
import type { TraceRecorder } from "../../../core/runtime/TraceRecorder";
import type { EncodedValue } from "../../../core/protocol/values";
import { NO_BINDING } from "../traceApi";
import { JsValueEncoder } from "./JsValueEncoder";
import { describeThrown, formatConsoleArgs, isObjectLike } from "./jsValues";

interface Frame {
  readonly id: FrameId;
  readonly loc: LocId;
  returnLoc: LocId | null;
  returnValue: unknown;
  threw: boolean;
}

const isStackOverflow = (error: unknown): boolean =>
  error instanceof RangeError && /call stack/i.test(error.message);

/**
 * Runtime half of the JavaScript instrumentation. Method names match `TraceApi`; each is
 * called by injected code and turns runtime facts into protocol events.
 */
export class JsTracer {
  private readonly frames: Frame[] = [];
  private readonly encoder: JsValueEncoder;
  private nextFrameId = 1;
  private lastLoc: LocId = -1;

  /** Encoding is skipped entirely when the recorder does not record (test runs). */
  private readonly recording: boolean;

  constructor(
    private readonly recorder: TraceRecorder,
    limits: ExecutionLimits,
  ) {
    this.recording = recorder.recording;
    this.encoder = new JsValueEncoder(limits, {
      heap: (o, via) =>
        this.recorder.emit(via ? { k: EventKind.Heap, o, via } : { k: EventKind.Heap, o }),
      write: (id, key, v, l) => this.recorder.emit({ k: EventKind.Write, l, id, key, v }),
    });
    this.console = Object.freeze({
      log: (...args: unknown[]) => this.print("log", args),
      info: (...args: unknown[]) => this.print("info", args),
      warn: (...args: unknown[]) => this.print("warn", args),
      error: (...args: unknown[]) => this.print("error", args),
      debug: (...args: unknown[]) => this.print("debug", args),
    });
    this.maxLength = limits.maxStringLength;
  }

  /** Console object handed to user code in place of the real one. */
  readonly console: Readonly<Record<ConsoleLevel, (...args: unknown[]) => void>>;
  private readonly maxLength: number;

  get currentLoc(): LocId {
    return this.lastLoc;
  }

  // ---------------------------------------------------------------- control flow

  ln(l: LocId): void {
    this.recorder.step();
    this.lastLoc = l;
    this.recorder.emit({ k: EventKind.Line, l });
  }

  lt(l: LocId, test: unknown): unknown {
    this.ln(l);
    return this.br(l, test);
  }

  br(l: LocId, test: unknown): unknown {
    this.recorder.emit({ k: EventKind.Branch, l, taken: Boolean(test) });
    return test;
  }

  en(l: LocId, name: string, ...pairs: unknown[]): void {
    // Push first so the generated `finally { lv() }` always has a frame to pop.
    const frame: Frame = {
      id: this.nextFrameId++,
      loc: l,
      returnLoc: null,
      returnValue: undefined,
      threw: false,
    };
    this.frames.push(frame);
    this.recorder.enterFrame();
    this.recorder.step();
    this.lastLoc = l;
    if (!this.recording) return;
    this.recorder.emit({
      k: EventKind.Call,
      l,
      frame: frame.id,
      name,
      params: this.encodePairs(pairs),
    });
  }

  rt(l: LocId, value: unknown): unknown {
    const frame = this.frames.at(-1);
    if (frame) {
      frame.returnLoc = l;
      frame.returnValue = value;
    }
    return value;
  }

  ex(l: LocId, error: unknown): void {
    const frame = this.frames.at(-1);
    if (frame) frame.threw = true;
    if (!this.recording || isResourceLimitError(error) || this.recorder.poisoned) return;
    this.recorder.emit({
      k: EventKind.Throw,
      l: this.lastLoc >= 0 ? this.lastLoc : l,
      v: this.encoder.encode(error),
      message: describeThrown(error),
    });
  }

  lv(): void {
    const frame = this.frames.pop();
    this.recorder.leaveFrame();
    if (!frame || !this.recording) return;
    const value = frame.threw
      ? this.encoder.encode(undefined)
      : this.encoder.encode(frame.returnValue);
    this.recorder.emit({
      k: EventKind.Return,
      l: frame.returnLoc ?? frame.loc,
      frame: frame.id,
      value,
      threw: frame.threw,
    });
  }

  ck(l: LocId, binding: BindingId, error: unknown): void {
    if (this.recorder.poisoned) throw this.recorder.poisoned;
    if (isResourceLimitError(error)) throw error;
    if (isStackOverflow(error))
      this.recorder.fail(new ResourceLimitError("call-depth", "Maximum call stack size exceeded."));
    this.ln(l);
    if (this.recording && binding !== NO_BINDING) {
      this.recorder.emit({ k: EventKind.Declare, l, b: binding, v: this.encoder.encode(error) });
    }
  }

  // ---------------------------------------------------------------- bindings

  d(l: LocId, ...pairs: unknown[]): void {
    if (!this.recording) return;
    for (const [b, v] of this.encodePairs(pairs))
      this.recorder.emit({ k: EventKind.Declare, l, b, v });
  }

  d1(l: LocId, b: BindingId, value: unknown): unknown {
    if (!this.recording) return value;
    this.recorder.emit({ k: EventKind.Declare, l, b, v: this.encoder.encode(value) });
    return value;
  }

  a(l: LocId, result: unknown, ...pairs: unknown[]): unknown {
    if (!this.recording) return result;
    for (const [b, v] of this.encodePairs(pairs))
      this.recorder.emit({ k: EventKind.Assign, l, b, v });
    return result;
  }

  dr(...bindings: BindingId[]): void {
    this.recorder.emit({ k: EventKind.Drop, b: bindings });
  }

  // ---------------------------------------------------------------- heap

  w(l: LocId, object: unknown, key: unknown, result: unknown): unknown {
    if (this.recording) this.encoder.write(object, key, l);
    return result;
  }

  pw(l: LocId, result: unknown, ...targets: unknown[]): unknown {
    if (!this.recording) return result;
    for (let i = 0; i + 1 < targets.length; i += 2)
      this.encoder.write(targets[i], targets[i + 1], l);
    return result;
  }

  m(l: LocId, op: string, result: unknown, object: unknown = result): unknown {
    if (this.recording && isObjectLike(object)) this.encoder.recapture(object, { l, op });
    return result;
  }

  // ---------------------------------------------------------------- program level

  /** Reports an exception that escaped the program. */
  uncaught(error: unknown): string {
    const message = describeThrown(error);
    this.recorder.emit({
      k: EventKind.Throw,
      l: this.lastLoc,
      v: this.encoder.encode(error),
      message,
    });
    return message;
  }

  /** Converts a native stack overflow into a resource-limit failure, if applicable. */
  limitFor(error: unknown): ResourceLimitError | null {
    if (this.recorder.poisoned) return this.recorder.poisoned;
    if (isResourceLimitError(error)) return error;
    if (isStackOverflow(error))
      return new ResourceLimitError("call-depth", "Maximum call stack size exceeded.");
    return null;
  }

  private print(level: ConsoleLevel, args: readonly unknown[]): void {
    if (!this.recording) return;
    this.recorder.emit({
      k: EventKind.Console,
      l: this.lastLoc,
      level,
      text: formatConsoleArgs(args, this.maxLength),
    });
  }

  private encodePairs(pairs: readonly unknown[]): Array<[BindingId, EncodedValue]> {
    const out: Array<[BindingId, EncodedValue]> = [];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      out.push([pairs[i] as BindingId, this.encoder.encode(pairs[i + 1])]);
    }
    return out;
  }
}
