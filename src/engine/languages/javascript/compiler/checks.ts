import { TRACER_PARAM } from "../traceApi";
import { t, type Visitor } from "./babel";
import type { DiagnosticLog } from "./tables";

/**
 * Rejects constructs the tracer cannot follow faithfully. Rejecting is preferred over
 * producing an incomplete or misleading trace.
 */
export const unsupportedVisitor = (log: DiagnosticLog): Visitor => ({
  Function(path) {
    const { node } = path;
    if (node.async) {
      log.error("unsupported-async", "async functions are not supported yet.", node);
    }
    if (node.generator) {
      log.error("unsupported-generator", "Generator functions are not supported yet.", node);
    }
  },
  WithStatement(path) {
    log.error("unsupported-with", "`with` statements are not supported.", path.node);
  },
  ImportExpression(path) {
    log.error("unsupported-module", "Dynamic `import()` is not available.", path.node);
  },
  ImportDeclaration(path) {
    log.error("unsupported-module", "Modules and imports are not supported.", path.node);
  },
  CallExpression(path) {
    const { callee } = path.node;
    if (t.isIdentifier(callee, { name: "eval" })) {
      log.error("unsupported-eval", "`eval` cannot be traced and is not supported.", path.node);
    }
    if (t.isIdentifier(callee, { name: "Function" })) {
      log.error("unsupported-eval", "The `Function` constructor is not supported.", path.node);
    }
  },
  NewExpression(path) {
    if (t.isIdentifier(path.node.callee, { name: "Function" })) {
      log.error("unsupported-eval", "The `Function` constructor is not supported.", path.node);
    }
  },
  OptionalCallExpression(path) {
    log.warn(
      "partial-optional-call",
      "Mutations made through optional calls (`a?.push(x)`) are not traced.",
      path.node,
    );
  },
  Identifier(path) {
    if (path.node.name.startsWith(TRACER_PARAM)) {
      log.error("reserved-name", `The name \`${path.node.name}\` is reserved.`, path.node);
    }
  },
});

/**
 * Normalizes the AST so instrumentation can insert statements anywhere: every statement
 * body becomes a block and expression-bodied arrows get a `return`.
 */
export const normalizeVisitor: Visitor = {
  ArrowFunctionExpression(path) {
    const { body } = path.node;
    if (t.isBlockStatement(body)) return;
    const ret = t.returnStatement(body);
    ret.loc = body.loc;
    path.node.body = t.blockStatement([ret]);
  },
  IfStatement(path) {
    const { node } = path;
    if (!t.isBlockStatement(node.consequent)) node.consequent = t.blockStatement([node.consequent]);
    if (node.alternate && !t.isBlockStatement(node.alternate)) {
      node.alternate = t.blockStatement([node.alternate]);
    }
  },
  Loop(path) {
    const { node } = path;
    if (!t.isBlockStatement(node.body)) node.body = t.blockStatement([node.body]);
  },
};
