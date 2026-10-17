import { resolveRelativeFile } from "../../../core/project/resolve";
import type { ProjectLanguage } from "../../../core/project/types";
import { scanImports } from "./scanImports";

/**
 * TypeScript imports name the compiled file: `./math.js` stands for `./math.ts` when only
 * the source exists (the convention `tsc` and bundlers follow).
 */
const typescriptAlternatives = (path: string): readonly string[] => {
  if (path.endsWith(".js")) return [path.replace(/\.js$/, ".ts"), path.replace(/\.js$/, ".tsx")];
  if (path.endsWith(".jsx")) return [path.replace(/\.jsx$/, ".tsx")];
  return [];
};

/** ES-module imports between project files; JavaScript and TypeScript share one resolver. */
export const javascriptProject: ProjectLanguage = {
  id: "javascript",
  scan: scanImports,
  resolve: (specifier, from, exists) =>
    resolveRelativeFile(specifier, from, exists, typescriptAlternatives),
};
