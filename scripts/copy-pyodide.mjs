// Copies the Pyodide runtime from node_modules into public/pyodide/<version>/ so it is
// self-hosted (no CDN). The version comes from the installed package, so the URL changes
// whenever the dependency does and old caches never serve a mismatched runtime.
import { copyFile, mkdir, readFile } from "node:fs/promises";

const SOURCE = "node_modules/pyodide";
const FILES = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

const { version } = JSON.parse(await readFile(`${SOURCE}/package.json`, "utf8"));
const target = `public/pyodide/${version}`;
await mkdir(target, { recursive: true });
await Promise.all(FILES.map((file) => copyFile(`${SOURCE}/${file}`, `${target}/${file}`)));
console.log(`Pyodide ${version} → ${target}`);
