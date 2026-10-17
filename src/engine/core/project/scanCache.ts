import type { GraphHost } from "./graph";
import type { KeyedCache } from "./KeyedCache";
import type { ModuleScan, ProjectLanguage } from "./types";

/** A language whose scans are served from `cache` while a file's source is unchanged. */
export const cachedLanguage = (
  language: ProjectLanguage,
  cache: KeyedCache<ModuleScan>,
): ProjectLanguage => ({
  ...language,
  scan: (file) => cache.get(file.path, file.source, () => language.scan(file)),
});

/** A host whose languages scan through `cache`; each language is wrapped once, keeping identity. */
export const cachedHost = (host: GraphHost, cache: KeyedCache<ModuleScan>): GraphHost => {
  const wrapped = new Map<ProjectLanguage, ProjectLanguage>();
  return {
    languageOf: (path) => {
      const language = host.languageOf(path);
      if (!language) return undefined;
      if (!wrapped.has(language)) wrapped.set(language, cachedLanguage(language, cache));
      return wrapped.get(language);
    },
  };
};
