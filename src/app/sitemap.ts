import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl("/"), changeFrequency: "monthly", priority: 1 },
    { url: absoluteUrl("/playground"), changeFrequency: "monthly", priority: 0.9 },
    { url: absoluteUrl("/docs/javascript"), changeFrequency: "monthly", priority: 0.6 },
  ];
}
