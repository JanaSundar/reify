import { resolveRelativeFile } from "../../../core/project/resolve";
import type { Resolution } from "../../../core/project/types";

/**
 * TypeScript imports name the compiled file: `./math.js` stands for `./math.ts` when only
 * the source exists (the convention `tsc` and bundlers follow).
 */
const typescriptAlternatives = (path: string): readonly string[] => {
  if (path.endsWith(".js")) return [path.replace(/\.js$/, ".ts"), path.replace(/\.js$/, ".tsx")];
  if (path.endsWith(".jsx")) return [path.replace(/\.jsx$/, ".tsx")];
  return [];
};

/**
 * Where a JavaScript or TypeScript import points. Free of the parser, so the editor can use
 * it too (to open the module an import names).
 */
export const resolveJavaScriptImport = (
  specifier: string,
  from: string,
  exists: (path: string) => boolean,
): Resolution => resolveRelativeFile(specifier, from, exists, typescriptAlternatives);
