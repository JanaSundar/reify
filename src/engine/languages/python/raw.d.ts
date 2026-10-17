/** Python sources bundled as text (Turbopack rule in next.config.ts; Vite handles `?raw`). */
declare module "*.py?raw" {
  const source: string;
  export default source;
}
