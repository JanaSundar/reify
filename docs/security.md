# Execution safety

User code is treated as untrusted. This is what is and is not guaranteed today.

## Guarantees

- **Never on the main thread.** Code runs in a dedicated Web Worker created for one run and
  terminated afterwards, so every run starts with fresh globals.
- **Preemptive termination.** Cancel and the wall-clock timeout (`timeoutMs`, 10 s) call
  `worker.terminate()`, which stops even `while (true) {}` without cooperation from the code.
- **Budgets.** Steps, trace events and call depth are counted by the recorder. Once a budget is
  exhausted the recorder is _poisoned_: every later checkpoint (including the injected prologue
  of every `catch` block) throws again, so user code cannot swallow the limit.
- **Bounded trace memory.** Event count, collection sizes, string lengths and snapshot counts
  are capped; truncated traces are marked as such in the UI.
- **Stale and malformed messages are dropped.** Every message carries a run id and is validated
  structurally; the coordinator only accepts messages for the active run.
- **No app secrets in the worker.** The worker cannot reach the DOM, cookies, application state
  or environment variables.

## Best effort (defense in depth)

Before user code runs, the runtime worker removes `fetch`, `XMLHttpRequest`, `WebSocket`,
`importScripts`, `indexedDB`, `caches`, `navigator`, `postMessage`, timers, storage and similar
capabilities from the global object and its prototype chain (verified in the browser: they are
`undefined` to user code). `eval`, the `Function` constructor, `import()` and `with` are
rejected at compile time.

## Multi-file projects

A project runs as native ES modules served from the Cache API by a service worker
(`docs/multi-file-projects.md`).

- The service worker answers only requests under `/__reify/` from the cache and never touches the
  network. Imports are resolved at compile time to project files; bare, absolute and escaping
  specifiers are rejected, and dynamic `import()` is a compile error.
- While the entry module loads, the tracer is reachable as `globalThis.__reify_tracer` (each
  module copies it on start and the runtime removes it afterwards). Single-file programs already
  hand the tracer to user code as a wrapper argument, so this exposes nothing new: the tracer can
  forge events in the user's own trace, nothing more.

## Not guaranteed

- A Web Worker is not a security sandbox. A determined program can reach intrinsics that were
  not removed (for example through `(function(){}).constructor`) and could, in principle, issue
  a dynamic `import()` to another origin.
- Memory is not hard-limited inside the worker. A program allocating huge arrays can exhaust the
  worker's memory; the worker then crashes and the run is reported as failed.

## Next hardening steps

1. Serve the runtime worker script with its own `Content-Security-Policy`
   (`default-src 'none'; script-src 'self' 'unsafe-eval'`) to block network access even if a
   capability is reached.
2. Run the worker inside a sandboxed cross-origin iframe once shareable links (running other
   people's code) exist.
