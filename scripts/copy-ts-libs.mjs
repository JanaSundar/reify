// Bundles the TypeScript standard-library declarations the editor type-checks against
// into public/ts-libs/<version>/libs.json. The version comes from the installed package,
// so the URL changes with the dependency and caches never go stale.
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { collectLibs } from "./ts-libs.mjs";

const SOURCE = "node_modules/typescript";

const { version } = JSON.parse(readFileSync(`${SOURCE}/package.json`, "utf8"));
const libs = collectLibs(SOURCE);

const target = `public/ts-libs/${version}`;
await mkdir(target, { recursive: true });
await writeFile(`${target}/libs.json`, JSON.stringify({ version, libs }));
console.log(`TypeScript ${version} libs (${Object.keys(libs).length} files) → ${target}`);
