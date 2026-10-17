import { describe, expect, it } from "vitest";
import { estimateComplexity, formatComplexity } from "@/engine/core/analysis/complexity";
import { JavaScriptCompiler } from "@/engine/languages/javascript/compiler/JavaScriptCompiler";
import { handleTest } from "@/engine/workers/handlers";
import type { RuntimeWorkerMessage } from "@/engine/core/protocol/messages";
import { STARTER_SOURCE, STARTER_SUITE } from "@/features/workspace/draft";
import {
  addCase,
  detectFunctionNames,
  removeCase,
  samplesOf,
  summarize,
  traceSourceFor,
  updateCase,
} from "@/features/tests/suite";
import { TEST_LIMITS, trace } from "../helpers";

describe("suite helpers", () => {
  it("detects declared functions", () => {
    const source =
      "function a() {}\nconst b = (x) => x;\nlet c = function () {};\nconst d = async x => x;\nconst notFn = 3;";
    expect(detectFunctionNames(source, "javascript")).toEqual(["a", "b", "c", "d"]);
  });

  it("edits cases immutably", () => {
    const added = addCase(STARTER_SUITE);
    expect(added.cases).toHaveLength(STARTER_SUITE.cases.length + 1);
    const id = added.cases.at(-1)!.id;
    const updated = updateCase(added, id, { args: "1" });
    expect(updated.cases.at(-1)?.args).toBe("1");
    expect(added.cases.at(-1)?.args).toBe("");
    expect(removeCase(updated, id).cases).toHaveLength(STARTER_SUITE.cases.length);
  });

  it("builds a traceable program for one case", () => {
    const run = trace(
      traceSourceFor(STARTER_SOURCE, STARTER_SUITE, STARTER_SUITE.cases[0]!, "javascript"),
    );
    expect(run.output.at(-1)).toBe("[0, 1]");
  });

  it("the starter suite passes and measures a linear algorithm", async () => {
    const compiled = new JavaScriptCompiler("javascript", false).compile(STARTER_SOURCE);
    if (!compiled.ok) throw new Error("compile failed");
    const messages: RuntimeWorkerMessage[] = [];
    await handleTest(
      {
        type: "test",
        runId: 1,
        languageId: "javascript",
        code: compiled.code,
        suite: STARTER_SUITE,
        limits: TEST_LIMITS,
      },
      { post: (m) => messages.push(m), now: () => 0, lockdown: () => undefined },
    );
    const results = messages.flatMap((m) => (m.type === "test-result" ? [m.result] : []));
    expect(summarize(results)).toEqual({ passed: 4, failed: 0, total: 4 });
    const estimate = estimateComplexity(samplesOf(results));
    expect(estimate.kind === "estimate" && formatComplexity(estimate.complexity)).toBe("O(n)");
  });
});
