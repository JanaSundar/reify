# Performance baselines

Measured with `pnpm bench` (tinybench through Vitest, Node 26, Windows 11, single run on
2026-10-15). Workload: bubble sort of N reversed numbers (dense loops, branches, array writes
and swaps).

| Stage (mean ms)                         | n=30 (3.8k events) | n=100 (40.6k) | n=200 (161k) |
| --------------------------------------- | -----------------: | ------------: | -----------: |
| Compile (parse + instrument)            |               0.71 |          0.65 |         0.62 |
| Execute without tracing                 |              0.002 |         0.006 |        0.018 |
| Execute with tracing                    |               0.19 |           2.0 |          8.3 |
| Structured clone of all events          |                1.2 |          15.1 |         66.3 |
| Encode all events (binary)              |               0.19 |           2.1 |          8.1 |
| Decode all events (binary)              |               0.21 |           2.3 |          8.9 |
| postMessage: structured clone           |                1.3 |          13.5 |         53.6 |
| postMessage: encode + transfer + decode |               0.44 |           4.0 |         16.1 |
| Trace store ingestion + snapshots       |               0.29 |           3.1 |         12.3 |
| Seek to a random step + build view      |               0.01 |          0.01 |         0.01 |

Trace store heap for n=200: about 7.6 MB. Encoded size for n=200: about 2.4 MB of words plus
5.5k table strings (about 15 bytes per event).

The two `postMessage` rows send every 4,096-event batch through a real `MessageChannel` and
wait until all batches are received and turned back into events, so they include both sides
of the hop (on one thread in the benchmark; in the app the encode half runs in the worker).

## Event transfer: before and after

Events used to be posted as objects, so they were structured-cloned: serialized in the worker
and deserialized on the main thread. They are now encoded by `core/protocol/eventCodec.ts` into
an `Int32Array` word stream plus a per-batch table of distinct strings, and the buffer is put in
the transfer list, so it moves without copying.

| n=200 (161k events)                | Before (structured clone) | After (binary + transfer) |
| ---------------------------------- | ------------------------: | ------------------------: |
| Full hop, both threads             |                   53.6 ms |           16.1 ms (−70 %) |
| Worker side (serialize / encode)   |       part of the 53.6 ms |                    8.1 ms |
| Main thread (deserialize / decode) |       part of the 53.6 ms |                    8.9 ms |

Design decisions, each checked against these benchmarks:

- **Decode eagerly.** The trace store folds every event into its live state as it arrives, so
  a lazy decoder would decode every event right away anyway; the reducer keeps the
  `TraceEvent` object model.
- **Strings stay JS strings** in a per-batch deduplicated table (few distinct strings per
  batch, e.g. 34 for n=30) instead of UTF-8/UTF-16 bytes, because text codecs replace lone
  surrogates and user strings may contain them. Structured clone of the small table is exact.
- **Equal primitive values share one decoded object per batch.** Measured alternatives: no
  sharing decodes at the same speed but allocates an object per value; a `Map` cache was slower
  (10.3 ms decode for n=200).
- **No Rust/WASM encoder (no ADR 0002).** The JS encoder costs about as much as traced
  execution (8.1 vs 8.3 ms) and is no longer the bottleneck: trace store ingestion (12.3 ms) is
  the largest main-thread stage. Most of the encoder's time is spent walking JS event objects,
  which a WASM encoder would still have to do across the JS/WASM boundary, so it would add a
  toolchain without removing the dominant cost. Revisit only if a profile in the browser shows
  otherwise.

## Reading the numbers

- **Ingestion is now the largest main-thread cost**, followed by decoding. Both run in
  4,096-event slices, so the main thread is never blocked for long.
- **Seeking is cheap** thanks to snapshots every 128 steps, so playback never blocks input.
- **Tracing overhead** is roughly 500× plain execution on tight loops: acceptable for
  learning-sized inputs and bounded by the step budget.

Not yet measured: React render time per step, cancellation latency in the browser, and memory in
the browser (rather than Node). Do not quote numbers that are not in this file; re-run
`pnpm bench` after changes.
