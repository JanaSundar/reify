import { describe, expect, it } from "vitest";
import {
  parseCompilerMessage,
  parseRuntimeMessage,
  parseWarmRequest,
  type CompilerWorkerMessage,
  type RuntimeWorkerMessage,
} from "@/engine/core/protocol/messages";
import { decodeEvents } from "@/engine/core/protocol/eventCodec";
import { handleCompile, handleExecute } from "@/engine/workers/handlers";
import { TEST_LIMITS } from "../helpers";

describe("worker handlers", () => {
  it("compile → execute round trip streams batched events and a done message", async () => {
    const compiled: CompilerWorkerMessage[] = [];
    await handleCompile(
      {
        type: "compile",
        runId: 3,
        languageId: "typescript",
        source: "const xs: number[] = [1, 2];\nfor (const x of xs) console.log(x * 2);",
      },
      (m) => compiled.push(m),
      () => 0,
    );
    expect(compiled[0]).toEqual({ type: "ready", runId: 3 });
    const response = compiled[1]!;
    expect(response).toMatchObject({ type: "compiled", runId: 3, result: { ok: true } });
    if (response.type !== "compiled" || !response.result.ok) return;

    const messages: RuntimeWorkerMessage[] = [];
    const transfers: ArrayBuffer[][] = [];
    let lockedDown = false;
    await handleExecute(
      {
        type: "execute",
        runId: 3,
        languageId: "typescript",
        code: response.result.code,
        limits: { ...TEST_LIMITS, batchSize: 4 },
      },
      {
        post: (m, transfer) => {
          messages.push(m);
          transfers.push(transfer);
        },
        now: () => 0,
        lockdown: () => (lockedDown = true),
      },
    );
    expect(lockedDown).toBe(true);
    // `ready` comes first: the coordinator starts the execution budget on it.
    expect(messages[0]).toEqual({ type: "ready", runId: 3 });
    const batches = messages.filter((m) => m.type === "events");
    expect(batches.length).toBeGreaterThan(1);
    for (const [i, m] of messages.entries()) {
      if (m.type !== "events") continue;
      expect(decodeEvents(m.batch).length).toBeLessThanOrEqual(4);
      expect(transfers[i]).toEqual([m.batch.buffer]);
    }
    expect(messages.at(-1)).toMatchObject({ type: "done", runId: 3, outcome: { kind: "ok" } });
  });

  it("reports unknown languages as failures", async () => {
    const out: CompilerWorkerMessage[] = [];
    await handleCompile(
      { type: "compile", runId: 1, languageId: "cobol", source: "" },
      (m) => out.push(m),
      () => 0,
    );
    expect(out[0]).toMatchObject({ type: "failure", runId: 1 });
  });

  it("validates warm requests and ready messages", () => {
    expect(parseWarmRequest({ type: "warm", languageId: "python" })).toEqual({
      type: "warm",
      languageId: "python",
    });
    expect(parseWarmRequest({ type: "warm" })).toBeNull();
    expect(parseWarmRequest({ type: "execute", languageId: "python" })).toBeNull();
    expect(parseRuntimeMessage({ type: "ready", runId: 4 })).toEqual({ type: "ready", runId: 4 });
    expect(parseRuntimeMessage({ type: "ready" })).toBeNull();
    expect(parseCompilerMessage({ type: "ready", runId: 4 })).toEqual({ type: "ready", runId: 4 });
  });
});
