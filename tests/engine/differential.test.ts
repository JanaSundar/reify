import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CORPUS, TYPESCRIPT_CORPUS } from "../corpus/programs";
import { runPlain, trace } from "../helpers";

/**
 * Differential tests: instrumented execution must produce the same observable behaviour
 * (console output, uncaught exception) as plain execution of the same program.
 */
const expectEquivalent = (source: string, typescript = false) => {
  const plain = runPlain(source, { typescript });
  const traced = trace(source, { typescript });
  expect(traced.output).toEqual(plain.output);
  if (plain.error) {
    expect(traced.outcome).toMatchObject({ kind: "exception", message: plain.error });
  } else {
    expect(traced.outcome).toEqual({ kind: "ok" });
  }
};

describe("instrumented vs plain execution", () => {
  for (const [name, source] of Object.entries(CORPUS)) {
    it(`matches for ${name}`, () => expectEquivalent(source));
  }
  for (const [name, source] of Object.entries(TYPESCRIPT_CORPUS)) {
    it(`matches for TypeScript ${name}`, () => expectEquivalent(source, true));
  }
});

/** Generates small random programs over variables, arrays, branches and loops. */
const programArbitrary = (() => {
  const v = fc.constantFrom("a", "b", "c");
  const small = fc.integer({ min: -5, max: 9 });
  const expr = fc.oneof(
    small.map(String),
    v,
    fc
      .tuple(v, fc.constantFrom("+", "-", "*", "%", "<", "===", "&&", "||"), small)
      .map(([x, op, n]) => `(${x} ${op} ${n})`),
    fc.tuple(v, small).map(([x, n]) => `arr[${Math.abs(n) % 4}] + ${x}`),
  );
  const stmt = fc.oneof(
    fc.tuple(v, expr).map(([x, e]) => `${x} = ${e};`),
    fc.tuple(v, fc.constantFrom("+=", "-=", "*=")).map(([x, op]) => `${x} ${op} 2;`),
    fc.tuple(v, fc.constantFrom("++", "--")).map(([x, op]) => `${x}${op};`),
    fc.tuple(small, expr).map(([i, e]) => `arr[${Math.abs(i) % 4}] = ${e};`),
    expr.map((e) => `arr.push(${e});`),
    fc
      .tuple(expr, v, v)
      .map(([e, x, y]) => `if (${e}) { ${x} = ${y} + 1; } else { ${y} = ${x} - 1; }`),
    fc
      .tuple(fc.integer({ min: 0, max: 4 }), v)
      .map(([n, x]) => `for (let i = 0; i < ${n}; i++) { ${x} += i; }`),
    fc.tuple(v, v).map(([x, y]) => `[${x}, ${y}] = [${y}, ${x}];`),
    expr.map((e) => `console.log(${e});`),
    fc.tuple(v, expr).map(([x, e]) => `${x} = helper(${e});`),
  );
  return fc
    .array(stmt, { minLength: 1, maxLength: 12 })
    .map(
      (body) =>
        `let a = 1, b = 2, c = 3; const arr = [0, 1, 2, 3];\nfunction helper(n) { return n > 3 ? n - 1 : n * 2; }\n${body.join("\n")}\nconsole.log(a, b, c, arr);`,
    );
})();

describe("property: random programs behave identically when instrumented", () => {
  it("matches plain execution", () => {
    fc.assert(
      fc.property(programArbitrary, (source) => {
        expectEquivalent(source);
      }),
      { numRuns: 150 },
    );
  });
});
