import { TRACER_PARAM, type TraceApiName } from "../traceApi";
import { t, type BabelTypes } from "./babel";

type Expression = BabelTypes.Expression;

/**
 * Pure AST builders for injected code. Every generated node is created without source
 * locations, which is how the instrumentation tells generated code from user code.
 */

export const num = (value: number): Expression =>
  value < 0 ? t.unaryExpression("-", t.numericLiteral(-value)) : t.numericLiteral(value);

export const str = (value: string): Expression => t.stringLiteral(value);

/** `void 0` cannot be shadowed, unlike the identifier `undefined`. */
export const undef = (): Expression => t.unaryExpression("void", t.numericLiteral(0));

export const traceCall = (api: TraceApiName, args: readonly Expression[]): Expression =>
  t.callExpression(t.memberExpression(t.identifier(TRACER_PARAM), t.identifier(api)), [...args]);

export const traceStatement = (
  api: TraceApiName,
  args: readonly Expression[],
): BabelTypes.ExpressionStatement => t.expressionStatement(traceCall(api, args));

/** Deep copy without locations so the copy is never instrumented again. */
export const freshClone = <T extends BabelTypes.Node>(node: T): T => t.cloneNode(node, true, true);

/** Flattens `[binding, valueExpression]` pairs into a call argument list. */
export const pairArgs = (pairs: ReadonlyArray<readonly [number, Expression]>): Expression[] =>
  pairs.flatMap(([binding, value]) => [num(binding), value]);
