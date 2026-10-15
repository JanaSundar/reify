import type { LimitKind } from "../protocol/limits";

/**
 * Thrown by the recorder when a budget is exhausted. Language runtimes must make sure user
 * code cannot swallow it (see `TraceRecorder.poisoned`).
 */
export class ResourceLimitError extends Error {
  override readonly name = "ResourceLimitError";

  constructor(
    readonly limit: LimitKind,
    message: string,
  ) {
    super(message);
  }
}

export const isResourceLimitError = (error: unknown): error is ResourceLimitError =>
  error instanceof ResourceLimitError;
