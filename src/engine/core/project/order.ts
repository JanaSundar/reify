import type { ProjectGraph } from "./types";

/**
 * Module evaluation order as ES modules define it: a module's imports run first, in source
 * order, then the module itself. A module reached again while it is still being visited
 * (a cycle) is skipped, so in `a ⇄ b` entered at `a`, `b` runs before `a`.
 */
export const evaluationOrder = (graph: ProjectGraph): readonly string[] => {
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (path: string): void => {
    const node = graph.modules.get(path);
    if (!node || visited.has(path)) return;
    visited.add(path);
    for (const { target } of node.imports) visit(target);
    order.push(path);
  };
  visit(graph.entry);
  return order;
};

/** Groups of modules that import each other (including a module importing itself). */
export const findCycles = (graph: ProjectGraph): readonly (readonly string[])[] => {
  // Tarjan's strongly connected components.
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  const connect = (path: string): void => {
    index.set(path, index.size);
    low.set(path, index.get(path)!);
    stack.push(path);
    onStack.add(path);
    const node = graph.modules.get(path)!;
    for (const { target } of node.imports) {
      if (!index.has(target)) {
        connect(target);
        low.set(path, Math.min(low.get(path)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(path, Math.min(low.get(path)!, index.get(target)!));
      }
    }
    if (low.get(path) !== index.get(path)) return;
    const group: string[] = [];
    for (let member = stack.pop()!; ; member = stack.pop()!) {
      onStack.delete(member);
      group.push(member);
      if (member === path) break;
    }
    const selfImport = group.length === 1 && node.imports.some(({ target }) => target === path);
    if (group.length > 1 || selfImport) cycles.push(group.toReversed());
  };

  for (const path of graph.modules.keys()) if (!index.has(path)) connect(path);
  return cycles;
};

/** The changed modules plus every module that (transitively) imports one of them. */
export const dependentsOf = (
  graph: ProjectGraph,
  changed: Iterable<string>,
): ReadonlySet<string> => {
  const importers = new Map<string, string[]>();
  for (const node of graph.modules.values())
    for (const { target } of node.imports)
      importers.set(target, [...(importers.get(target) ?? []), node.path]);
  const affected = new Set<string>();
  const pending = [...changed];
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    if (affected.has(path)) continue;
    affected.add(path);
    pending.push(...(importers.get(path) ?? []));
  }
  return affected;
};
