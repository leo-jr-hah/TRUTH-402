import type { Metadata, Viewport } from "next";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/jetbrains-mono";

import { AppShell } from "@/components/app-shell";
import { getPublicRuntimeConfig } from "@/lib/config";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  ),
  title: {
    default: "TRUTH-402: Profit rank is luck. Memory rank is skill.",
    template: "%s · TRUTH-402",
  },
  description:
    "Memory-calibrated decision and prediction signals, transparent skill rankings, and Sui HTTP-402 agent payments.",
  applicationName: "TRUTH-402",
  keywords: [
    "decision markets",
    "Walrus Memory",
    "collective intelligence",
    "credibility",
  ],
  openGraph: {
    title: "TRUTH-402",
    description:
      "Memory-calibrated prediction signals, auditable wallet skill, and a custom Sui HTTP-402 alpha exchange.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#eeeeee",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const config = getPublicRuntimeConfig();

  return (
    <html lang="en">
      <body className="antialiased">
        <AppShell
          memoryMode={config.memoryMode}
          allDemo={
            config.memoryMode === "demo" &&
            config.tatumMode === "demo" &&
            config.aiMode === "demo"
          }
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
