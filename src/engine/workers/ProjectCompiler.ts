import { CompileCache, compileProject } from "../core/project/compileProject";
import { buildGraph, type GraphHost } from "../core/project/graph";
import { moduleUrl } from "../core/project/moduleServer";
import type { ModulePublisher } from "../core/project/ModuleStore";
import { cachedHost, ScanCache } from "../core/project/scanCache";
import type { Project } from "../core/project/types";
import type { CompileResult } from "../core/protocol/messages";

/**
 * Compiles whole projects in the (long-lived) compiler worker: finds the modules, compiles
 * each, and publishes them for the runtime worker to import. Remembers scans and compiled
 * modules between runs, so an edit only redoes the files it affects.
 */
export class ProjectCompiler {
  private readonly scans = new ScanCache();
  private readonly compiles = new CompileCache();

  constructor(
    private readonly host: GraphHost,
    private readonly publisher: ModulePublisher,
    private readonly namespace: string,
  ) {}

  /**
   * Whether the entry imports anything. A file that imports nothing is the lone script it
   * always was, and keeps running as one (script semantics, the single-file trace).
   */
  entryImports(project: Project): boolean {
    const entry = project.files.find((file) => file.path === project.entry);
    const language = entry && this.host.languageOf(entry.path);
    return Boolean(language && language.scan(entry).imports.length > 0);
  }

  async compile(project: Project): Promise<CompileResult> {
    const graph = buildGraph(project, cachedHost(this.host, this.scans));
    const reachable = new Set(graph.modules.keys());
    this.scans.retain(reachable);
    this.compiles.retain(reachable);

    const built = compileProject(graph, (path) => moduleUrl(this.namespace, path), this.compiles);
    if (!built.ok) return { ok: false, diagnostics: built.diagnostics };
    await this.publisher.publish(this.namespace, built.build.modules);
    return { ok: true, code: "", program: built.build.program, entryUrl: built.build.entryUrl };
  }
}
