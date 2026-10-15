/** Site-wide constants used for metadata, sitemap and structured data. */
export const SITE = {
  name: "reify",
  tagline: "Make code tangible.",
  title: "reify — See what happens inside your code",
  description:
    "Write code. Watch variables change, functions execute, and data transform — one step at a time. A JavaScript and TypeScript execution visualizer that runs in your browser.",
  /** Canonical production origin (override with NEXT_PUBLIC_SITE_URL, e.g. for a custom domain). */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://tryreify.vercel.app",
  author: { name: "janasundar", url: "https://janasundar.com" },
  /** Public source repository. */
  github: "https://github.com/JanaSundar/reify",
  keywords: [
    "code execution visualizer",
    "JavaScript visualizer",
    "TypeScript visualizer",
    "data structures and algorithms",
    "step through code",
    "learn programming",
    "call stack visualizer",
    "memory visualizer",
  ],
} as const;

export const absoluteUrl = (path: string): string => new URL(path, SITE.url).toString();
