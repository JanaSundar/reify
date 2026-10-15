import { findExample } from "@/content/examples";
import type { ProgramInfo } from "@/engine/core/protocol/program";
import { JavaScriptCompiler } from "@/engine/languages/javascript/compiler/JavaScriptCompiler";

/** The landing preview's program, compiled ahead of time so the page never ships Babel. */
export interface CompiledPreview {
  readonly fileName: string;
  readonly source: string;
  readonly code: string;
  readonly program: ProgramInfo;
}

const PREVIEW_EXAMPLE = "array-map";

/** Compiles the preview example during static generation. Import only from server code. */
export const compilePreview = (): CompiledPreview => {
  const example = findExample(PREVIEW_EXAMPLE)!;
  const result = new JavaScriptCompiler("javascript", false).compile(example.source);
  if (!result.ok)
    throw new Error(`Preview program failed to compile: ${result.diagnostics[0]?.message}`);
  return {
    fileName: example.fileName,
    source: example.source,
    code: result.code,
    program: result.program,
  };
};
