import { posthog } from "posthog-js";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (projectToken && host) {
  posthog.init(projectToken, {
    api_host: host,
    defaults: "2026-01-30",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
  });
} else if (process.env.NODE_ENV === "development") {
  // Analytics is optional: without the two variables (see .env.example) nothing is sent.
  console.warn("PostHog is not configured: set NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN and _HOST.");
}
