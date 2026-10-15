# ADR 0001: Next.js, worker-per-run execution and Babel instrumentation

**Status:** accepted (2026-10-15)

## Context

The product brief suggested Vite. The site also needs indexable marketing and docs pages, and the
execution engine must stay independent of any UI framework.

## Decision

- **Next.js App Router** for routing, static generation and metadata (SEO). The playground is a
  client-only island loaded with `next/dynamic` (`ssr: false`), so its heavy code never affects
  indexed pages. TanStack Start was considered; Next.js won on SEO tooling and ecosystem size.
- **Two workers.** A long-lived compiler worker (Babel loads once) and a fresh runtime worker per
  run (fresh globals, preemptive `terminate()` for cancel and timeout). A spare runtime worker is
  pre-warmed while the current run executes.
- **`@babel/standalone`** for parsing, TypeScript stripping and instrumentation, inside the
  compiler worker only: one dependency, no Node polyfills.
- **A typed `postMessage` protocol instead of an RPC library** such as Comlink: runs stream
  batched events and are killed rather than awaited, and every message must be checked against
  the active run id.
- **XState only for the lifecycle; no Zustand yet.** History lives in the `TraceStore`.
- **No Rust/WASM yet.** It is introduced only for a hot path that measurements identify
  (`performance.md`: event transfer is the current candidate).

## Consequences

- Babel (about 3 MB) loads once per session in the compiler worker, never on the main thread.
- Executing JavaScript natively keeps full JS semantics for the supported subset; the cost is
  that isolation is best effort (see `security.md`).
