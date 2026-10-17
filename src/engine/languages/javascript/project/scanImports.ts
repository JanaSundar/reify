import type { ImportRef, ModuleScan, ProjectFile } from "../../../core/project/types";
import { babelTransformFromAst, t, type BabelTypes, type PluginObject } from "../compiler/babel";
import { BABEL_OPTIONS, internalDiagnostic, parseModule } from "../compiler/parse";
import { rangeOf } from "../compiler/tables";

type SpecifierName = BabelTypes.Identifier | BabelTypes.StringLiteral;

const exportName = (name: SpecifierName): string =>
  name.type === "Identifier" ? name.name : name.value;

/** Names an import declaration asks its module for. */
const importedNames = (node: BabelTypes.ImportDeclaration): string[] =>
  node.specifiers.map((specifier) => {
    if (specifier.type === "ImportDefaultSpecifier") return "default";
    if (specifier.type === "ImportNamespaceSpecifier") return "*";
    return exportName(specifier.imported);
  });

/** Names a `export … from "x"` declaration takes from the other module. */
const reexportedNames = (node: BabelTypes.ExportNamedDeclaration): string[] =>
  node.specifiers.map((specifier) => {
    if (specifier.type === "ExportNamespaceSpecifier") return "*";
    if (specifier.type === "ExportDefaultSpecifier") return "default";
    return exportName(specifier.local);
  });

/** Names an `export` without a source gives the module. */
const declaredExports = (node: BabelTypes.ExportNamedDeclaration): string[] =>
  node.declaration
    ? Object.keys(t.getBindingIdentifiers(node.declaration))
    : node.specifiers.map((specifier) => exportName(specifier.exported));

/** Collects every import (and the module's own exports) in source order. Types are stripped. */
const collector = (found: ImportRef[], exported: string[]): PluginObject => ({
  visitor: {
    ExportDefaultDeclaration() {
      exported.push("default");
    },
    ImportDeclaration({ node }) {
      found.push({
        specifier: node.source.value,
        kind: "static",
        range: rangeOf(node.source),
        names: importedNames(node),
      });
    },
    ExportNamedDeclaration({ node }) {
      exported.push(...declaredExports(node));
      if (!node.source) return;
      found.push({
        specifier: node.source.value,
        kind: "static",
        range: rangeOf(node.source),
        names: reexportedNames(node),
      });
    },
    ExportAllDeclaration({ node }) {
      found.push({
        specifier: node.source.value,
        kind: "static",
        range: rangeOf(node.source),
        names: ["*"],
        reexportAll: true,
      });
    },
    ImportExpression({ node }) {
      const { source } = node;
      found.push({
        specifier: source.type === "StringLiteral" ? source.value : "(computed)",
        kind: "dynamic",
        range: rangeOf(node),
        names: [],
      });
    },
  },
});

/** Finds the imports of a JavaScript or TypeScript module (parsing it as an ES module). */
export const scanImports = (file: ProjectFile): ModuleScan => {
  const parsed = parseModule(file);
  if (!parsed.ok) return { imports: [], diagnostics: [parsed.diagnostic] };

  const imports: ImportRef[] = [];
  const exports: string[] = [];
  try {
    babelTransformFromAst(parsed.ast, file.source, {
      ...BABEL_OPTIONS,
      sourceType: "module",
      filename: file.path,
      plugins: [() => collector(imports, exports)],
      code: false,
      ast: false,
    });
  } catch (error) {
    return { imports: [], diagnostics: [internalDiagnostic(error)] };
  }
  return { imports, exports, diagnostics: [] };
};
