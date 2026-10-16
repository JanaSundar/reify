import type { TestSuite, TestTarget } from "@/engine/core/protocol/testing";
import { isValidEntryName } from "@/engine/core/protocol/testing";
import { newCaseId } from "./suite";

/**
 * The JSON file format for a test suite, so users can write cases in any editor and upload
 * them. Pure: parsing never touches the DOM or storage.
 *
 *   { "entry": "twoSum", "target": "return",
 *     "cases": [{ "args": [[2, 7, 11, 15], 9], "expected": [0, 1] }] }
 *
 * `args` is a JSON array (one item per argument) or a string of JavaScript source; `expected`
 * is any JSON value or a string of JavaScript source. Strings are kept verbatim.
 */
export const MAX_SUITE_CASES = 100;
export const MAX_SUITE_FILE_CHARS = 200_000;
const MAX_EXPRESSION_CHARS = 10_000;

const TARGETS: ReadonlySet<string> = new Set<TestTarget>(["return", "first-argument"]);

export type ParsedSuite = { readonly ok: true; readonly suite: TestSuite } | Failure;
interface Failure {
  readonly ok: false;
  readonly error: string;
}

const fail = (error: string): Failure => ({ ok: false, error });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `[[1, 2], 3]` becomes the argument source `[1, 2], 3`; a string is already source. */
const argsSource = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => JSON.stringify(item)).join(", ");
  return null;
};

const expectedSource = (value: unknown): string | null =>
  typeof value === "string" ? value : value === undefined ? null : JSON.stringify(value);

export const parseSuiteFile = (text: string): ParsedSuite => {
  if (text.length > MAX_SUITE_FILE_CHARS) return fail("That file is too large for a test suite.");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail("That file isn't valid JSON.");
  }
  if (!isRecord(data)) return fail("The file must contain a JSON object with an entry and cases.");

  const { entry, cases } = data;
  const target = data.target ?? "return";
  if (typeof entry !== "string" || !isValidEntryName(entry))
    return fail('"entry" must be the name of the function to test, such as "twoSum".');
  if (typeof target !== "string" || !TARGETS.has(target))
    return fail('"target" must be "return" or "first-argument".');
  if (!Array.isArray(cases)) return fail('"cases" must be a list.');
  if (cases.length > MAX_SUITE_CASES)
    return fail(`A suite can have up to ${MAX_SUITE_CASES} cases.`);

  const parsed: TestSuite["cases"][number][] = [];
  for (const [index, item] of cases.entries()) {
    const label = `Case ${index + 1}`;
    if (!isRecord(item)) return fail(`${label} must be an object with "args" and "expected".`);
    const args = argsSource(item.args);
    if (args === null) return fail(`${label}: "args" must be a list, such as [[1, 2], 3].`);
    const expected = expectedSource(item.expected);
    if (expected === null || expected.trim() === "")
      return fail(`${label} needs an "expected" value.`);
    if (args.length > MAX_EXPRESSION_CHARS || expected.length > MAX_EXPRESSION_CHARS)
      return fail(`${label} is too long.`);
    parsed.push({ id: newCaseId(), args, expected });
  }
  return { ok: true, suite: { entry, target: target as TestTarget, cases: parsed } };
};

/** A starter file for `entry` (the user's function when known) to edit and upload. */
export const suiteTemplate = (entry: string): string =>
  `${JSON.stringify(
    {
      notes: [
        "Edit this file, then upload it from the Tests tab. This 'notes' list is ignored.",
        "entry: the function to test. It must be declared in your code.",
        "target: 'return' compares the return value; 'first-argument' compares the first argument after the call, for functions that change it in place.",
        "args: one list item per argument. A string is used as JavaScript source, such as '[1, 2], 3'.",
        "expected: any JSON value. A string is used as JavaScript source.",
      ],
      entry: isValidEntryName(entry) ? entry : "myFunction",
      target: "return",
      cases: [
        { args: [1, 2], expected: 3 },
        { args: [[1, 2, 3], 2], expected: [1, 2] },
      ],
    },
    null,
    2,
  )}\n`;
