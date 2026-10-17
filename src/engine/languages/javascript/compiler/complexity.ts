import type {
  CostFunction,
  CostNode,
  CostShape,
  Recursion,
} from "../../../core/analysis/staticEstimate";
import { t, type BabelTypes } from "./babel";

type Node = BabelTypes.Node;
type FunctionNode = BabelTypes.Function;

/**
 * Describes the cost-relevant shape of a JavaScript program for the static complexity
 * estimate: which loops run over which sizes, which built-ins scan or sort, which user
 * functions are called and how they recurse. It does no arithmetic;
 * `core/analysis/staticEstimate.ts` turns the shape into an estimate and its explanation.
 */

const LABEL_LIMIT = 48;

/** Built-in methods that walk the whole receiver (O(n) per call). */
const LINEAR_METHODS = new Set([
  "includes",
  "indexOf",
  "lastIndexOf",
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

/** Functions that walk their first argument. */
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

/** Calls whose size is their receiver's or first argument's: `Object.keys(o)`, `xs.entries()`. */
const SAME_SIZE_METHODS = new Set([
  "keys",
  "values",
  "entries",
  "slice",
  "toReversed",
  "toSorted",
  "map",
]);
const SAME_SIZE_STATICS = new Set(["Object.keys", "Object.values", "Object.entries", "Array.from"]);

const isHalvingExpression = (node: Node): boolean =>
  (t.isBinaryExpression(node) &&
    ((["/", "*"].includes(node.operator) && t.isNumericLiteral(node.right, { value: 2 })) ||
      ([">>", ">>>"].includes(node.operator) && t.isNumericLiteral(node.right, { value: 1 })))) ||
  (t.isAssignmentExpression(node) &&
    ((["/=", "*="].includes(node.operator) && t.isNumericLiteral(node.right, { value: 2 })) ||
      ([">>=", ">>>="].includes(node.operator) && t.isNumericLiteral(node.right, { value: 1 }))));

/** Visits the children of a node. */
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
  stopAt: (n: Node) => boolean = () => false,
): boolean =>
  predicate(node) ||
  children(node).some((child) => !stopAt(child) && someDescendant(child, predicate, stopAt));

const staticName = (callee: Node): string | null =>
  t.isMemberExpression(callee) &&
  !callee.computed &&
  t.isIdentifier(callee.object) &&
  t.isIdentifier(callee.property)
    ? `${callee.object.name}.${callee.property.name}`
    : null;

const methodName = (callee: Node): string | null =>
  t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property)
    ? callee.property.name
    : null;

/** `found` with built-ins of unknown size measured as `name`: in `const a = [3, 1].toSorted()`
 * the sort's size is the size of `a`. */
const measuredAs = (found: readonly CostNode[], name: string): CostNode[] =>
  found.map((node) =>
    node.kind === "scan" && node.over === null ? { ...node, over: name } : node,
  );

const lineOf = (node: Node): number => node.loc?.start.line ?? 0;

const isLoop = (node: Node): node is BabelTypes.Loop => t.isLoop(node);

/** A user function a call can target: `f(...)` a function, `obj.f(...)` a class method. */
interface UserFunctions {
  readonly functions: ReadonlyMap<string, FunctionNode>;
  readonly methods: ReadonlyMap<string, FunctionNode>;
}

const collectFunctions = (root: Node): UserFunctions => {
  const functions = new Map<string, FunctionNode>();
  const methods = new Map<string, FunctionNode>();
  const visit = (node: Node): void => {
    if (t.isFunctionDeclaration(node) && node.id) functions.set(node.id.name, node);
    if (
      t.isVariableDeclarator(node) &&
      t.isIdentifier(node.id) &&
      (t.isFunctionExpression(node.init) || t.isArrowFunctionExpression(node.init))
    ) {
      functions.set(node.id.name, node.init);
    }
    if (t.isClassMethod(node) && t.isIdentifier(node.key) && node.kind === "method")
      methods.set(node.key.name, node);
    children(node).forEach(visit);
  };
  visit(root);
  return { functions, methods };
};

const nameOf = (fn: FunctionNode, user: UserFunctions): string => {
  for (const [name, node] of [...user.functions, ...user.methods]) if (node === fn) return name;
  return "anonymous";
};

const keyOf = (fn: FunctionNode, user: UserFunctions): string =>
  `${nameOf(fn, user)}@${lineOf(fn)}`;

class ShapeBuilder {
  private readonly user: UserFunctions;

  constructor(
    private readonly program: BabelTypes.Program,
    private readonly source: string,
  ) {
    this.user = collectFunctions(program);
  }

  build(): CostShape {
    const all = [...new Set([...this.user.functions.values(), ...this.user.methods.values()])];
    return {
      body: this.nodes(this.program.body),
      functions: Object.fromEntries(
        all.map((fn) => [keyOf(fn, this.user), this.function(fn)] as const),
      ),
      aliases: this.aliases(this.program),
    };
  }

  /** The size a value copies or measures: `ys = xs.slice()`, `n = xs.length`, `[...xs]`. */
  private aliasOf(value: Node | null | undefined): string | null {
    if (!value) return null;
    if (t.isIdentifier(value)) return value.name;
    if (t.isMemberExpression(value))
      return !value.computed && t.isIdentifier(value.property, { name: "length" })
        ? this.sizeOf(value)
        : null;
    if (t.isCallExpression(value)) return this.sizeOf(value);
    if (
      t.isArrayExpression(value) &&
      value.elements.length === 1 &&
      t.isSpreadElement(value.elements[0])
    )
      return this.sizeOf(value.elements[0].argument);
    return null;
  }

  /** `{ name: size }` for names assigned another size in `root` (not in nested functions). */
  private aliases(root: Node): Record<string, string> {
    const found: Record<string, string> = {};
    const record = (target: Node, value: Node | null | undefined) => {
      const alias = this.aliasOf(value);
      if (t.isIdentifier(target) && alias !== null && alias !== target.name)
        found[target.name] = alias;
    };
    const visit = (node: Node): void => {
      if (node !== root && t.isFunction(node)) return;
      if (t.isVariableDeclarator(node)) record(node.id, node.init);
      if (t.isAssignmentExpression(node) && node.operator === "=") record(node.left, node.right);
      children(node).forEach(visit);
    };
    visit(root);
    return found;
  }

  // ------------------------------------------------------------------ sizes and labels

  private label(node: Node, end: Node | null = null): string {
    const text = this.source
      .slice(node.start ?? 0, end?.start ?? node.end ?? 0)
      .replace(/\s+/g, " ")
      .replace(/[\s{]+$/, "")
      .trim();
    return text.length <= LABEL_LIMIT ? text : `${text.slice(0, LABEL_LIMIT - 1)}…`;
  }

  /** The size an expression stands for, by source name: `xs`, `xs.length`, `Object.keys(o)`. */
  private sizeOf(node: Node | null | undefined): string | null {
    if (!node) return null;
    if (t.isIdentifier(node)) return node.name;
    if (t.isMemberExpression(node)) {
      if (!node.computed && t.isIdentifier(node.property, { name: "length" }))
        return this.sizeOf(node.object);
      return this.label(node);
    }
    if (t.isCallExpression(node)) {
      const name = staticName(node.callee);
      if (name && SAME_SIZE_STATICS.has(name)) return this.sizeOf(node.arguments[0]);
      const method = methodName(node.callee);
      if (method && SAME_SIZE_METHODS.has(method) && t.isMemberExpression(node.callee))
        return this.sizeOf(node.callee.object);
      return null;
    }
    if (
      t.isBinaryExpression(node) &&
      ["+", "-", "*", "/", "%", ">>", ">>>"].includes(node.operator)
    )
      return this.sizeOf(node.left) ?? this.sizeOf(node.right);
    return null;
  }

  /** What a loop condition bounds: `i < xs.length` → xs, `while (queue.length)` → queue. */
  private sizeOfTest(test: Node | null | undefined): string | null {
    if (!test) return null;
    if (t.isBinaryExpression(test) && ["<", "<=", ">", ">=", "!=", "!=="].includes(test.operator))
      return this.sizeOf(test.right);
    return this.sizeOf(test);
  }

  private halvedName(loop: Node): string | null {
    let found: string | null = null;
    someDescendant(loop, (node) => {
      if (t.isAssignmentExpression(node) && isHalvingExpression(node) && t.isIdentifier(node.left))
        found = node.left.name;
      return found !== null;
    });
    return found;
  }

  // ------------------------------------------------------------------ nodes

  private nodes(list: readonly (Node | null | undefined)[]): CostNode[] {
    return list.flatMap((node) => (node ? this.node(node) : []));
  }

  private node(node: Node): CostNode[] {
    if (t.isFunction(node)) return []; // a definition costs nothing until called
    if (isLoop(node)) return this.loop(node);
    if (t.isCallExpression(node)) return this.call(node);
    if (t.isVariableDeclarator(node) && t.isIdentifier(node.id) && node.init)
      return measuredAs(this.node(node.init), node.id.name);
    if (t.isSpreadElement(node))
      return [...this.node(node.argument), this.scan(node, this.sizeOf(node.argument))];
    return this.nodes(children(node));
  }

  private loop(node: BabelTypes.Loop): CostNode[] {
    const halving = someDescendant(
      node,
      isHalvingExpression,
      (n) => t.isFunction(n) || (isLoop(n) && n !== node),
    );
    const make = (over: string | null, body: CostNode[]): CostNode => ({
      kind: "loop",
      line: lineOf(node),
      label: this.label(node, node.body),
      over: halving ? this.halvedName(node) : over,
      halving,
      body,
    });
    if (t.isForXStatement(node))
      return [
        ...this.node(node.right),
        make(this.sizeOf(node.right), this.nodes([node.left, node.body])),
      ];
    if (t.isForStatement(node))
      return [
        ...this.nodes([node.init]),
        make(this.sizeOfTest(node.test), this.nodes([node.test, node.update, node.body])),
      ];
    const { test, body } = node as BabelTypes.WhileStatement | BabelTypes.DoWhileStatement;
    return [make(this.sizeOfTest(test), this.nodes([test, body]))];
  }

  private scan(
    node: Node,
    over: string | null,
    sort = false,
    each: readonly CostNode[] = [],
  ): CostNode {
    return { kind: "scan", line: lineOf(node), label: this.label(node), over, sort, each };
  }

  private resolve(callee: Node): FunctionNode | null {
    if (t.isIdentifier(callee)) return this.user.functions.get(callee.name) ?? null;
    const method = methodName(callee);
    return method ? (this.user.methods.get(method) ?? null) : null;
  }

  private call(node: BabelTypes.CallExpression): CostNode[] {
    const { callee } = node;
    const receiver = t.isMemberExpression(callee) ? this.node(callee.object) : [];
    const found = [...receiver, ...this.nodes(node.arguments)];
    const user = this.resolve(callee);
    if (user) {
      return [
        ...found,
        {
          kind: "call",
          line: lineOf(node),
          label: this.label(node),
          fn: keyOf(user, this.user),
          args: node.arguments.map((arg) => this.sizeOf(arg)),
        },
      ];
    }
    return [...found, ...this.builtin(node)];
  }

  private builtin(node: BabelTypes.CallExpression): CostNode[] {
    const name = staticName(node.callee);
    if (name && LINEAR_STATICS.has(name)) return [this.scan(node, this.sizeOf(node.arguments[0]))];
    const method = methodName(node.callee);
    if (!method || !t.isMemberExpression(node.callee)) return [];
    const over = this.sizeOf(node.callee.object);
    if (SORT_METHODS.has(method)) return [this.scan(node, over, true, this.callbackWork(node))];
    if (CALLBACK_METHODS.has(method))
      return [this.scan(node, over, false, this.callbackWork(node))];
    if (LINEAR_METHODS.has(method)) return [this.scan(node, over)];
    return [];
  }

  /** Work done by one call of an inline callback argument (map/filter/sort comparators). */
  private callbackWork(node: BabelTypes.CallExpression): CostNode[] {
    const callback = node.arguments.find(
      (a): a is BabelTypes.ArrowFunctionExpression | BabelTypes.FunctionExpression =>
        t.isArrowFunctionExpression(a) || t.isFunctionExpression(a),
    );
    return callback ? this.nodes([callback.body]) : [];
  }

  // ------------------------------------------------------------------ functions

  private function(fn: FunctionNode): CostFunction {
    const calls = this.selfCalls(fn);
    return {
      name: nameOf(fn, this.user),
      params: fn.params.map((param, i) =>
        t.isIdentifier(param)
          ? param.name
          : t.isAssignmentPattern(param) && t.isIdentifier(param.left)
            ? param.left.name
            : `#${i}`,
      ),
      recursion: this.recursion(fn, calls),
      selfCalls: calls.length,
      body: this.nodes([fn.body]),
      aliases: this.aliases(fn),
    };
  }

  private recursion(fn: FunctionNode, calls: readonly BabelTypes.CallExpression[]): Recursion {
    if (calls.length === 0) return "none";
    const halving = calls.some((call) =>
      call.arguments.some((arg) =>
        someDescendant(arg, (n) => isHalvingExpression(n) || t.isIdentifier(n, { name: "mid" })),
      ),
    );
    if (calls.length === 1) return halving ? "halving" : "linear";
    if (halving) return "split";
    return this.looksMemoized(fn) ? "memoized" : "exponential";
  }

  /** Calls of `fn` inside itself, not entering nested functions. */
  private selfCalls(fn: FunctionNode): BabelTypes.CallExpression[] {
    const found: BabelTypes.CallExpression[] = [];
    const visit = (node: Node): void => {
      if (node !== fn && t.isFunction(node)) return;
      if (t.isCallExpression(node) && this.resolve(node.callee) === fn) found.push(node);
      children(node).forEach(visit);
    };
    visit(fn);
    return found;
  }

  private looksMemoized(fn: FunctionNode): boolean {
    return someDescendant(
      fn,
      (node) =>
        (t.isCallExpression(node) && methodName(node.callee) === "has") ||
        (t.isBinaryExpression(node) && node.operator === "in") ||
        (t.isIdentifier(node) && /memo|cache|^dp$/i.test(node.name)),
    );
  }
}

/** The cost shape of a program (read only: call it before instrumenting). */
export const complexityShape = (program: BabelTypes.Program, source: string): CostShape =>
  new ShapeBuilder(program, source).build();
