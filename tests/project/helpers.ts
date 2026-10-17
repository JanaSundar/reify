import type { Diagnostic } from "@/engine/core/protocol/program";
import { resolveRelativeFile } from "@/engine/core/project/resolve";
import type { ImportRef, Project, ProjectFile, ProjectLanguage } from "@/engine/core/project/types";

/**
 * A toy language for the project model: each line is `import <specifier> [names…]`,
 * `dynamic <specifier>` or `syntax-error`. It exercises the model without a real parser.
 */
export const toyLanguage = (id = "toy"): ProjectLanguage & { scans: number } => {
  const language = {
    id,
    scans: 0,
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
