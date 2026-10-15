# reify

**Make code tangible.** A browser-based execution visualizer for data structures and algorithms practice. Write your own
JavaScript or TypeScript, run it, and step forward and backward through what it actually did:
variables, arrays, objects, references, call stacks and recursion, all derived from the real run.

Live: [tryreify.vercel.app](https://tryreify.vercel.app) · Source: [github.com/JanaSundar/reify](https://github.com/JanaSundar/reify)

## Getting started

```bash
git clone https://github.com/JanaSundar/reify.git
cd reify
pnpm install
pnpm dev
```

Open http://localhost:3000/playground. Run with **Ctrl/Cmd + Enter**, run tests with **Ctrl/Cmd + Shift + Enter**,
cancel with **Esc**, toggle the console with **Ctrl/Cmd + `**, and step with **Alt + ← / →**.

The Tests tab runs your function against cases (arguments and expected value as JavaScript); the
Complexity tab shows an estimate from the code and a curve fitted to measured test runs.

## Scripts

| Script                                   | What it does                                                      |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js                                                           |
| `pnpm test`                              | Engine, trace store, coordinator and state machine tests (Vitest) |
| `pnpm bench`                             | Pipeline benchmarks (results in `docs/performance.md`)            |
| `pnpm lint` / `pnpm format`              | oxlint / oxfmt                                                    |
| `pnpm typecheck`                         | `tsc --noEmit`                                                    |
| `pnpm check`                             | All of the above except the benchmarks                            |
| `pnpm icons`                             | Regenerate favicons, app icons and the share-image logo           |

## Git hooks

[Lefthook](https://lefthook.dev) installs Git hooks on `pnpm install` (see `lefthook.yml`):

- **pre-commit**: formats staged files with oxfmt (re-staging them) and lints them with oxlint
- **pre-push**: runs `pnpm typecheck` and `pnpm test`

Skip them once with `git commit --no-verify` or `LEFTHOOK=0 git push`.

## Documentation

- [Architecture](docs/architecture.md): subsystems, instrumentation rules, replay
- [Execution safety](docs/security.md): guarantees and limitations
- [Performance baselines](docs/performance.md)
- [ADR 0001](docs/adr/0001-nextjs-workers-babel.md): Next.js, workers, Babel

## License

The source code is released under the [MIT License](LICENSE).

## Trademarks

The MIT license covers the code only. The "reify" name and logo (the files in
`public/brand/` and the icons generated from them) are not licensed for reuse. If you
publish a fork or host a modified version, please give it your own name and branding.
