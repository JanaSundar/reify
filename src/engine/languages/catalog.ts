import type { LanguageDescriptor } from "./types";

/** Language catalog for the UI. Safe to import on the main thread (no compiler code). */
export const LANGUAGES: readonly LanguageDescriptor[] = [
  { id: "javascript", label: "JavaScript", fileName: "solution.js" },
  { id: "typescript", label: "TypeScript", fileName: "solution.ts" },
];

export const DEFAULT_LANGUAGE_ID = "javascript";

export const findLanguage = (id: string): LanguageDescriptor | undefined =>
  LANGUAGES.find((language) => language.id === id);
