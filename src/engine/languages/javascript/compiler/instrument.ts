import { NO_BINDING, TraceApi } from "../traceApi";
import { t, type BabelTypes, type NodePath, type Visitor } from "./babel";
import { freshClone, num, pairArgs, str, traceCall, traceStatement, undef } from "./builders";
import { inferFunctionName } from "./names";
import { rangeOf, type BindingTable, type DiagnosticLog, type LocTable } from "./tables";

type Node = BabelTypes.Node;
type Expression = BabelTypes.Expression;
type Statement = BabelTypes.Statement;
type Identifier = BabelTypes.Identifier;
type MemberExpression = BabelTypes.MemberExpression;
type Binding = NonNullable<ReturnType<NodePath["scope"]["getBinding"]>>;

/** Methods whose call mutates the receiver; the receiver is re-captured afterwards. */
const MUTATOR_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "delete",
  "clear",
  "add",
]);

/** Statements that do not get their own step. */
const NO_LINE_EVENT = new Set<Node["type"]>([
  "FunctionDeclaration",
  "EmptyStatement",
  "BlockStatement",
  "TryStatement",
  "DebuggerStatement",
  // `while` reports its own header on every condition check.
  "WhileStatement",
]);

const LEXICAL_KINDS = new Set(["let", "const"]);

const ARITHMETIC = new Set(["+", "-", "*", "/", "%", "**", "|", "&", "^", "<<", ">>", ">>>"]);

/** Expressions that can be re-evaluated without side effects (for destructuring targets). */
const isPure = (node: Node): boolean => {
  if (t.isIdentifier(node) || t.isThisExpression(node)) return true;
  if (t.isNumericLiteral(node) || t.isStringLiteral(node) || t.isBooleanLiteral(node)) return true;
  if (t.isMemberExpression(node)) {
    return isPure(node.object) && (!node.computed || isPure(node.property));
  }
  if (t.isBinaryExpression(node)) {
    return ARITHMETIC.has(node.operator) && isPure(node.left) && isPure(node.right);
  }
  if (t.isUnaryExpression(node)) return node.operator === "-" && isPure(node.argument);
  return false;
};

const bindingIdentifiers = (node: Node): Identifier[] =>
  Object.values(t.getBindingIdentifiers(node) as Record<string, Identifier>);

interface MemberRefs {
  /** Expression evaluating to the captured object (temp, `this`, ...). */
  readonly object: () => Expression;
  /** Expression evaluating to the property key, as passed to the tracer. */
  readonly key: () => Expression;
  /** A fresh member expression `object[key]` using the captured parts. */
  readonly target: () => MemberExpression;
}

/**
 * The JavaScript instrumentation pass.
 *
 * Fidelity rules (see docs/architecture.md):
 *  - wrap values, never restructure control flow: every original expression is evaluated
 *    exactly once and in its original order;
 *  - objects/keys of member writes are captured into temporaries before the write;
 *  - function bodies are wrapped in try/catch/finally so frames stay balanced on throw.
 */
export class Instrumenter {
  /** Original nodes already instrumented, and generated nodes that must be left alone. */
  private readonly handled = new WeakSet<Node>();
  /** Generated wrappers that stand in for an original statement (for line events). */
  private readonly lineAlias = new WeakMap<Node, Node>();

  constructor(
    private readonly locs: LocTable,
    private readonly bindings: BindingTable,
    private readonly log: DiagnosticLog,
  ) {}

  readonly visitor: Visitor = {
    // Register statement locations before children are rewritten, so head ranges and
    // variable reads are computed from the original code, in source order.
    Statement: {
      enter: (path) => {
        const { node } = path;
        const inner = t.isLabeledStatement(node) ? node.body : node;
        if (!node.loc) return;
        if (!NO_LINE_EVENT.has(inner.type)) this.locs.register(node, "statement");
        if (t.isIfStatement(node)) this.locs.register(node, "condition");
        if (t.isLoop(node)) this.locs.register(node, "loop");
        if (t.isForStatement(node) && node.test?.loc) {
          this.locs.register(node.test, "condition", {
            range: rangeOf(node.test)!,
            reads: [node.test],
          });
        }
      },
    },
    BlockStatement: { exit: (path) => this.onBlock(path) },
    SwitchCase: {
      exit: (path) => {
        if (this.claim(path.node)) path.node.consequent = this.withLineEvents(path.node.consequent);
      },
    },
    VariableDeclaration: { exit: (path) => this.onVariableDeclaration(path) },
    ClassDeclaration: { exit: (path) => this.onClassDeclaration(path) },
    AssignmentExpression: { exit: (path) => this.onAssignment(path) },
    UpdateExpression: { exit: (path) => this.onUpdate(path) },
    UnaryExpression: { exit: (path) => this.onDelete(path) },
    CallExpression: { exit: (path) => this.onCall(path) },
    IfStatement: { exit: (path) => this.onIf(path) },
    ConditionalExpression: { exit: (path) => this.onConditional(path) },
    WhileStatement: { exit: (path) => this.onWhile(path) },
    DoWhileStatement: { exit: (path) => this.onWhile(path) },
    ForStatement: { exit: (path) => this.onFor(path) },
    ForInStatement: { exit: (path) => this.onForEach(path) },
    ForOfStatement: { exit: (path) => this.onForEach(path) },
    ReturnStatement: { exit: (path) => this.onReturn(path) },
    CatchClause: { exit: (path) => this.onCatch(path) },
    Function: { exit: (path) => this.onFunction(path) },
  };

  /** Top-level statements and hoisted declarations; called after the traversal. */
  finishProgram(path: NodePath<BabelTypes.Program>): void {
    const { node } = path;
    const hoisted = this.hoistedDeclarations(path, node.body);
    node.body = [...hoisted, ...this.withLineEvents(node.body)];
  }

  // ---------------------------------------------------------------- helpers

  /** Returns true exactly once per original node; generated nodes are never claimed. */
  private claim(node: Node, requireLoc = true): boolean {
    if ((requireLoc && !node.loc) || this.handled.has(node)) return false;
    this.handled.add(node);
    return true;
  }

  private generated<T extends Node>(node: T): T {
    this.handled.add(node);
    return node;
  }

  private replace(path: NodePath, replacement: Expression): void {
    path.replaceWith(replacement);
    path.skip();
  }

  private bindingOf(binding: Binding): number {
    return this.bindings.idOf(binding);
  }

  private pairsFor(
    path: NodePath,
    ids: readonly Identifier[],
  ): Array<readonly [number, Expression]> {
    return ids.map((id) => [this.bindings.resolve(path, id.name), freshClone(id)] as const);
  }

  /** Allocates a function-scoped temporary (`var _o`) and returns a factory for references. */
  private temp(path: NodePath, base: string): () => Identifier {
    const scope = path.scope.getFunctionParent() ?? path.scope.getProgramParent();
    const id = scope.generateUidIdentifier(base);
    scope.push({ id: freshClone(id) });
    return () => freshClone(id);
  }

  /**
   * Captures the object (and computed key) of a member expression into temporaries so
   * they are evaluated exactly once, in their original order. Returns the prelude
   * assignments and references to the captured parts.
   */
  private captureMember(
    path: NodePath,
    member: MemberExpression,
  ): { prelude: Expression[]; refs: MemberRefs } | null {
    if (t.isSuper(member.object) || t.isPrivateName(member.property)) return null;
    const prelude: Expression[] = [];

    let object: () => Expression;
    if (t.isThisExpression(member.object)) {
      object = () => t.thisExpression();
    } else {
      object = this.temp(path, "o");
      prelude.push(t.assignmentExpression("=", object() as Identifier, member.object));
    }

    let key: () => Expression;
    if (!member.computed && t.isIdentifier(member.property)) {
      const name = member.property.name;
      key = () => str(name);
    } else if (t.isStringLiteral(member.property) || t.isNumericLiteral(member.property)) {
      const literal = member.property;
      key = () => freshClone(literal);
    } else {
      key = this.temp(path, "k");
      prelude.push(t.assignmentExpression("=", key() as Identifier, member.property as Expression));
    }

    const target = (): MemberExpression =>
      !member.computed && t.isIdentifier(member.property)
        ? t.memberExpression(object(), t.identifier(member.property.name))
        : t.memberExpression(object(), key(), true);

    return { prelude, refs: { object, key, target } };
  }

  private sequence(prelude: readonly Expression[], last: Expression): Expression {
    return prelude.length === 0 ? last : t.sequenceExpression([...prelude, last]);
  }

  /** Inserts a line event before every statement that executes as its own step. */
  private withLineEvents(statements: readonly Statement[]): Statement[] {
    const out: Statement[] = [];
    for (const statement of statements) {
      const target = this.lineAlias.get(statement) ?? statement;
      const inner = t.isLabeledStatement(target) ? target.body : target;
      if (target.loc && !NO_LINE_EVENT.has(inner.type)) {
        const loc = this.locs.register(target, "statement");
        if (loc !== null) out.push(traceStatement(TraceApi.line, [num(loc)]));
      }
      out.push(statement);
    }
    return out;
  }

  private hoistedDeclarations(path: NodePath, body: readonly Statement[]): Statement[] {
    const ids = body.flatMap((s) => (t.isFunctionDeclaration(s) && s.id ? [s.id] : []));
    if (ids.length === 0) return [];
    return [traceStatement(TraceApi.declare, [num(-1), ...pairArgs(this.pairsFor(path, ids))])];
  }

  /** Lexical bindings owned by this scope node (dropped when the block is left). */
  private lexicalBindings(path: NodePath): number[] {
    const { scope } = path;
    const ownsScope = scope.block === path.node || path.parentPath?.isCatchClause();
    if (!ownsScope) return [];
    return Object.values(scope.bindings as Record<string, Binding>)
      .filter((b) => LEXICAL_KINDS.has(b.kind) || b.path.isClassDeclaration())
      .map((b) => this.bindingOf(b));
  }

  private dropStatement(ids: readonly number[]): Statement {
    return traceStatement(TraceApi.drop, ids.map(num));
  }

  private wrapWithDrop(statements: Statement[], ids: readonly number[]): BabelTypes.TryStatement {
    return this.generated(
      t.tryStatement(
        this.generated(t.blockStatement(statements)),
        null,
        this.generated(t.blockStatement([this.dropStatement(ids)])),
      ),
    );
  }

  // ---------------------------------------------------------------- statements

  private onBlock(path: NodePath<BabelTypes.BlockStatement>): void {
    const { node, parentPath } = path;
    if (!this.claim(node, false)) return;
    node.body = this.withLineEvents(node.body);
    if (parentPath?.isFunction() || parentPath?.isStaticBlock()) return;
    const ids = this.lexicalBindings(path);
    if (ids.length > 0) node.body = [this.wrapWithDrop(node.body, ids)];
  }

  private onVariableDeclaration(path: NodePath<BabelTypes.VariableDeclaration>): void {
    const { node, parentPath } = path;
    if (!this.claim(node)) return;

    if (parentPath.isForStatement() && parentPath.node.init === node) {
      for (const declarator of node.declarations) {
        if (!t.isIdentifier(declarator.id) || !declarator.init) continue;
        const loc = this.locs.register(declarator, "statement");
        if (loc === null) continue;
        const binding = this.bindings.resolve(path, declarator.id.name);
        declarator.init = traceCall(TraceApi.declareOne, [num(loc), num(binding), declarator.init]);
      }
      return;
    }
    if (!path.inList) return;

    const ids = node.declarations.flatMap((d) => bindingIdentifiers(d.id));
    const loc = this.locs.register(node, "statement");
    if (ids.length === 0 || loc === null) return;
    path.insertAfter(
      traceStatement(TraceApi.declare, [num(loc), ...pairArgs(this.pairsFor(path, ids))]),
    );
  }

  private onClassDeclaration(path: NodePath<BabelTypes.ClassDeclaration>): void {
    const { node } = path;
    if (!this.claim(node) || !node.id || !path.inList) return;
    const loc = this.locs.register(node, "statement");
    if (loc === null) return;
    path.insertAfter(
      traceStatement(TraceApi.declare, [num(loc), ...pairArgs(this.pairsFor(path, [node.id]))]),
    );
  }

  private onIf(path: NodePath<BabelTypes.IfStatement>): void {
    const { node } = path;
    if (!this.claim(node)) return;
    const loc = this.locs.register(node, "condition");
    if (loc !== null) node.test = traceCall(TraceApi.branch, [num(loc), node.test]);
  }

  private onWhile(path: NodePath<BabelTypes.WhileStatement | BabelTypes.DoWhileStatement>): void {
    const { node } = path;
    if (!this.claim(node)) return;
    const loc = this.locs.register(node, "loop");
    if (loc !== null) node.test = traceCall(TraceApi.loopTest, [num(loc), node.test]);
  }

  private onFor(path: NodePath<BabelTypes.ForStatement>): void {
    const { node } = path;
    if (!this.claim(node)) return;
    const header = this.locs.register(node, "loop");
    if (header === null) return;
    if (node.test) {
      const test = node.test;
      const loc = this.locs.register(test, "condition", { range: rangeOf(test)!, reads: [test] });
      if (loc !== null) node.test = traceCall(TraceApi.branch, [num(loc), test]);
    }
    // The update runs at the start of every next iteration: report the header line there.
    const line = traceCall(TraceApi.line, [num(header)]);
    node.update = node.update ? t.sequenceExpression([line, node.update]) : line;
    this.wrapLoopScope(path);
  }

  private onForEach(path: NodePath<BabelTypes.ForInStatement | BabelTypes.ForOfStatement>): void {
    const { node } = path;
    if (!this.claim(node)) return;
    const header = this.locs.register(node, "loop");
    if (header === null || !t.isBlockStatement(node.body)) return;

    const prologue: Statement[] = [traceStatement(TraceApi.line, [num(header)])];
    const { left } = node;
    if (t.isVariableDeclaration(left)) {
      const ids = left.declarations.flatMap((d) => bindingIdentifiers(d.id));
      if (ids.length > 0) {
        prologue.push(
          traceStatement(TraceApi.declare, [num(header), ...pairArgs(this.pairsFor(path, ids))]),
        );
      }
    } else if (t.isIdentifier(left)) {
      prologue.push(
        traceStatement(TraceApi.assign, [
          num(header),
          undef(),
          ...pairArgs(this.pairsFor(path, [left])),
        ]),
      );
    } else {
      this.log.warn(
        "partial-loop-target",
        "Loop targets other than variables are executed but not traced.",
        left,
      );
    }
    node.body.body.unshift(...prologue);
    this.wrapLoopScope(path);
  }

  /** Drops `for (let ...)` header bindings when the loop is left, by any path. */
  private wrapLoopScope(path: NodePath<BabelTypes.Loop>): void {
    const ids = this.lexicalBindings(path);
    if (ids.length === 0) return;
    const target: NodePath<Statement> = path.parentPath.isLabeledStatement()
      ? (path.parentPath as NodePath<Statement>)
      : path;
    const wrapper = this.wrapWithDrop([target.node], ids);
    this.lineAlias.set(wrapper, target.node);
    target.replaceWith(wrapper);
    target.skip();
  }

  private onReturn(path: NodePath<BabelTypes.ReturnStatement>): void {
    const { node } = path;
    if (!this.claim(node)) return;
    const loc = this.locs.register(node, "return");
    if (loc === null) return;
    node.argument = traceCall(TraceApi.ret, [num(loc), node.argument ?? undef()]);
  }

  private onCatch(path: NodePath<BabelTypes.CatchClause>): void {
    const { node } = path;
    if (!this.claim(node)) return;
    const loc = this.locs.register(node, "statement", {
      range: rangeOf(node, node.param ?? node)!,
      reads: [],
    });
    if (loc === null) return;

    let binding = NO_BINDING;
    let param: Identifier;
    const prologue: Statement[] = [];
    if (t.isIdentifier(node.param)) {
      param = node.param;
      const resolved = path.scope.getBinding(param.name);
      if (resolved) binding = this.bindingOf(resolved);
    } else {
      param = path.scope.generateUidIdentifier("error");
      if (node.param) {
        prologue.push(
          t.variableDeclaration("let", [t.variableDeclarator(node.param, freshClone(param))]),
        );
      }
      node.param = param;
    }
    node.body.body.unshift(
      traceStatement(TraceApi.caught, [num(loc), num(binding), freshClone(param)]),
      ...prologue,
    );
  }

  // ---------------------------------------------------------------- expressions

  private onConditional(path: NodePath<BabelTypes.ConditionalExpression>): void {
    const { node } = path;
    if (!this.claim(node)) return;
    const test = node.test;
    const loc = this.locs.register(node, "condition", { range: rangeOf(test)!, reads: [test] });
    if (loc !== null) node.test = traceCall(TraceApi.branch, [num(loc), test]);
  }

  private onAssignment(path: NodePath<BabelTypes.AssignmentExpression>): void {
    const { node } = path;
    if (!this.claim(node)) return;
    const loc = this.locs.register(node, "expression");
    if (loc === null) return;
    const { left } = node;

    if (t.isIdentifier(left)) {
      this.replace(path, this.assignCall(path, loc, node, [left]));
    } else if (t.isMemberExpression(left)) {
      const captured = this.captureMember(path, left);
      if (!captured) return;
      const { prelude, refs } = captured;
      const write = t.assignmentExpression(node.operator, refs.target(), node.right);
      this.replace(
        path,
        this.sequence(
          prelude,
          traceCall(TraceApi.write, [num(loc), refs.object(), refs.key(), write]),
        ),
      );
    } else if (t.isPattern(left)) {
      this.replace(path, this.patternAssignment(path, loc, node, left));
    }
  }

  private onUpdate(path: NodePath<BabelTypes.UpdateExpression>): void {
    const { node } = path;
    if (!this.claim(node)) return;
    const loc = this.locs.register(node, "expression");
    if (loc === null) return;
    const { argument } = node;

    if (t.isIdentifier(argument)) {
      this.replace(path, this.assignCall(path, loc, node, [argument]));
    } else if (t.isMemberExpression(argument)) {
      const captured = this.captureMember(path, argument);
      if (!captured) return;
      const { prelude, refs } = captured;
      const update = t.updateExpression(node.operator, refs.target(), node.prefix);
      this.replace(
        path,
        this.sequence(
          prelude,
          traceCall(TraceApi.write, [num(loc), refs.object(), refs.key(), update]),
        ),
      );
    }
  }

  private onDelete(path: NodePath<BabelTypes.UnaryExpression>): void {
    const { node } = path;
    if (node.operator !== "delete" || !t.isMemberExpression(node.argument) || !this.claim(node)) {
      return;
    }
    const loc = this.locs.register(node, "expression");
    const captured = loc === null ? null : this.captureMember(path, node.argument);
    if (loc === null || !captured) return;
    const { prelude, refs } = captured;
    const deletion = t.unaryExpression("delete", refs.target());
    this.replace(
      path,
      this.sequence(
        prelude,
        traceCall(TraceApi.mutate, [num(loc), str("delete"), deletion, refs.object()]),
      ),
    );
  }

  private onCall(path: NodePath<BabelTypes.CallExpression>): void {
    const { node } = path;
    const { callee } = node;
    if (!t.isMemberExpression(callee) || callee.computed || !t.isIdentifier(callee.property))
      return;
    const method = callee.property.name;

    const isObjectAssign =
      method === "assign" &&
      t.isIdentifier(callee.object, { name: "Object" }) &&
      !path.scope.hasBinding("Object");
    if (!isObjectAssign && !MUTATOR_METHODS.has(method)) return;
    if (!this.claim(node)) return;
    const loc = this.locs.register(node, "call");
    if (loc === null) return;

    if (isObjectAssign) {
      // Object.assign returns its target, which is what gets re-captured.
      this.replace(path, traceCall(TraceApi.mutate, [num(loc), str(method), node]));
      return;
    }
    const captured = this.captureMember(path, callee);
    if (!captured) return;
    const { prelude, refs } = captured;
    const call = t.callExpression(refs.target(), node.arguments);
    this.replace(
      path,
      this.sequence(
        prelude,
        traceCall(TraceApi.mutate, [num(loc), str(method), call, refs.object()]),
      ),
    );
  }

  /** `a(loc, result, b1, v1, ...)`: evaluates `result` first, then reads the new values. */
  private assignCall(
    path: NodePath,
    loc: number,
    result: Expression,
    ids: Identifier[],
  ): Expression {
    return traceCall(TraceApi.assign, [num(loc), result, ...pairArgs(this.pairsFor(path, ids))]);
  }

  private patternAssignment(
    path: NodePath,
    loc: number,
    node: BabelTypes.AssignmentExpression,
    pattern: BabelTypes.Node,
  ): Expression {
    const ids: Identifier[] = [];
    const members: Expression[] = [];
    const visit = (target: Node | null): void => {
      if (!target) return;
      if (t.isIdentifier(target)) ids.push(target);
      else if (t.isMemberExpression(target)) {
        if (isPure(target) && !t.isPrivateName(target.property)) {
          members.push(
            freshClone(target.object as Expression),
            target.computed
              ? freshClone(target.property as Expression)
              : str((target.property as Identifier).name),
          );
        } else {
          this.log.warn(
            "partial-destructuring",
            "Destructuring into a computed target with side effects is executed but not traced.",
            target,
          );
        }
      } else if (t.isArrayPattern(target)) target.elements.forEach(visit);
      else if (t.isObjectPattern(target)) {
        for (const property of target.properties) {
          visit(t.isRestElement(property) ? property.argument : (property.value as Node));
        }
      } else if (t.isAssignmentPattern(target)) visit(target.left);
      else if (t.isRestElement(target)) visit(target.argument);
    };
    visit(pattern);

    let result: Expression = node;
    if (members.length > 0)
      result = traceCall(TraceApi.patternWrite, [num(loc), result, ...members]);
    if (ids.length > 0) result = this.assignCall(path, loc, result, ids);
    return result;
  }

  // ---------------------------------------------------------------- functions

  private onFunction(path: NodePath<BabelTypes.Function>): void {
    const { node } = path;
    if (!this.claim(node) || !t.isBlockStatement(node.body)) return;
    const body = node.body;
    const loc = this.locs.register(node, "call", {
      range: rangeOf(node, node.params[0] ?? node)!,
      reads: [],
    });
    if (loc === null) return;

    const params = node.params.flatMap((p) => bindingIdentifiers(p));
    const enter = traceStatement(TraceApi.enter, [
      num(loc),
      str(inferFunctionName(path)),
      ...pairArgs(this.pairsFor(path, params)),
    ]);
    const error = path.scope.generateUidIdentifier("error");
    const handler = t.catchClause(
      error,
      this.generated(
        t.blockStatement([
          traceStatement(TraceApi.unwind, [num(loc), freshClone(error)]),
          t.throwStatement(freshClone(error)),
        ]),
      ),
    );
    const tryBlock = this.generated(
      t.blockStatement([enter, ...this.hoistedDeclarations(path, body.body), ...body.body]),
    );
    const finalizer = this.generated(t.blockStatement([traceStatement(TraceApi.leave, [])]));
    node.body = this.generated(
      t.blockStatement([t.tryStatement(tryBlock, handler, finalizer)], body.directives),
    );
  }
}
