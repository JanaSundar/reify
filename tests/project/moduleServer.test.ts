import { describe, expect, it } from "vitest";
import { ModuleStore, type ModuleCache } from "@/engine/core/project/ModuleStore";
import {
  MODULE_CACHE,
  MODULE_ROOT,
  moduleUrl,
  serviceWorkerSource,
  stripModuleRoot,
} from "@/engine/core/project/moduleServer";

/** In-memory stand-in for a `Cache`, keyed by path like the real one is by url. */
class FakeCache implements ModuleCache {
  readonly entries = new Map<string, Response>();
  put = async (url: string, response: Response) => void this.entries.set(url, response);
  delete = async (url: string) => this.entries.delete(url);
  keys = async () => [...this.entries.keys()].map((url) => ({ url: `https://reify.test${url}` }));
}

describe("module urls", () => {
  it("serve project paths under the module root, per namespace", () => {
    expect(moduleUrl("abc", "utils/math.js")).toBe("/__reify/abc/utils/math.js");
    expect(moduleUrl("abc", "my dir/a b.js")).toBe("/__reify/abc/my%20dir/a%20b.js");
    expect(moduleUrl("abc", "x.js").startsWith(MODULE_ROOT)).toBe(true);
  });

  it("show engine messages with project paths instead of urls", () => {
    expect(
      stripModuleRoot(
        "The requested module '/__reify/ab-12/a.js' does not provide an export named 'x'",
      ),
    ).toBe("The requested module 'a.js' does not provide an export named 'x'");
  });
});

describe("serviceWorkerSource", () => {
  it("serves only the module root, from the module cache", () => {
    const source = serviceWorkerSource();
    expect(source).toContain(JSON.stringify(MODULE_ROOT));
    expect(source).toContain(JSON.stringify(MODULE_CACHE));
    expect(() => new Function(source)).not.toThrow();
    // Never reaches the network for anything.
    expect(source).not.toMatch(/\bfetch\(/);
  });
});

const published = (ns: string, path: string, code = path) => ({
  url: moduleUrl(ns, path),
  code,
});

describe("ModuleStore", () => {
  it("stores each module's code as javascript at its url", async () => {
    const cache = new FakeCache();
    await new ModuleStore(cache).publish("a", [published("a", "main.js", "export {}")]);
    const response = cache.entries.get("/__reify/a/main.js")!;
    expect(await response.text()).toBe("export {}");
    expect(response.headers.get("content-type")).toBe("text/javascript");
  });

  it("drops modules the namespace no longer has, and leaves other namespaces alone", async () => {
    const cache = new FakeCache();
    const store = new ModuleStore(cache);
    await store.publish("a", [published("a", "main.js"), published("a", "old.js")]);
    await store.publish("b", [published("b", "main.js")]);
    await store.publish("a", [published("a", "main.js", "v2")]);
    expect([...cache.entries.keys()].toSorted()).toEqual([
      "/__reify/a/main.js",
      "/__reify/b/main.js",
    ]);
    expect(await cache.entries.get("/__reify/a/main.js")!.text()).toBe("v2");
  });
});
