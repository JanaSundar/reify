/** Site-wide constants used for metadata, sitemap and structured data. */
export const SITE = {
  name: "LearnCode",
  title: "LearnCode — See how your code actually runs",
  description:
    "Write your own JavaScript or TypeScript solution, run it, and step forward and backward through its real execution: variables, arrays, objects, call stacks and recursion, visualized from the actual run.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  keywords: [
    "code execution visualizer",
    "JavaScript visualizer",
    "TypeScript visualizer",
    "data structures and algorithms",
    "DSA practice",
    "recursion visualizer",
    "step through code",
    "learn algorithms",
  ],
} as const;

export const absoluteUrl = (path: string): string => new URL(path, SITE.url).toString();
