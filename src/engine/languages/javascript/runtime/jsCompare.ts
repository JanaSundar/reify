import {
  isObjectLike,
  mapEntries,
  ownFields,
  readOwnData,
  setValues,
  shapeOf,
  collectionSize,
  type JsObject,
} from "./jsValues";

const sameValue = (a: unknown, b: unknown): boolean =>
  a === b || (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b));

/**
 * Structural equality for test expectations (pure, cycle-safe, never runs getters).
 * Arrays compare in order; plain objects and class instances compare by own fields
 * (so `{ val: 1 }` equals a `ListNode` with `val: 1`); Maps and Sets ignore order.
 */
export const deepEqual = (
  a: unknown,
  b: unknown,
  seen = new Map<JsObject, JsObject>(),
): boolean => {
  if (sameValue(a, b)) return true;
  if (!isObjectLike(a) || !isObjectLike(b)) return false;
  if (seen.get(a) === b) return true;
  seen.set(a, b);
  const left = shapeOf(a);
  const right = shapeOf(b);
  if (left.kind === "record" || left.kind === "instance") {
    if (right.kind !== "record" && right.kind !== "instance") return false;
  } else if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case "list": {
      if (right.kind !== "list" || left.items.length !== right.items.length) return false;
      for (let i = 0; i < left.items.length; i++) {
        if (!deepEqual(readOwnData(a, i).value, readOwnData(b, i).value, seen)) return false;
      }
      return true;
    }
    case "map": {
      if (right.kind !== "map" || collectionSize(left.map) !== collectionSize(right.map))
        return false;
      const others = mapEntries(right.map, Number.POSITIVE_INFINITY);
      return mapEntries(left.map, Number.POSITIVE_INFINITY).every(([key, value]) =>
        others.some(([k, v]) => deepEqual(key, k, seen) && deepEqual(value, v, seen)),
      );
    }
    case "set": {
      if (right.kind !== "set" || collectionSize(left.set) !== collectionSize(right.set))
        return false;
      const others = setValues(right.set, Number.POSITIVE_INFINITY);
      return setValues(left.set, Number.POSITIVE_INFINITY).every((item) =>
        others.some((o) => deepEqual(item, o, seen)),
      );
    }
    case "record":
    case "instance": {
      const fieldsA = ownFields(a);
      const fieldsB = new Map(ownFields(b));
      if (fieldsA.length !== fieldsB.size) return false;
      return fieldsA.every(([key, descriptor]) => {
        const other = fieldsB.get(key);
        return (
          other !== undefined &&
          "value" in descriptor &&
          "value" in other &&
          deepEqual(descriptor.value, other.value, seen)
        );
      });
    }
    case "callable":
    case "opaque":
      return false;
  }
};

const MAX_WALK = 1_000_000;

/**
 * Input size `n` of a call: the number of elements, nodes and characters reachable from the
 * arguments. When every argument is a number (e.g. `fib(30)`), `n` is the largest of them.
 */
export const measureInputSize = (args: readonly unknown[]): number => {
  const visited = new Set<JsObject>();
  let size = 0;
  let largestNumber = 0;
  let structured = false;

  const visit = (value: unknown, topLevel: boolean): void => {
    if (size > MAX_WALK) return;
    if (typeof value === "string") {
      if (topLevel) structured = true;
      size += topLevel ? value.length : 1;
      return;
    }
    if (!isObjectLike(value)) {
      if (topLevel && typeof value === "number" && Number.isFinite(value)) {
        largestNumber = Math.max(largestNumber, Math.abs(Math.trunc(value)));
      } else if (!topLevel) {
        size += 1;
      }
      return;
    }
    if (visited.has(value)) return;
    visited.add(value);
    structured = true;
    const shape = shapeOf(value);
    switch (shape.kind) {
      case "list":
        for (let i = 0; i < shape.items.length; i++) visit(readOwnData(value, i).value, false);
        return;
      case "set":
        for (const item of setValues(shape.set, MAX_WALK)) visit(item, false);
        return;
      case "map":
        for (const [, item] of mapEntries(shape.map, MAX_WALK)) visit(item, false);
        return;
      case "record":
      case "instance": {
        // A node (linked list, tree) counts once; its object-valued fields are followed.
        size += 1;
        for (const [, descriptor] of ownFields(value)) {
          if ("value" in descriptor && isObjectLike(descriptor.value))
            visit(descriptor.value, false);
        }
        return;
      }
      default:
        return;
    }
  };

  for (const arg of args) visit(arg, true);
  return structured ? size : largestNumber;
};
