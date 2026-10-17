import type { GraphHost } from "../core/project/graph";
import type { ProjectLanguage } from "../core/project/types";
import { knownLanguageOfFile, type LanguageId } from "./catalog";
import { javascriptProject } from "./javascript/project/javascriptProject";

/**
 * Which languages can be part of a multi-file project, and how each resolves imports.
 * A language joins by adding an entry; languages without one cannot be imported or run
 * as a project yet.
 */
const PROJECT_LANGUAGES: Partial<Record<LanguageId, ProjectLanguage>> = {
  javascript: javascriptProject,
  typescript: javascriptProject,
};

/** The graph host for real projects: a file's language comes from its extension. */
export const projectHost: GraphHost = {
  languageOf: (path) => {
    const language = knownLanguageOfFile(path);
    return language && PROJECT_LANGUAGES[language.id];
  },
};
