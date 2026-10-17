import type {
  BindingInfo,
  BindingKind,
  Diagnostic,
  FileId,
  LocInfo,
  LocRole,
  SourceRange,
} from "../../../core/protocol/program";
import { SINGLE_FILE_ID } from "../../../core/protocol/program";
import { TRACER_PARAM } from "../traceApi";
import { t, type BabelTypes, type NodePath } from "./babel";

type Node = BabelTypes.Node;
type Binding = NonNullable<ReturnType<NodePath["scope"]["getBinding"]>>;

export const rangeOf = (start: Node, end: Node = start): SourceRange | null =>
  start.loc && end.loc
    ? {
        line: start.loc.start.line,
        column: start.loc.start.column,
        endLine: end.loc.end.line,
        endColumn: end.loc.end.column,
      }
    : null;

/** The part of a statement that "executes" at its step (e.g. an `if` header, not its body). */
const headRange = (node: Node): SourceRange | null => {
  const until = (end: Node | null | undefined): SourceRange | null => {
    if (!node.loc || !end?.loc) return rangeOf(node);
    return {
      line: node.loc.start.line,
      column: node.loc.start.column,
      endLine: end.loc.start.line,
      endColumn: end.loc.start.column,
    };
  };
  switch (node.type) {
    case "IfStatement":
      return rangeOf(node, node.test);
    case "SwitchStatement":
      return rangeOf(node, node.discriminant);
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
      return until(node.body);
    case "DoWhileStatement":
      return rangeOf(node.test);
    case "LabeledStatement":
      return headRange(node.body);
    default:
      return rangeOf(node);
  }
};

/** The sub-trees whose variable reads are attributed to a construct's step. */
const readRoots = (node: Node): Node[] => {
  switch (node.type) {
    case "IfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
      return [node.test];
    case "ForStatement":
      return [node.init, node.test, node.update].filter((n): n is NonNullable<typeof n> => !!n);
    case "ForInStatement":
    case "ForOfStatement":
      return [node.right];
    case "SwitchStatement":
      return [node.discriminant];
    case "LabeledStatement":
      return readRoots(node.body);
    case "BlockStatement":
    case "TryStatement":
    case "FunctionDeclaration":
    case "ClassDeclaration":
      return [];
    default:
      return [node];
  }
};

const MAX_READS = 8;

/** Identifiers read by user code in a subtree (skips nested functions and generated code). */
export const collectReads = (roots: readonly Node[]): string[] => {
  const names = new Set<string>();
  const visit = (node: Node, parent: Node | null): void => {
    if (names.size >= MAX_READS) return;
    if (t.isFunction(node) || t.isClass(node)) return;
    if (t.isIdentifier(node)) {
      if (node.loc && node.name !== TRACER_PARAM && (!parent || t.isReferenced(node, parent))) {
        names.add(node.name);
      }
      return;
    }
    const keys = t.VISITOR_KEYS[node.type] ?? [];
    for (const key of keys) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const item of child) if (item && typeof item === "object") visit(item as Node, node);
      } else if (child && typeof child === "object") {
        visit(child as Node, node);
      }
    }
  };
  for (const root of roots) visit(root, null);
  return [...names];
};

/** Interns source locations; the instrumented code refers to them by index. */
export class LocTable {
  private readonly entries: LocInfo[] = [];

  constructor(private readonly file: FileId = SINGLE_FILE_ID) {}

  private readonly cache = new WeakMap<Node, Map<LocRole, number>>();

  get locs(): readonly LocInfo[] {
    return this.entries;
  }

  /** Registers a construct by its head range; returns `null` for generated nodes. */
  register(
    node: Node,
    role: LocRole,
    explicit?: { range: SourceRange; reads: Node[] },
  ): number | null {
    const cached = this.cache.get(node)?.get(role);
    if (cached !== undefined) return cached;
    const range = explicit?.range ?? headRange(node);
    if (!range) return null;
    const reads = collectReads(explicit?.reads ?? readRoots(node));
    const id = this.entries.push({ ...range, file: this.file, role, reads }) - 1;
    const byRole = this.cache.get(node) ?? new Map<LocRole, number>();
    byRole.set(role, id);
    this.cache.set(node, byRole);
    return id;
  }
}

const bindingKindOf = (binding: Binding): BindingKind => {
  if (binding.path.isClassDeclaration()) return "class";
  if (binding.path.isCatchClause() || binding.path.parentPath?.isCatchClause()) return "catch";
  switch (binding.kind) {
    case "var":
    case "let":
    case "const":
    case "param":
      return binding.kind;
    case "hoisted":
      return "function";
    default:
      return "const";
  }
};

/** Assigns stable ids to lexical bindings (and implicit globals by name). */
export class BindingTable {
  private readonly entries: BindingInfo[] = [];
  private readonly ids = new Map<Binding, number>();
  private readonly globals = new Map<string, number>();

  get bindings(): readonly BindingInfo[] {
    return this.entries;
  }

  idOf(binding: Binding): number {
    const known = this.ids.get(binding);
    if (known !== undefined) return known;
    const id =
      this.entries.push({
        name: binding.identifier.name,
        kind: bindingKindOf(binding),
        line: binding.identifier.loc?.start.line ?? 0,
      }) - 1;
    this.ids.set(binding, id);
    return id;
  }

  /** Resolves an identifier in scope; unresolved names become implicit globals. */
  resolve(path: NodePath, name: string): number {
    const binding = path.scope.getBinding(name);
    if (binding) return this.idOf(binding);
    const known = this.globals.get(name);
    if (known !== undefined) return known;
    const id = this.entries.push({ name, kind: "global", line: 0 }) - 1;
    this.globals.set(name, id);
    return id;
  }
}

/** Collects diagnostics produced while compiling. */
export class DiagnosticLog {
  readonly errors: Diagnostic[] = [];
  readonly warnings: Diagnostic[] = [];

  error(code: string, message: string, node: Node | null): void {
    this.errors.push({ severity: "error", code, message, range: node ? rangeOf(node) : null });
  }

  warn(code: string, message: string, node: Node | null): void {
    if (this.warnings.some((w) => w.code === code && w.range?.line === node?.loc?.start.line))
      return;
    this.warnings.push({ severity: "warning", code, message, range: node ? rangeOf(node) : null });
  }
}
