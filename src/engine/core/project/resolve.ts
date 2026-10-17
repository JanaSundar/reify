import { isRelativeSpecifier, resolveRelative } from "./paths";
import type { Resolution } from "./types";

/**
 * Resolution for languages that import project files by relative path (JavaScript,
 * TypeScript): a specifier names a file exactly, or one of `alternatives(path)` when the
 * exact file is absent. Never reaches outside the project and never fetches anything.
 */
export const resolveRelativeFile = (
  specifier: string,
  from: string,
  exists: (path: string) => boolean,
  alternatives: (path: string) => readonly string[] = () => [],
): Resolution => {
  if (!isRelativeSpecifier(specifier))
    return {
      ok: false,
      code: "unsupported-specifier",
      message: `“${specifier}” is not supported: only relative imports of project files (./ or ../) can be resolved.`,
    };
  const resolved = resolveRelative(from, specifier);
  if (!resolved.ok) return { ok: false, code: resolved.code, message: resolved.message };
  for (const candidate of [resolved.path, ...alternatives(resolved.path)])
    if (exists(candidate)) return { ok: true, path: candidate };
  return {
    ok: false,
    code: "missing-module",
    message: `Cannot find “${specifier}” (looked for ${resolved.path}) imported from ${from}.`,
  };
};
