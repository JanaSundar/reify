import {
  add,
  contributes,
  exponentialIn,
  formatCost,
  isConstant,
  logOf,
  multiply,
  ONE,
  renameCost,
  SIZE_LETTERS,
  size,
  variablesIn,
  type Cost,
} from "./cost";

/**
 * Static complexity from the shape of the code. A language analyzer reports only that shape
 * ({@link CostShape}: loops and what they run over, built-ins that scan or sort, calls and
 * recursion); this module does the arithmetic, names the input sizes and explains every
 * step, so all languages estimate and explain alike. All functions are pure.
 */

// ---------------------------------------------------------------- shape (analyzer output)

export type CostNode =
  | {
      readonly kind: "loop";
      readonly line: number;
      readonly label: string;
      /** The size the loop runs over (a collection or bound, by source name), if known. */
      readonly over: string | null;
      /** The loop halves (or doubles) its range each iteration. */
      readonly halving: boolean;
      readonly body: readonly CostNode[];
    }
  | {
      /** A built-in that visits every element once (or sorts) of `over`. */
      readonly kind: "scan";
      readonly line: number;
      readonly label: string;
      readonly over: string | null;
      readonly sort: boolean;
      /** Work done per element, e.g. a callback or sort key. */
      readonly each: readonly CostNode[];
    }
  | {
      readonly kind: "call";
      readonly line: number;
      readonly label: string;
      /** Key into {@link CostShape.functions}. */
      readonly fn: string;
      /** Size passed for each positional parameter, by source name. */
      readonly args: readonly (string | null)[];
    };

export type Recursion = "none" | "linear" | "halving" | "split" | "exponential" | "memoized";

export interface CostFunction {
  readonly name: string;
  /** Positional parameters, by name (a method's receiver excluded). */
  readonly params: readonly string[];
  readonly recursion: Recursion;
  readonly selfCalls: number;
  readonly body: readonly CostNode[];
  /** Names that hold another size, e.g. `ys = sorted(xs)` or `n = len(xs)`: `{ ys: "xs" }`. */
  readonly aliases: Readonly<Record<string, string>>;
}

export interface CostShape {
  readonly body: readonly CostNode[];
  readonly functions: Readonly<Record<string, CostFunction>>;
  readonly aliases: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------- estimate

/** One cost-bearing construct and how its cost arises: `total = repeats × each`. */
export interface CostStep {
  readonly kind: CostNode["kind"];
  readonly line: number;
  readonly label: string;
  /** How often the inner work runs: iterations, elements, recursive calls. */
  readonly repeats: Cost;
  /** Cost of one repetition: the loop body, the per-element work, the function body. */
  readonly each: Cost;
  readonly total: Cost;
  /** Why, in words, e.g. "runs once per element of xs: n iterations". */
  readonly reason: string;
  /** For calls: how the function recurses. */
  readonly recursion: Recursion | null;
  /** Whether this step's cost survives when added to its siblings'. */
  readonly dominant: boolean;
  readonly children: readonly CostStep[];
}

/** A size variable in the estimate and what it measures. */
export interface SizeVariable {
  readonly name: string;
  /** The collection or bound it stands for, or null for "the input". */
  readonly of: string | null;
}

export interface StaticComplexity {
  readonly time: Cost;
  readonly sizes: readonly SizeVariable[];
  /** The top-level cost-bearing steps; their sum is `time`. */
  readonly steps: readonly CostStep[];
}

/** The input, when an analyzer cannot tell which size something runs over. */
const INPUT = "";

/** Names conventionally used for sizes, kept as they are: `range(k)` is `O(k)`. */
const SIZE_NAMES = new Set(["n", "m", "k"]);

/** A step before sizes are named; `reason` renders costs once letters are known. */
interface RawStep {
  readonly kind: CostNode["kind"];
  readonly line: number;
  readonly label: string;
  readonly repeats: Cost;
  readonly each: Cost;
  readonly total: Cost;
  readonly reason: (show: (cost: Cost) => string) => string;
  readonly recursion: Recursion | null;
  readonly children: readonly RawStep[];
}

const sumOf = (steps: readonly RawStep[]): Cost => add(...steps.map((s) => s.total));

const loopStep = (
  node: Extract<CostNode, { kind: "loop" }>,
  over: string,
  children: readonly RawStep[],
): RawStep => {
  const repeats = node.halving ? logOf(over) : size(over);
  const each = sumOf(children);
  return {
    kind: "loop",
    line: node.line,
    label: node.label,
    repeats,
    each,
    total: multiply(repeats, each),
    reason: (show) =>
      node.halving
        ? `halves its range each time: ${show(repeats)} iterations`
        : over === INPUT
          ? `assumed to run over the input: ${show(repeats)} iterations`
          : `runs once per element of ${over}: ${show(repeats)} iterations`,
    recursion: null,
    children,
  };
};

const scanStep = (
  node: Extract<CostNode, { kind: "scan" }>,
  over: string,
  children: readonly RawStep[],
): RawStep => {
  const repeats = node.sort ? multiply(size(over), logOf(over)) : size(over);
  const each = sumOf(children);
  const what = over === INPUT ? "the input" : over;
  return {
    kind: "scan",
    line: node.line,
    label: node.label,
    repeats,
    each,
    total: multiply(repeats, each),
    reason: (show) =>
      node.sort
        ? `sorts ${what}: about ${show(repeats)} comparisons`
        : `visits every element of ${what}: ${show(repeats)} operations`,
    recursion: null,
    children,
  };
};

const recursionReason = (
  fn: CostFunction,
  v: string,
  body: Cost,
  show: (cost: Cost) => string,
): string => {
  const name = `\`${fn.name}\``;
  switch (fn.recursion) {
    case "none":
      return `${name} runs its body once per call`;
    case "linear":
      return `${name} recurses once per level: ${show(size(v))} levels`;
    case "halving":
      return `${name} recurses on half of its input: ${show(logOf(v))} levels`;
    case "split":
      return isConstant(body)
        ? `${name} splits its input in half and recurses on both parts: about ${show(size(v))} calls`
        : `${name} splits its input in half and recurses on both parts: ${show(logOf(v))} levels of ${show(body)} work`;
    case "exponential":
      return `${name} calls itself ${fn.selfCalls} times per call without memoization: about ${show(exponentialIn(v))} calls`;
    case "memoized":
      return `${name} is recursive with memoization: about one call per distinct input (${show(size(v))})`;
  }
};

/** How often a function's body runs per outside call, given its recursion. */
const recursionRepeats = (recursion: Recursion, v: string, body: Cost): Cost => {
  switch (recursion) {
    case "none":
      return ONE;
    case "linear":
    case "memoized":
      return size(v);
    case "halving":
      return logOf(v);
    case "split":
      return isConstant(body) ? size(v) : logOf(v);
    case "exponential":
      return exponentialIn(v);
  }
};

/** How sizes are named inside a function: its parameters' sizes from the call, aliases, and
 * what "the input" is when an analyzer cannot tell (the first parameter's size). */
interface Scope {
  readonly params: ReadonlyMap<string, string>;
  readonly aliases: Readonly<Record<string, string>>;
  readonly input: string;
}

/** The size a source name stands for in `scope`, following aliases to a parameter or root. */
const resolve = (source: string | null, scope: Scope): string => {
  if (source === null) return scope.input;
  let name = source;
  const seen = new Set<string>();
  while (Object.hasOwn(scope.aliases, name) && !seen.has(name)) {
    seen.add(name);
    name = scope.aliases[name]!;
  }
  return scope.params.get(name) ?? name;
};

const evaluate = (shape: CostShape): RawStep[] => {
  const active = new Set<string>();

  const nodes = (list: readonly CostNode[], sizes: Scope): RawStep[] =>
    list.flatMap((node) => {
      const step = evaluateNode(node, sizes);
      return step && !(isConstant(step.total) && step.children.length === 0) ? [step] : [];
    });

  const evaluateNode = (node: CostNode, sizes: Scope): RawStep | null => {
    switch (node.kind) {
      case "loop":
        return loopStep(node, resolve(node.over, sizes), nodes(node.body, sizes));
      case "scan":
        return scanStep(node, resolve(node.over, sizes), nodes(node.each, sizes));
      case "call":
        return callStep(node, sizes);
    }
  };

  const callStep = (node: Extract<CostNode, { kind: "call" }>, sizes: Scope): RawStep | null => {
    const fn = shape.functions[node.fn];
    if (!fn || active.has(node.fn)) return null; // a recursive call is costed by its function
    // An argument of unknown size (a literal) keeps the parameter as its own size.
    const params = new Map(
      fn.params.map((param, i) => {
        const arg = node.args[i] ?? null;
        return [param, arg === null ? param : resolve(arg, sizes)] as const;
      }),
    );
    const first = fn.params[0];
    const inner: Scope = {
      params,
      aliases: fn.aliases,
      input: first === undefined ? sizes.input : params.get(first)!,
    };
    active.add(node.fn);
    const children = nodes(fn.body, inner);
    active.delete(node.fn);
    const each = sumOf(children);
    const v = inner.input;
    const repeats = recursionRepeats(fn.recursion, v, each);
    const total = fn.recursion === "exponential" ? repeats : multiply(repeats, each);
    return {
      kind: "call",
      line: node.line,
      label: node.label,
      repeats,
      each,
      total,
      reason: (show) => recursionReason(fn, v, each, show),
      recursion: fn.recursion,
      children,
    };
  };

  return nodes(shape.body, { params: new Map(), aliases: shape.aliases, input: INPUT });
};

// ---------------------------------------------------------------- naming sizes

const walk = (steps: readonly RawStep[]): RawStep[] =>
  steps.flatMap((step) => [step, ...walk(step.children)]);

/** Letters for size sources: `n`, `m` and `k` keep their name, the rest get `n`, `m`, ... */
const nameSizes = (sources: readonly string[]): Map<string, string> => {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const source of sources) {
    if (SIZE_NAMES.has(source) && !taken.has(source)) {
      names.set(source, source);
      taken.add(source);
    }
  }
  for (const source of sources) {
    if (names.has(source)) continue;
    const letter = SIZE_LETTERS.find((l) => !taken.has(l)) ?? `n${names.size}`;
    names.set(source, letter);
    taken.add(letter);
  }
  return names;
};

const finish = (
  steps: readonly RawStep[],
  name: (source: string) => string,
  show: (cost: Cost) => string,
): CostStep[] => {
  const sum = sumOf(steps);
  return steps.map((step) => {
    const rename = (cost: Cost) => renameCost(cost, name);
    return {
      kind: step.kind,
      line: step.line,
      label: step.label,
      repeats: rename(step.repeats),
      each: rename(step.each),
      total: rename(step.total),
      reason: step.reason((cost) => show(rename(cost))),
      recursion: step.recursion,
      dominant: contributes(step.total, sum),
      children: finish(step.children, name, show),
    };
  });
};

/** Estimates and explains the time complexity of a program's shape. */
export const estimateStatic = (shape: CostShape): StaticComplexity => {
  const raw = evaluate(shape);
  const time = sumOf(raw);
  // Sizes are lettered in reading order: the first one the code meets is `n`.
  const sources = [
    ...new Set(walk(raw).flatMap((s) => variablesIn(s.repeats).concat(variablesIn(s.total)))),
  ];
  const names = nameSizes(sources);
  const name = (source: string) => names.get(source) ?? source;
  const order = sources.map(name);
  const show = (cost: Cost) => formatCost(cost, order);
  return {
    time: renameCost(time, name),
    sizes: sources.map((source) => ({
      name: name(source),
      of: source === INPUT ? null : source,
    })),
    steps: finish(raw, name, show),
  };
};
