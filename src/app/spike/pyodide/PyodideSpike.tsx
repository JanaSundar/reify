"use client";

import { useState } from "react";
import type { SpikeMessage, SpikeResult } from "./spikeProgram";

interface Row extends SpikeResult {
  readonly run: number;
  /** `new Worker()` → Pyodide ready, as the page sees it. */
  readonly startupMs: number;
  /** Request posted → result received, on an already-ready worker (the prewarmed path). */
  readonly warmRequestMs: number;
}

const spawn = () =>
  new Worker(new URL("./spike.worker.ts", import.meta.url), {
    type: "module",
    name: "reify-pyodide-spike",
  });

const next = (worker: Worker): Promise<SpikeMessage> =>
  new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<SpikeMessage>) => resolve(event.data);
    worker.onerror = (event) => reject(new Error(event.message));
  });

/** One worker-per-run cycle: start, wait for ready, run, terminate. */
const cycle = async (run: number, n: number, maxSteps: number): Promise<Row> => {
  const created = performance.now();
  const worker = spawn();
  try {
    const ready = await next(worker);
    if (ready.type === "error") throw new Error(ready.message);
    const startupMs = performance.now() - created;
    const requested = performance.now();
    const pending = next(worker);
    worker.postMessage({ n, maxSteps });
    const result = await pending;
    if (result.type !== "result") throw new Error(result.type === "error" ? result.message : "?");
    return { ...result, run, startupMs, warmRequestMs: performance.now() - requested };
  } finally {
    worker.terminate();
  }
};

const fmt = (ms: number) => `${Math.round(ms)} ms`;

export function PyodideSpike() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("idle");

  const start = async (runs: number) => {
    setRows([]);
    try {
      for (let run = 1; run <= runs; run++) {
        setStatus(`run ${run}/${runs}`);
        // Sequential on purpose: each cycle measures one fresh worker on its own.
        // oxlint-disable-next-line no-await-in-loop
        const row = await cycle(run, 25, 10 ** 9);
        setRows((previous) => [...previous, row]);
      }
      setStatus("done");
    } catch (error) {
      setStatus(`error: ${(error as Error).message}`);
    }
  };

  return (
    <main className="mx-auto max-w-4xl p-6 font-mono text-sm">
      <h1 className="mb-2 text-lg">Pyodide spike</h1>
      <p className="mb-4">
        Each run starts a fresh worker, as the runtime does. fib(25), traced with the word-buffer
        tracer.
      </p>
      <div className="mb-4 flex gap-2">
        <button className="rounded border px-3 py-1" onClick={() => start(5)} id="run-spike">
          Run 5 cycles
        </button>
        <span id="spike-status">{status}</span>
      </div>
      <table className="w-full text-left" id="spike-results">
        <thead>
          <tr>
            <th>run</th>
            <th>startup</th>
            <th>worker load</th>
            <th>plain</th>
            <th>traced</th>
            <th>request→result</th>
            <th>words</th>
            <th>steps</th>
            <th>limit escapes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.run}>
              <td>{row.run}</td>
              <td>{fmt(row.startupMs)}</td>
              <td>{fmt(row.loadMs)}</td>
              <td>{fmt(row.plainMs)}</td>
              <td>{fmt(row.tracedMs)}</td>
              <td>{fmt(row.warmRequestMs)}</td>
              <td>{row.words.toLocaleString("en-US")}</td>
              <td>{row.steps.toLocaleString("en-US")}</td>
              <td>{String(row.limitEscapes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
