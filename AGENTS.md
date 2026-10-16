<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Code principles

These apply to every change. Read the surrounding module before writing, and match its style.

### DRY — one source of truth

- Before adding a helper, type, constant or component, search for an existing one (`src/lib`, `src/components`, `src/engine/core/protocol`, the feature's own folder). Reuse or extend it instead of writing a near-copy.
- Knowledge lives in one place. Lists of allowed values, labels, storage keys and limits are declared once and derived elsewhere (e.g. build a `Set` or option list from a single `as const` array rather than restating the values).
- When the same logic shows up a second time, extract it into a shared function in the lowest module both callers already depend on. Don't extract on speculation — two real call sites first.
- DRY is about duplicated *knowledge*, not similar-looking code. Two things that happen to look alike but change for different reasons stay separate.

### Pure functions by default

- Logic is written as pure functions: output depends only on input, no mutation of arguments, no I/O, no hidden module state. Return new values (`readonly` types, spread/map/filter) instead of mutating.
- Push side effects to the edges — React components and hooks, workers, `localStorage`, `window` events, the XState machine's actions, and the engine's stateful classes. Keep the decision-making in pure functions those edges call.
- Classes are for stateful boundaries only (stores, coordinators, tracers, runtimes such as `TraceStore`, `ExecutionCoordinator`, `JsTracer`). Everything else is a function.
- Pure modules (`engine/core/trace`, `features/*/…Model.ts`, `features/viz/*.ts`, parsers like `suiteFile.ts`) must not import React or touch the DOM; the engine stays React-free.
- Pure functions are the test surface: new logic gets unit tests in `tests/` against its inputs and outputs, without mocks.

### Modules

- Prefer deep modules: a small interface hiding real behaviour. Accept dependencies as parameters instead of creating them inside. Add a seam (interface/adapter) only when a second implementation exists. See `.agents/skills/codebase-design`.
