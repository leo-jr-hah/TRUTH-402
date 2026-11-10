import type { Metadata } from "next";

import { HowSteps } from "@/components/how-steps";

export const metadata: Metadata = { title: "How it works" };

export default function AboutPage() {
  return (
    <div>
      <span id="methodology" aria-hidden="true" />
      <span id="rank-method" aria-hidden="true" />
      <span id="forecast-integrity" aria-hidden="true" />
      <header className="max-w-3xl pt-4 sm:pt-8">
        <h1 className="display text-5xl sm:text-6xl">How it works</h1>
        <p className="mt-4 text-lg opacity-80">
          Every market gets two numbers. Here is where they come from.
        </p>
      </header>
      <HowSteps />
    </div>
  );
}
