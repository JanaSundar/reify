/**
 * Project paths: forward-slash, relative to the project root, with no `.` or `..` segments.
 * Every path that enters the engine goes through {@link normalizePath}, so a path can never
 * name anything outside the project.
 */
export type PathResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly code: PathErrorCode; readonly message: string };

export type PathErrorCode = "invalid-path" | "path-escapes-root";

const fail = (code: PathErrorCode, message: string): PathResult => ({ ok: false, code, message });

const DRIVE_OR_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** Normalizes a path relative to the project root; rejects empty, absolute and escaping paths. */
export const normalizePath = (raw: string): PathResult => {
  if (raw.includes("\0")) return fail("invalid-path", "A path cannot contain a null character.");
  const unified = raw.replaceAll("\\", "/");
  if (unified.startsWith("/") || DRIVE_OR_SCHEME.test(unified))
    return fail("invalid-path", `“${raw}” must be a path inside the project, not an absolute one.`);
  const segments: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") segments.push(segment);
    else if (segments.pop() === undefined)
      return fail("path-escapes-root", `“${raw}” points outside the project.`);
  }
  if (segments.length === 0) return fail("invalid-path", `“${raw}” does not name a file.`);
  return { ok: true, path: segments.join("/") };
};

/** The directory part of a normalized path ("" for a file at the project root). */
export const dirname = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** `./x` and `../x`, as opposed to bare names (`pkg`) and absolute paths. */
export const isRelativeSpecifier = (specifier: string): boolean =>
  specifier.startsWith("./") || specifier.startsWith("../");

/** Resolves a relative specifier against the importing file's directory. */
export const resolveRelative = (from: string, specifier: string): PathResult => {
  const dir = dirname(from);
  return normalizePath(dir ? `${dir}/${specifier}` : specifier);
};
