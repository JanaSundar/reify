import { t, type BabelTypes, type NodePath } from "./babel";

const keyName = (key: BabelTypes.Node, computed: boolean): string | null => {
  if (computed) return null;
  if (t.isIdentifier(key)) return key.name;
  if (t.isStringLiteral(key) || t.isNumericLiteral(key)) return String(key.value);
  if (t.isPrivateName(key)) return `#${key.id.name}`;
  return null;
};

/** Best-effort display name for a function, following JS name inference rules. */
export const inferFunctionName = (path: NodePath<BabelTypes.Function>): string => {
  const { node, parent } = path;
  if ("id" in node && node.id) return node.id.name;
  if (t.isObjectMethod(node) || t.isClassMethod(node) || t.isClassPrivateMethod(node)) {
    const name = keyName(node.key, node.computed ?? false) ?? "(computed)";
    if (node.kind === "constructor") {
      const cls = path.findParent((p) => p.isClass());
      const classNode = cls?.node;
      const className = t.isClass(classNode) && classNode.id ? classNode.id.name : "class";
      return `new ${className}`;
    }
    return node.kind === "get" || node.kind === "set" ? `${node.kind} ${name}` : name;
  }
  if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) return parent.id.name;
  if (t.isAssignmentExpression(parent)) {
    if (t.isIdentifier(parent.left)) return parent.left.name;
    if (t.isMemberExpression(parent.left)) {
      return keyName(parent.left.property, parent.left.computed) ?? "(anonymous)";
    }
  }
  if ((t.isObjectProperty(parent) || t.isClassProperty(parent)) && parent.value === node) {
    return keyName(parent.key, parent.computed) ?? "(anonymous)";
  }
  return "(anonymous)";
};
