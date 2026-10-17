import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  headers: () => [
    {
      // Self-hosted Pyodide (scripts/copy-pyodide.mjs). The path carries the version, so a
      // file never changes in place and every fresh runtime worker can skip revalidation.
      source: "/pyodide/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    },
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
      // Python sources run inside Pyodide; `import source from "./x.py?raw"` gives their text.
      "*.py": { condition: { query: "?raw" }, type: "raw" },
    },
  },
};

export default nextConfig;
