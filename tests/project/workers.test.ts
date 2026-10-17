import { describe, expect, it, vi } from "vitest";
import {
  ExecutionCoordinator,
  type RunCallbacks,
} from "@/engine/core/coordinator/ExecutionCoordinator";
import type { ModulePublisher, PublishedModule } from "@/engine/core/project/ModuleStore";
import { DEFAULT_LIMITS } from "@/engine/core/protocol/limits";
import type { CompilerWorkerMessage } from "@/engine/core/protocol/messages";
import { TraceStore } from "@/engine/core/trace/TraceStore";
import { projectHost } from "@/engine/languages/projectHost";
import { handleCompile } from "@/engine/workers/handlers";
import { ProjectCompiler } from "@/engine/workers/ProjectCompiler";
import { FakeWorkers, ManualScheduler } from "../machine/fakes";

const FILES = [
  { path: "main.js", source: 'import { add } from "./utils/math.js";\nconsole.log(add(1, 2));' },
  { path: "utils/math.js", source: "export const add = (a, b) => a + b;" },
];

class FakePublisher implements ModulePublisher {
  readonly published: { namespace: string; modules: readonly PublishedModule[] }[] = [];
  publish = async (namespace: string, modules: readonly PublishedModule[]) => {
    this.published.push({ namespace, modules });
  };
}

const compileProjectMessages = async (
  project: { files: typeof FILES; entry: string },
  compiler: ProjectCompiler,
) => {
  const out: CompilerWorkerMessage[] = [];
  await handleCompile(
    { type: "compile", runId: 4, languageId: "javascript", source: "", project },
    (m) => out.push(m),
    () => 0,
    async () => compiler,
  );
  return out;
};

describe("compiler worker: projects", () => {
  it("publishes every module and answers with the linked program and entry url", async () => {
    const publisher = new FakePublisher();
    const compiler = new ProjectCompiler(projectHost, publisher, "ns1");
    const [ready, compiled] = await compileProjectMessages(
      { files: FILES, entry: "main.js" },
      compiler,
    );

    expect(ready).toEqual({ type: "ready", runId: 4 });
    expect(compiled).toMatchObject({
      type: "compiled",
      result: { ok: true, code: "", entryUrl: "/__reify/ns1/main.js" },
    });
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]!.namespace).toBe("ns1");
    expect(publisher.published[0]!.modules.map((m) => m.url)).toEqual([
      "/__reify/ns1/main.js",
      "/__reify/ns1/utils/math.js",
    ]);
    // Imports were rewritten to the served urls.
    expect(publisher.published[0]!.modules[0]!.code).toContain('"/__reify/ns1/utils/math.js"');
    if (compiled?.type !== "compiled" || !compiled.result.ok) throw new Error("not compiled");
    expect(compiled.result.program.files.map((f) => f.path)).toEqual(["main.js", "utils/math.js"]);
  });

  it("publishes nothing and reports located diagnostics when the project is broken", async () => {
    const publisher = new FakePublisher();
    const compiler = new ProjectCompiler(projectHost, publisher, "ns1");
    const [, compiled] = await compileProjectMessages(
      {
        files: [{ path: "main.js", source: 'import "./missing.js";' }] as typeof FILES,
        entry: "main.js",
      },
      compiler,
    );
    expect(publisher.published).toEqual([]);
    expect(compiled).toMatchObject({
      result: { ok: false, diagnostics: [{ code: "missing-module", path: "main.js" }] },
    });
  });

  it("reuses compiled modules when only another file changed", async () => {
    const publisher = new FakePublisher();
    const compiler = new ProjectCompiler(projectHost, publisher, "ns1");
    const entry = FILES[0]!;
    const base = { ...entry, source: `${entry.source}\n` };
    await compileProjectMessages({ files: [base, FILES[1]!], entry: "main.js" }, compiler);
    // Edit the dependency's body without changing how many locations it has.
    const edited = { path: "utils/math.js", source: "export const add = (a, b) => b + a;" };
    await compileProjectMessages({ files: [base, edited], entry: "main.js" }, compiler);
    const [first, second] = publisher.published.map((p) => p.modules);
    expect(second![0]!.code).toBe(first![0]!.code);
    expect(second![1]!.code).not.toBe(first![1]!.code);
  });
});

const setup = () => {
  const workers = new FakeWorkers();
  const coordinator = new ExecutionCoordinator(
    workers,
    new TraceStore({ schedule: (fn) => fn() }),
    DEFAULT_LIMITS,
    new ManualScheduler(),
  );
  const callbacks: RunCallbacks = {
    onProgress: vi.fn<RunCallbacks["onProgress"]>(),
    onCompiled: vi.fn<RunCallbacks["onCompiled"]>(),
    onTestResult: vi.fn<RunCallbacks["onTestResult"]>(),
    onComplete: vi.fn<RunCallbacks["onComplete"]>(),
    onError: vi.fn<RunCallbacks["onError"]>(),
    onCancelled: vi.fn<RunCallbacks["onCancelled"]>(),
  };
  return { workers, coordinator, callbacks };
};

describe("ExecutionCoordinator: projects", () => {
  const project = { files: FILES, entry: "main.js" };
  const request = { runId: 1, languageId: "javascript", source: FILES[0]!.source, project };

  it("starts the module server, then compiles the project", async () => {
    const { workers, coordinator, callbacks } = setup();
    const started = vi.fn<() => Promise<void>>(async () => undefined);
    workers.moduleServer = started;
    coordinator.start(request, callbacks);
    expect(workers.compilers).toHaveLength(0);
    await Promise.resolve();
    expect(started).toHaveBeenCalledOnce();
    expect(workers.compilers[0]!.posted).toEqual([{ type: "compile", ...request }]);
  });

  it("runs the entry module the compiler published", async () => {
    const { workers, coordinator, callbacks } = setup();
    coordinator.start(request, callbacks);
    await Promise.resolve();
    const compiler = workers.compilers[0]!;
    compiler.emit({ type: "ready", runId: 1 });
    compiler.emit({
      type: "compiled",
      runId: 1,
      compileMs: 1,
      result: {
        ok: true,
        code: "",
        entryUrl: "/__reify/ns/main.js",
        program: {
          languageId: "javascript",
          files: [],
          locs: [],
          bindings: [],
          warnings: [],
          complexity: null,
        },
      },
    });
    expect(workers.executing[0]!.requests[0]).toMatchObject({
      type: "execute",
      entryUrl: "/__reify/ns/main.js",
    });
  });

  it("fails the run, with the reason, when the module server cannot start", async () => {
    const { workers, coordinator, callbacks } = setup();
    workers.moduleServer = () => Promise.reject(new Error("no service workers"));
    coordinator.start(request, callbacks);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workers.compilers).toHaveLength(0);
    expect(callbacks.onError).toHaveBeenCalledWith({
      kind: "internal",
      message: expect.stringContaining("no service workers"),
    });
  });

  it("does not compile if the run was replaced while the module server started", async () => {
    const { workers, coordinator, callbacks } = setup();
    coordinator.start(request, callbacks);
    coordinator.start({ runId: 2, languageId: "javascript", source: "x" }, callbacks);
    await Promise.resolve();
    expect(workers.compilers[0]!.posted.map((m) => (m as { runId: number }).runId)).toEqual([2]);
  });
});

describe("compiler worker: a project whose entry imports nothing", () => {
  it("compiles as the lone script it always was, publishing nothing", async () => {
    const publisher = new FakePublisher();
    const compiler = new ProjectCompiler(projectHost, publisher, "ns1");
    const out: CompilerWorkerMessage[] = [];
    await handleCompile(
      {
        type: "compile",
        runId: 9,
        languageId: "javascript",
        source: "console.log(1);",
        project: { entry: "main.js", files: [{ path: "main.js", source: "console.log(1);" }] },
      },
      (m) => out.push(m),
      () => 0,
      async () => compiler,
    );
    expect(publisher.published).toEqual([]);
    expect(out[1]).toMatchObject({
      type: "compiled",
      result: { ok: true, program: { files: [{ id: 0, path: "main.js" }] } },
    });
    const compiled = out[1];
    if (compiled?.type !== "compiled" || !compiled.result.ok) throw new Error("not compiled");
    expect(compiled.result.code).toContain("__lc$t");
  });
});
