import {
  complexity,
  constant,
  dominant,
  exponential,
  linear,
  logarithmic,
  multiply,
  type ComplexityClass,
  type StaticComplexity,
} from "../../../core/analysis/complexity";
import { t, type BabelTypes } from "./babel";

type Node = BabelTypes.Node;
type FunctionNode = BabelTypes.Function;

/** Built-in methods that walk the whole collection (O(n) per call). */
const LINEAR_METHODS = new Set([
  "includes",
  "indexOf",
  "lastIndexOf",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "filter",
  "map",
  "forEach",
  "reduce",
  "reduceRight",
  "some",
  "every",
  "slice",
  "splice",
  "shift",
  "unshift",
  "concat",
  "join",
  "reverse",
  "fill",
  "flat",
  "toReversed",
  "toSpliced",
  "split",
  "repeat",
  "padStart",
  "padEnd",
]);

/** Methods whose callback runs once per element. */
const CALLBACK_METHODS = new Set([
  "map",
  "forEach",
  "filter",
  "reduce",
  "reduceRight",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flatMap",
]);

const LINEAR_STATICS = new Set([
  "Array.from",
  "Object.keys",
  "Object.values",
  "Object.entries",
  "Object.assign",
  "JSON.stringify",
  "JSON.parse",
]);

const SORT_METHODS = new Set(["sort", "toSorted"]);

const nLogN = complexity(1, 1);

const isHalvingExpression = (node: Node): boolean =>
  (t.isBinaryExpression(node) &&
    ((["/", "*"].includes(node.operator) && t.isNumericLiteral(node.right, { value: 2 })) ||
      ([">>", ">>>"].includes(node.operator) && t.isNumericLiteral(node.right, { value: 1 })))) ||
  (t.isAssignmentExpression(node) &&
    ((["/=", "*="].includes(node.operator) && t.isNumericLiteral(node.right, { value: 2 })) ||
      ([">>=", ">>>="].includes(node.operator) && t.isNumericLiteral(node.right, { value: 1 }))));

/** Visits the children of a node (not entering nested functions unless asked). */
const children = (node: Node): Node[] => {
  const out: Node[] = [];
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item === "object") out.push(item as Node);
    } else if (value && typeof value === "object") {
      out.push(value as Node);
    }
  }
  return out;
};

const someDescendant = (
  node: Node,
  predicate: (n: Node) => boolean,
  stopAt: (n: Node) => boolean,
): boolean =>
  predicate(node) ||
  children(node).some((child) => !stopAt(child) && someDescendant(child, predicate, stopAt));

const calleeName = (node: BabelTypes.CallExpression): string | null => {
  const { callee } = node;
  if (t.isIdentifier(callee)) return callee.name;
  if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property)) {
    if (t.isIdentifier(callee.object)) return `${callee.object.name}.${callee.property.name}`;
    return `.${callee.property.name}`;
  }
  return null;
};

/** Collects named functions (declarations and `const f = () => ...`). */
const namedFunctions = (root: Node): Map<string, FunctionNode> => {
  const functions = new Map<string, FunctionNode>();
  const visit = (node: Node): void => {
    if (t.isFunctionDeclaration(node) && node.id) functions.set(node.id.name, node);
    if (
      t.isVariableDeclarator(node) &&
      t.isIdentifier(node.id) &&
      (t.isFunctionExpression(node.init) || t.isArrowFunctionExpression(node.init))
    ) {
      functions.set(node.id.name, node.init);
    }
    children(node).forEach(visit);
  };
  visit(root);
  return functions;
};

/**
 * Estimates time complexity from the shape of the code: loop nesting, halving loops,
 * recursion (with or without memoization) and built-ins that cost O(n). It reports the
 * dominant cost of the top-level program, assuming every loop runs over the input.
 */
export class JsComplexityAnalyzer {
  private readonly functions: Map<string, FunctionNode>;
  private readonly cache = new Map<FunctionNode, ComplexityClass>();
  private readonly active = new Set<FunctionNode>();
  private readonly notes = new Set<string>();

  constructor(private readonly program: BabelTypes.Program) {
    this.functions = namedFunctions(program);
  }

  analyze(): StaticComplexity {
    const statements = this.program.body.filter((s) => !t.isFunctionDeclaration(s));
    const time = statements.reduce((acc, s) => dominant(acc, this.cost(s, null, 0)), constant);
    return { time, notes: [...this.notes].slice(0, 6) };
  }

  /** Cost of a function's body including its recursion. */
  private functionCost(fn: FunctionNode, name: string): ComplexityClass {
    const cached = this.cache.get(fn);
    if (cached) return cached;
    if (this.active.has(fn)) return constant;
    this.active.add(fn);
    const body = this.cost(fn.body, fn, 0);
    const selfCalls = this.countSelfCalls(fn, name);
    let total = body;
    if (selfCalls > 0) {
      const halving = this.recursionHalves(fn, name);
      if (selfCalls >= 2 && !halving) {
        if (this.looksMemoized(fn)) {
          total = multiply(linear, body);
          this.notes.add(
            `\`${name}\` is recursive with memoization: about one call per distinct input`,
          );
        } else {
          total = exponential;
          this.notes.add(
            `\`${name}\` calls itself ${selfCalls} times per call without memoization`,
          );
        }
      } else if (selfCalls >= 2) {
        total = body.poly >= 1 ? multiply(body, logarithmic) : linear;
        this.notes.add(`\`${name}\` splits its input in half and recurses on both parts`);
      } else {
        total = multiply(halving ? logarithmic : linear, body);
        this.notes.add(
          `\`${name}\` recurses ${halving ? "on half of its input" : "once per level"}`,
        );
      }
    }
    this.active.delete(fn);
    this.cache.set(fn, total);
    return total;
  }

  private cost(node: Node, current: FunctionNode | null, loopDepth: number): ComplexityClass {
    if (t.isFunction(node)) return constant; // a definition costs nothing until called
    if (t.isLoop(node)) return this.loopCost(node, current, loopDepth);
    if (t.isCallExpression(node)) return this.callCost(node, current, loopDepth);
    if (t.isSpreadElement(node))
      return dominant(linear, this.cost(node.argument, current, loopDepth));
    return children(node).reduce(
      (acc, child) => dominant(acc, this.cost(child, current, loopDepth)),
      constant,
    );
  }

  private loopCost(
    node: BabelTypes.Loop,
    current: FunctionNode | null,
    loopDepth: number,
  ): ComplexityClass {
    const halving = someDescendant(
      node,
      isHalvingExpression,
      (n) => t.isFunction(n) || (t.isLoop(n) && n !== node),
    );
    const parts = children(node).filter(
      (child) => child !== (t.isForXStatement(node) ? node.right : null),
    );
    const inner = parts.reduce(
      (acc, child) => dominant(acc, this.cost(child, current, loopDepth + 1)),
      constant,
    );
    const header = t.isForXStatement(node) ? this.cost(node.right, current, loopDepth) : constant;
    const where = current ? this.nameOf(current) : null;
    if (halving)
      this.notes.add(`A loop${where ? ` in \`${where}\`` : ""} halves its range each time (log n)`);
    if (loopDepth === 0 && !halving) {
      this.notes.add(`A loop${where ? ` in \`${where}\`` : ""} runs over the input`);
    }
    if (loopDepth + 1 >= 2 && !halving)
      this.notes.add(`${loopDepth + 1} nested loops${where ? ` in \`${where}\`` : ""}`);
    return dominant(header, multiply(halving ? logarithmic : linear, inner));
  }

  private callCost(
    node: BabelTypes.CallExpression,
    current: FunctionNode | null,
    loopDepth: number,
  ): ComplexityClass {
    const args = node.arguments.reduce(
      (acc, arg) => dominant(acc, this.cost(arg, current, loopDepth)),
      constant,
    );
    const callee = t.isMemberExpression(node.callee)
      ? this.cost(node.callee.object, current, loopDepth)
      : constant;
    const name = calleeName(node);
    let own = constant;
    if (name !== null) {
      const method = name.startsWith(".")
        ? name.slice(1)
        : name.includes(".")
          ? name.split(".")[1]!
          : null;
      const user = this.functions.get(name);
      if (user) {
        own = user === current ? constant : this.functionCost(user, name);
      } else if (LINEAR_STATICS.has(name)) {
        own = linear;
      } else if (method && SORT_METHODS.has(method)) {
        own = dominant(nLogN, multiply(nLogN, this.callbackCost(node, current)));
      } else if (method && LINEAR_METHODS.has(method)) {
        own = CALLBACK_METHODS.has(method)
          ? multiply(linear, this.callbackCost(node, current))
          : linear;
        if (
          loopDepth > 0 &&
          ["shift", "unshift", "splice", "indexOf", "includes"].includes(method)
        ) {
          this.notes.add(`\`${method}()\` inside a loop costs O(n) on every iteration`);
        }
      }
    }
    return dominant(dominant(args, callee), own);
  }

  /** Cost of one invocation of an inline callback argument (map/filter/sort comparators). */
  private callbackCost(
    node: BabelTypes.CallExpression,
    current: FunctionNode | null,
  ): ComplexityClass {
    const callback = node.arguments.find(
      (a): a is BabelTypes.ArrowFunctionExpression | BabelTypes.FunctionExpression =>
        t.isArrowFunctionExpression(a) || t.isFunctionExpression(a),
    );
    return callback ? this.cost(callback.body, current, 0) : constant;
  }

  private countSelfCalls(fn: FunctionNode, name: string): number {
    let count = 0;
    const visit = (node: Node): void => {
      if (node !== fn && t.isFunction(node)) return;
      if (t.isCallExpression(node) && t.isIdentifier(node.callee, { name })) count += 1;
      children(node).forEach(visit);
    };
    visit(fn);
    return count;
  }

  /** True when recursive calls pass a halved range (`mid`, `n / 2`, `n >> 1`). */
  private recursionHalves(fn: FunctionNode, name: string): boolean {
    return someDescendant(
      fn,
      (node) =>
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee, { name }) &&
        node.arguments.some(
          (arg) =>
            someDescendant(arg, isHalvingExpression, () => false) ||
            someDescendant(
              arg,
              (n) => t.isIdentifier(n, { name: "mid" }),
              () => false,
            ),
        ),
      (node) => node !== fn && t.isFunction(node),
    );
  }

  private looksMemoized(fn: FunctionNode): boolean {
    return someDescendant(
      fn,
      (node) =>
        (t.isCallExpression(node) && calleeName(node)?.endsWith(".has") === true) ||
        (t.isBinaryExpression(node) && node.operator === "in") ||
        (t.isIdentifier(node) && /memo|cache|^dp$/i.test(node.name)),
      () => false,
    );
  }

  private nameOf(fn: FunctionNode): string | null {
    for (const [name, node] of this.functions) if (node === fn) return name;
    return null;
  }
}

export const analyzeComplexity = (program: BabelTypes.Program): StaticComplexity =>
  new JsComplexityAnalyzer(program).analyze();
