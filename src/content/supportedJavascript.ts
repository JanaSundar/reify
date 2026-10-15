/**
 * Single source of truth for the documented JavaScript/TypeScript subset. Rendered by
 * /docs/javascript and kept in sync with tests/engine (compiler diagnostics tests).
 */
export interface SupportSection {
  readonly title: string;
  readonly items: readonly string[];
}

export const SUPPORTED: readonly SupportSection[] = [
  {
    title: "Fully traced",
    items: [
      "Variable declarations (var, let, const), assignments, compound assignments and ++/--",
      "Destructuring assignments, including swaps like [a[i], a[j]] = [a[j], a[i]]",
      "Primitive values, arithmetic, comparison and logical expressions (short-circuit preserved)",
      "Arrays: indexed reads and writes, push/pop/shift/unshift/splice/sort/reverse/fill",
      "Objects and class instances: property writes, delete, Object.assign",
      "Map and Set: set/add/delete/clear",
      "if/else, ternaries, switch, while, do…while, for, for…of, for…in, labeled break/continue",
      "Function declarations, expressions, arrows, methods, constructors, closures and recursion",
      "Exceptions: throw, try/catch/finally, uncaught errors with their line",
      "console.log/info/warn/error/debug",
      "TypeScript type annotations, interfaces, enums and type assertions (types are removed before running)",
    ],
  },
  {
    title: "Executed, partially traced",
    items: [
      "Mutations through optional calls (a?.push(x)) are not recorded",
      "Mutations made by built-ins other than the listed methods (e.g. copying via structuredClone) appear when the object is next written",
      "Destructuring into targets with side effects (a[f()] in a pattern) is not recorded",
      "Getter/setter properties are shown as accessors; their values are not read by the visualizer",
      "Private class fields (#x) are not visible in the inspector",
      "Variables of closures whose frame already returned are listed under “Closures”",
    ],
  },
  {
    title: "Not supported (rejected with an error)",
    items: [
      "async/await and generator functions",
      "import/export and dynamic import()",
      "eval and the Function constructor",
      "with statements",
    ],
  },
  {
    title: "Limits",
    items: [
      "200,000 executed steps, 600,000 trace events and 2,000 nested calls per run",
      "10 seconds of wall-clock execution; the worker is terminated after that",
      "Collections show their first 1,000 entries; strings are cut after 500 characters",
      "Timers, network, storage and other browser capabilities are unavailable to your code",
    ],
  },
];
