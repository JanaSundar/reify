/// <reference lib="webworker" />
import { expose } from "comlink";
import ts from "typescript";
import { version } from "typescript/package.json";
import { createTypeScriptHost } from "../languages/javascript/service/host";
import type { TypeLibs } from "../languages/javascript/typecheck/environment";

/** Self-hosted by `scripts/copy-ts-libs.mjs`; the path carries the version. */
const LIBS_URL = `/ts-libs/${version}/libs.json`;

/**
 * Language service for JavaScript and TypeScript files: diagnostics, completions and hover
 * info for the editor. Loaded only when such a file is first opened; never runs user code.
 */
expose(
  createTypeScriptHost(async () => {
    const { libs } = (await fetch(LIBS_URL).then((r) => r.json())) as { libs: TypeLibs };
    return { ts, libs };
  }),
);
