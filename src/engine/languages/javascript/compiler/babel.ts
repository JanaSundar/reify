import * as Babel from "@babel/standalone";
import type * as BabelTypesModule from "@babel/types";

/** Babel's AST builders/predicates, taken from the standalone bundle (no second copy). */
export const t = (Babel.packages as unknown as { types: typeof BabelTypesModule }).types;

export type { NodePath, PluginObject, types as BabelTypes, Visitor } from "@babel/core";

export const babelTransform = Babel.transform;
export const babelTransformFromAst = Babel.transformFromAst;
