import type * as TS from "typescript";
import type { CompletionResult, HoverInfo } from "../../../core/protocol/languageService";
import type { Diagnostic } from "../../../core/protocol/program";
import {
  createTypeEnvironment,
  TS_MAIN_PATHS,
  type TypeEnvironment,
  type TypeLibs,
  type TypeScriptFamilyId,
} from "../typecheck/environment";
import { TypeScriptService } from "./TypeScriptService";

export interface TypeScriptLoad {
  readonly ts: typeof TS;
  readonly libs: TypeLibs;
}

interface Loaded extends TypeScriptLoad {
  readonly env: TypeEnvironment;
}

/**
 * What the TypeScript worker exposes: one service per language of the family (JavaScript
 * and TypeScript share a single compiler and environment). Edits that arrive while the
 * compiler is still loading are kept and applied once it is up.
 */
export const createTypeScriptHost = (load: () => Promise<TypeScriptLoad>) => {
  const pending = new Map<TypeScriptFamilyId, string>();
  const services = new Map<TypeScriptFamilyId, TypeScriptService>();
  let loaded: Loaded | null = null;

  const serviceFor = (languageId: TypeScriptFamilyId): TypeScriptService | null => {
    if (!loaded) return null;
    let service = services.get(languageId);
    if (!service) {
      service = new TypeScriptService(loaded.ts, loaded.env, TS_MAIN_PATHS[languageId]);
      services.set(languageId, service);
    }
    return service;
  };

  return {
    async initialize(): Promise<void> {
      const modules = await load();
      loaded = { ...modules, env: createTypeEnvironment(modules.ts, modules.libs) };
      for (const [languageId, source] of pending) serviceFor(languageId)?.update(source);
      pending.clear();
    },
    update(languageId: TypeScriptFamilyId, source: string): void {
      const service = serviceFor(languageId);
      if (service) service.update(source);
      else pending.set(languageId, source);
    },
    diagnostics: (languageId: TypeScriptFamilyId): readonly Diagnostic[] =>
      serviceFor(languageId)?.diagnostics() ?? [],
    complete: (
      languageId: TypeScriptFamilyId,
      pos: number,
      explicit: boolean,
    ): CompletionResult | null => serviceFor(languageId)?.complete(pos, explicit) ?? null,
    hover: (languageId: TypeScriptFamilyId, pos: number): HoverInfo | null =>
      serviceFor(languageId)?.hover(pos) ?? null,
  };
};

export type TypeScriptHost = ReturnType<typeof createTypeScriptHost>;
