import type { Diagnostic } from "@/engine/core/protocol/program";
import { resolveRelativeFile } from "@/engine/core/project/resolve";
import type {
  ImportRef,
  ModuleCompileResult,
  ModuleSlot,
  Project,
  ProjectFile,
  ProjectLanguage,
} from "@/engine/core/project/types";

/**
 * A toy language for the project model: each line is `import <specifier> [names…]`,
 * `dynamic <specifier>` or `syntax-error`. It exercises the model without a real parser.
 */
export const toyLanguage = (
  id = "toy",
): ProjectLanguage & { scans: number; compiles: string[] } => {
  const language = {
    id,
    scans: 0,
    compiles: [] as string[],
    scan(file: ProjectFile) {
      language.scans += 1;
      const imports: ImportRef[] = [];
      const diagnostics: Diagnostic[] = [];
      file.source.split("\n").forEach((line, i) => {
        const [word, specifier, ...names] = line.trim().split(/\s+/);
        const range = { line: i + 1, column: 0, endLine: i + 1, endColumn: line.length };
        if (word === "import" && specifier)
          imports.push({ specifier, kind: "static", range, names });
        else if (word === "dynamic" && specifier)
          imports.push({ specifier, kind: "dynamic", range, names: [] });
        else if (word === "syntax-error")
          diagnostics.push({ severity: "error", code: "syntax", message: "bad", range });
      });
      return { imports, diagnostics };
    },
    resolve: (specifier: string, from: string, exists: (path: string) => boolean) =>
      resolveRelativeFile(specifier, from, exists),
    /** One location per line and one binding per `let`; fails on `compile-error`. */
    compile: (file: ProjectFile, slot: ModuleSlot): ModuleCompileResult => {
      language.compiles.push(`${file.path}@${slot.locBase}/${slot.bindingBase}`);
      if (file.source.includes("compile-error"))
        return {
          ok: false,
          diagnostics: [{ severity: "error", code: "boom", message: "no", range: null }],
        };
      const lines = file.source.split("\n");
      const range = { line: 1, column: 0, endLine: 1, endColumn: 1 };
      return {
        ok: true,
        module: {
          code: file.source,
          locs: lines.map(() => ({ ...range, file: slot.fileId, role: "statement", reads: [] })),
          bindings: lines
            .filter((line) => line.startsWith("let"))
            .map(() => ({ name: "x", kind: "let", line: 1 })),
          warnings: [],
        },
      };
    },
  };
  return language;
};

export const project = (files: Record<string, string>, entry = "main.toy"): Project => ({
  files: Object.entries(files).map(([path, source]) => ({ path, source })),
  entry,
});

/** Host where every `.toy` file belongs to `language`. */
export const hostFor = (language: ProjectLanguage) => ({
  languageOf: (path: string) => (path.endsWith(".toy") ? language : undefined),
});
