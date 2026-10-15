import type { Metadata, Viewport } from "next";
import { Caveat, Inter, JetBrains_Mono } from "next/font/google";
import { SITE } from "@/lib/site";
import { MotionProvider } from "@/components/MotionProvider";
import { THEME_SCRIPT } from "@/components/theme";
import "./globals.css";

/**
 * Variable fonts throughout: one file per family covers every weight. Inter also carries
 * the optical-size axis, so large headings and small UI text each get the right letterforms.
 */
const sans = Inter({ variable: "--font-inter", subsets: ["latin"], axes: ["opsz"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });
/** Handwritten annotations on the landing page only. */
const hand = Caveat({ variable: "--font-caveat", subsets: ["latin"], weight: "variable" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SITE.title, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  authors: [{ name: SITE.author.name, url: SITE.author.url }],
  creator: SITE.author.name,
  keywords: [...SITE.keywords],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    url: "/",
  },
  twitter: { card: "summary_large_image", title: SITE.title, description: SITE.description },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0d" },
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} ${hand.variable} h-full antialiased`}
    >
      <head>
        {/* Applies a pinned light/dark theme before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
