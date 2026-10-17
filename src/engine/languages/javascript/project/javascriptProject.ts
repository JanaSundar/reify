import type { ProjectLanguage } from "../../../core/project/types";
import { compileModule } from "./compileModule";
import { resolveJavaScriptImport } from "./resolveImport";
import { scanImports } from "./scanImports";

/** ES-module imports between project files; JavaScript and TypeScript share one resolver. */
export const javascriptProject: ProjectLanguage = {
  id: "javascript",
  scan: scanImports,
  compile: compileModule,
  resolve: resolveJavaScriptImport,
};
