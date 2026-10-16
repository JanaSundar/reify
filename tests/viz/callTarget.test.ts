import { describe, expect, it } from "vitest";
import { callTarget } from "@/features/flow/flowModel";
import { connectorPath } from "@/features/flow/CallConnector";
import { idOf, stepViews } from "./helpers";

const targets = (source: string) =>
  stepViews(source)
    .map((view) => ({ view, target: callTarget(view) }))
    .filter(({ target }) => target !== null);

describe("callTarget", () => {
  it("points a map callback at the element it received", () => {
    const found = targets(`const numbers = [2, 4, 6];
const doubled = numbers.map((n, i) => n * 2);`);
    expect(found.map(({ target }) => target!.index)).toContain(1);
    const { view, target } = found.find((match) => match.target!.index === 1)!;
    expect(target).toEqual({ id: idOf(view, "numbers"), index: 1, reason: "n = numbers[1]" });
  });

  it("stays silent when the parameters do not prove an element", () => {
    expect(
      targets(`const xs = [5, 6];
function f(a, b) { return a + b; }
f(9, 1);`),
    ).toEqual([]);
  });

  it("stays silent when two arrays match equally", () => {
    expect(
      targets(`const a = [1, 2];
const b = [1, 2];
function f(x, i) { return x; }
f(2, 1);`),
    ).toEqual([]);
  });

  it("uses an array parameter to disambiguate", () => {
    const found = targets(`const a = [1, 2];
const b = [1, 2];
b.forEach((x, i, arr) => x);`);
    expect(found.length).toBeGreaterThan(0);
    for (const { view, target } of found) expect(target!.id).toBe(idOf(view, "b"));
  });
});

describe("connectorPath", () => {
  const pill = { left: 100, right: 300, top: 100, bottom: 130 };

  it("rises straight from the pill when the cell is above it", () => {
    const { path, start } = connectorPath(pill, { x: 180, y: 40 });
    expect(start).toEqual({ x: 180, y: 100 });
    // Every point of the curve shares the cell's x.
    expect(path.match(/-?\d+\.\d/g)!.filter((_, i) => i % 2 === 0)).toEqual(Array(4).fill("180.0"));
  });

  it("arcs from the nearer side of the pill otherwise, ending under the cell", () => {
    const left = connectorPath(pill, { x: 40, y: 40 });
    expect(left.start).toEqual({ x: 100, y: 115 });
    expect(left.head).toContain("L 40.0 43.0");
    const right = connectorPath(pill, { x: 360, y: 40 });
    expect(right.start).toEqual({ x: 300, y: 115 });
  });
});
