import { createSystem, createVirtualTypeScriptEnvironment } from "@typescript/vfs";
import type * as TS from "typescript";
import { CONSOLE_LEVELS } from "../../../core/protocol/eventCodec";

/** The standard-library declarations the checker resolves `lib` references against. */
export type TypeLibs = Readonly<Record<string, string>>;

/** The languages the TypeScript compiler serves, and where each document lives. */
export const TS_MAIN_PATHS = {
  javascript: "/main.js",
  typescript: "/main.ts",
} as const;
export type TypeScriptFamilyId = keyof typeof TS_MAIN_PATHS;

const GLOBALS_PATH = "/reify-globals.d.ts";

/** The only host global user code gets: the tracer's console (see `JsTracer`). */
const GLOBALS_SOURCE = `declare const console: { ${CONSOLE_LEVELS.map(
  (level) => `${level}(...data: unknown[]): void;`,
).join(" ")} };`;

export type TypeEnvironment = ReturnType<typeof createTypeEnvironment>;

/**
 * An in-memory TypeScript environment: strict, ES2022, no DOM, `console` as the only host
 * global. JavaScript files are parsed too but not type-checked (`checkJs` off), so they get
 * syntax errors, including "types can only be used in TypeScript files", without noise.
 * Pure: the compiler module and library files are parameters; nothing touches disk.
 */
export const createTypeEnvironment = (ts: typeof TS, libs: TypeLibs) => {
  const files = new Map(Object.entries(libs).map(([name, text]) => [`/${name}`, text]));
  files.set(GLOBALS_PATH, GLOBALS_SOURCE);
  return createVirtualTypeScriptEnvironment(createSystem(files), [GLOBALS_PATH], ts, {
    target: ts.ScriptTarget.ES2022,
    lib: ["es2022"],
    allowJs: true,
    checkJs: false,
    strict: true,
    noEmit: true,
    types: [],
    skipLibCheck: true,
  });
};
