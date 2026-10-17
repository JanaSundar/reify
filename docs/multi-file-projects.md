# Multi-file projects

A project is a set of files plus an entry point. Single-file programs are the degenerate
case: a project of one file, run exactly as before.

## Pipeline

```
 files + entry ──buildGraph──▶ ProjectGraph ──compile each module──▶ modules + ProgramInfo
 (core/project)   scan+resolve   (diagnostics)   (language adapter)       │
                                                                          ▼
                                   compiler worker writes modules to the Cache API
                                   service worker serves them at /__reify/<run>/<path>
                                   runtime worker: await import(entryUrl)  (native ES modules)
```

- **Graph** (`src/engine/core/project`): pure. Path normalization, the `ProjectLanguage`
  interface (scan imports, resolve a specifier, compile a module), discovery from the entry,
  ES evaluation order, cycles, and dependents. Nothing here knows JavaScript.
- **Language adapter** (`src/engine/languages/<lang>/project`): each language implements its
  own scan, resolve and compile. JavaScript and TypeScript share one (ES modules).
- **Modules run natively.** Each compiled module is a real ES module, so live bindings,
  circular imports, evaluation order and strict mode are the engine's own, not emulated.
  Modules need stable URLs to import each other (a cycle cannot be expressed with blob URLs),
  which a service worker provides from the Cache API. Imports are rewritten to those URLs at
  compile time; nothing outside `/__reify/` is ever served.

## Ids across modules

Trace events refer to locations and bindings by index into `ProgramInfo.locs` and
`ProgramInfo.bindings`, and the instrumented code embeds those indices as literals
(`ln(12)`). A project therefore needs ids that are unique across modules **at compile time**.

Each module is compiled with a _slot_: `{ fileId, locBase, bindingBase }`.

- `LocTable` and `BindingTable` start numbering at their base, so the module's code already
  contains project-wide ids, and every `LocInfo` carries its `file`.
- Slots are assigned in discovery order: a module's bases are the sums of the sizes of the
  modules before it. The linked `ProgramInfo` is the concatenation of the module tables in
  that order, so the tables stay dense arrays and every consumer keeps indexing them
  directly (`program.locs[id]`). Single-file programs are slot `{0, 0, 0}`: unchanged.
- Rejected alternative: module-local ids plus a per-module tracer facade that adds the base
  at run time. It adds a call layer to every traced event and would need to know which
  arguments of each tracer method are binding ids.
- Cost: an edit that changes the number of locations or bindings in a module shifts the
  slots of the modules after it, and those are recompiled. The compile cache is keyed by
  `(path, source, slot, import urls)`, so unaffected modules and unchanged runs are free.

## Tracer hand-off

Module code cannot take the tracer as a parameter the way the single-file wrapper does. The
runtime worker places it on `globalThis.__reify_tracer` before importing the entry; each
module's first statement copies it into a module-local `__lc$t` (and `console`), and the
runtime removes the global once the import has finished, since every module has evaluated by
then (dynamic `import()` is rejected at compile time).
