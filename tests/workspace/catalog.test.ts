import { describe, expect, it } from "vitest";
import {
  LANGUAGES,
  languageOfFile,
  withLanguageExtension,
  languageById,
} from "@/engine/languages/catalog";

describe("language catalog", () => {
  it("maps file extensions to languages, defaulting to JavaScript", () => {
    expect(languageOfFile("a.ts").id).toBe("typescript");
    expect(languageOfFile("A.TSX").id).toBe("typescript");
    expect(languageOfFile("solve.py").id).toBe("python");
    expect(languageOfFile("x.mjs").id).toBe("javascript");
    expect(languageOfFile("notes").id).toBe("javascript");
    expect(languageOfFile("data.json").id).toBe("javascript");
  });

  it("replaces only a known language extension", () => {
    const python = languageById("python");
    expect(withLanguageExtension("index.ts", python)).toBe("index.py");
    expect(withLanguageExtension("graph.v2.jsx", python)).toBe("graph.v2.py");
    expect(withLanguageExtension("notes", python)).toBe("notes.py");
    expect(withLanguageExtension("data.json", python)).toBe("data.json.py");
  });

  it("gives every extension to exactly one language", () => {
    const extensions = LANGUAGES.flatMap((language) => language.extensions);
    expect(new Set(extensions).size).toBe(extensions.length);
  });
});
