/**
 * Pyodide spike: the v1 tracer shape — pure Python appending event words to an
 * `array("i")` that JS reads as one buffer per flush — plus a hand-instrumented `fib`.
 * Throwaway: the real tracer and instrumenter replace this.
 */

export const TRACER = `
from array import array

class ReifyLimit(BaseException):
    pass

class WordTracer:
    def __init__(self, flush, max_steps, batch_words):
        self.w = array("i")
        self.strings = {}
        self.steps = 0
        self.max_steps = max_steps
        self.batch_words = batch_words
        self.flush_js = flush

    def _s(self, text):
        i = self.strings.get(text)
        if i is None:
            i = self.strings[text] = len(self.strings)
        return i

    def _check(self):
        if len(self.w) >= self.batch_words:
            self.flush()

    def flush(self):
        if self.w:
            self.flush_js(self.w)
            self.w = array("i")

    def ln(self, loc):
        self.steps += 1
        if self.steps > self.max_steps:
            raise ReifyLimit("steps")
        self.w.extend((0, loc))
        self._check()

    def br(self, loc, value):
        self.w.extend((7, loc, 1 if value else 0))
        self._check()
        return value

    def en(self, loc, name, binding, value):
        self.w.extend((1, loc, self._s(name), binding, self._s(repr(value))))
        self._check()

    def rt(self, loc, value):
        self.w.extend((2, loc, self._s(repr(value))))
        self._check()
        return value

    def lv(self):
        pass
`;

export const PLAIN_FIB = `
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)
`;

export const TRACED_FIB = `
def fib(n):
    __r.en(0, "fib", 0, n)
    try:
        __r.ln(1)
        if __r.br(2, n < 2):
            __r.ln(3)
            return __r.rt(4, n)
        __r.ln(5)
        return __r.rt(6, fib(n - 1) + fib(n - 2))
    finally:
        __r.lv()
`;

export interface SpikeResult {
  readonly type: "result";
  /** Worker script start → Pyodide ready. */
  readonly loadMs: number;
  readonly plainMs: number;
  readonly tracedMs: number;
  readonly words: number;
  readonly steps: number;
  /** Whether `ReifyLimit` escaped `except Exception` in user code. */
  readonly limitEscapes: boolean;
}

export interface SpikeReady {
  readonly type: "ready";
  readonly loadMs: number;
}

export type SpikeMessage = SpikeReady | SpikeResult | { readonly type: "error"; message: string };
