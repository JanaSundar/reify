// The TypeScript standard-library declarations the editor type-checks against (ES2022, no
// DOM): `lib.es2022.d.ts` and every file it reaches through `<reference lib>` links.
import { readFileSync } from "node:fs";

export const ROOT_LIB = "lib.es2022.d.ts";

/** name -> source for the library closure, read from an installed `typescript` package. */
export const collectLibs = (typescriptDir = "node_modules/typescript") => {
  const libs = {};
  const queue = [ROOT_LIB];
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    if (name in libs) continue;
    const text = readFileSync(`${typescriptDir}/lib/${name}`, "utf8");
    libs[name] = text;
    for (const [, ref] of text.matchAll(/<reference lib="([^"]+)"/g)) queue.push(`lib.${ref}.d.ts`);
  }
  return libs;
};
