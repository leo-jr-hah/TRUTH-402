import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TRUTH-402: The memory-calibrated oracle",
    short_name: "TRUTH-402",
    description:
      "Memory-powered decision markets with evidence-backed credibility.",
    start_url: "/",
    display: "standalone",
    background_color: "#eeeeee",
    theme_color: "#071b2b",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
