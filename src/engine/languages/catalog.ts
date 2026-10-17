/**
 * The languages the playground offers: the single list the UI derives file extensions,
 * labels and badges from. Safe to import on the main thread (no compiler or runtime code);
 * `registry.ts` holds the worker-side implementations.
 */
export const LANGUAGES = [
  {
    id: "javascript",
    label: "JavaScript",
    badge: "JS",
    extensions: ["js", "mjs", "jsx"],
    lineComment: "//",
  },
  {
    id: "typescript",
    label: "TypeScript",
    badge: "TS",
    extensions: ["ts", "tsx"],
    lineComment: "//",
  },
  { id: "python", label: "Python", badge: "PY", extensions: ["py"], lineComment: "#" },
] as const;

export type Language = (typeof LANGUAGES)[number];
export type LanguageId = Language["id"];

export const DEFAULT_LANGUAGE: Language = LANGUAGES[0];

const BY_ID = new Map<string, Language>(LANGUAGES.map((language) => [language.id, language]));

const BY_EXTENSION = new Map<string, Language>(
  LANGUAGES.flatMap((language) => language.extensions.map((ext) => [ext, language] as const)),
);

export const languageById = (id: LanguageId): Language => BY_ID.get(id)!;

const extensionOf = (name: string): string | undefined =>
  /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();

/** The language of a file name, by extension; `undefined` for unknown extensions. */
export const knownLanguageOfFile = (name: string): Language | undefined =>
  BY_EXTENSION.get(extensionOf(name) ?? "");

/** The language of a file name, by extension; unknown extensions are JavaScript. */
export const languageOfFile = (name: string): Language =>
  knownLanguageOfFile(name) ?? DEFAULT_LANGUAGE;

/** `name` with its language extension replaced by `language`'s primary one. */
export const withLanguageExtension = (name: string, language: Language): string => {
  const ext = extensionOf(name);
  const stem = ext && BY_EXTENSION.has(ext) ? name.slice(0, -(ext.length + 1)) : name;
  return `${stem}.${language.extensions[0]}`;
};
