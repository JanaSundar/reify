import type { ModuleCompileResult, ModuleSlot, ProjectFile } from "../../../core/project/types";
import { t, type BabelTypes } from "../compiler/babel";
import { instrumentProgram } from "../compiler/instrumentationPlugin";
import { parseModule } from "../compiler/parse";
import { BindingTable, DiagnosticLog, LocTable } from "../compiler/tables";
import { CONSOLE_PARAM, TRACER_GLOBAL, TRACER_PARAM } from "../traceApi";

/**
 * `const __lc$t = globalThis.__reify_tracer; const console = __lc$t.console;`: the tracer
 * and console a single-file program receives as parameters, for a module that has none.
 */
const prologue = (): BabelTypes.Statement[] => [
  t.variableDeclaration("const", [
    t.variableDeclarator(
      t.identifier(TRACER_PARAM),
      t.memberExpression(t.identifier("globalThis"), t.identifier(TRACER_GLOBAL)),
    ),
  ]),
  t.variableDeclaration("const", [
    t.variableDeclarator(
      t.identifier(CONSOLE_PARAM),
      t.memberExpression(t.identifier(TRACER_PARAM), t.identifier(CONSOLE_PARAM)),
    ),
  ]),
];

/** Points every `import … from` and `export … from` at the url its target is served from. */
const rewriteSpecifiers = (program: BabelTypes.Program, urlOf: (specifier: string) => string) => {
  for (const node of program.body) {
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source
    ) {
      const url = urlOf(node.source.value);
      node.source.value = url;
      node.source.extra = { raw: JSON.stringify(url), rawValue: url };
    }
  }
};

/**
 * Compiles one ES module of a project into an instrumented ES module. Locations are
 * original source locations of this file; ids start at the module's slot.
 */
export const compileModule = (
  file: ProjectFile,
  slot: ModuleSlot,
  urlOf: (specifier: string) => string,
): ModuleCompileResult => {
  const parsed = parseModule(file);
  if (!parsed.ok) return { ok: false, diagnostics: [parsed.diagnostic] };

  const { ast } = parsed;
  rewriteSpecifiers(ast.program, urlOf);
  const locs = new LocTable(slot.fileId, slot.locBase);
  const bindings = new BindingTable(slot.bindingBase);
  const log = new DiagnosticLog();
  const instrumented = instrumentProgram({
    ast,
    source: file.source,
    fileName: file.path,
    locs,
    bindings,
    log,
    options: { modules: true, prologue: prologue() },
  });
  if (!instrumented.ok) return instrumented;
  return {
    ok: true,
    module: {
      code: instrumented.code,
      locs: locs.locs,
      bindings: bindings.bindings,
      warnings: log.warnings,
    },
  };
};
