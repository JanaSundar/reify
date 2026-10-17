import type { ImportRef, ModuleScan, ProjectFile } from "../../../core/project/types";
import { type SourceRange } from "../../../core/protocol/program";
import { languageOfFile } from "../../catalog";
import { babelTransformFromAst, type BabelTypes, type PluginObject } from "../compiler/babel";
import { BABEL_OPTIONS, internalDiagnostic, parseSource } from "../compiler/parse";

type Node = BabelTypes.Node;
type SpecifierName = BabelTypes.Identifier | BabelTypes.StringLiteral;

const rangeOf = (node: Node): SourceRange | null => {
  const { loc } = node;
  return loc
    ? {
        line: loc.start.line,
        column: loc.start.column,
        endLine: loc.end.line,
        endColumn: loc.end.column,
      }
    : null;
};

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

/** Collects every import in source order. Type-only imports are already stripped. */
const collector = (found: ImportRef[]): PluginObject => ({
  visitor: {
    ImportDeclaration({ node }) {
      found.push({
        specifier: node.source.value,
        kind: "static",
        range: rangeOf(node.source),
        names: importedNames(node),
      });
    },
    ExportNamedDeclaration({ node }) {
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
  const parsed = parseSource(file.source, {
    fileName: file.path,
    typescript: languageOfFile(file.path).id === "typescript",
    sourceType: "module",
  });
  if (!parsed.ok) return { imports: [], diagnostics: [parsed.diagnostic] };

  const imports: ImportRef[] = [];
  try {
    babelTransformFromAst(parsed.ast, file.source, {
      ...BABEL_OPTIONS,
      sourceType: "module",
      filename: file.path,
      plugins: [() => collector(imports)],
      code: false,
      ast: false,
    });
  } catch (error) {
    return { imports: [], diagnostics: [internalDiagnostic(error)] };
  }
  return { imports, diagnostics: [] };
};
