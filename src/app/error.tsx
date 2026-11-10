"use client";

import { Home, RefreshCw, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect } from "react";

import { CopyHash } from "@/components/copy-hash";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error", error);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-4 py-12 text-center">
      <div className="max-w-md">
        <motion.span
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="border-line-strong bg-panel mx-auto grid size-16 place-items-center rounded-full border"
        >
          <TriangleAlert size={28} aria-hidden="true" />
        </motion.span>
        <h1 className="display mt-8 text-4xl sm:text-5xl">
          Something went wrong
        </h1>
        <p className="mx-auto mt-4 max-w-sm opacity-80">
          This page could not load. Try again, or head back home.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            className="button-primary group"
            onClick={reset}
          >
            <RefreshCw
              size={17}
              aria-hidden="true"
              className="transition-transform duration-500 group-hover:rotate-180"
            />
            Try again
          </button>
          <Link href="/" className="button-secondary">
            <Home size={17} aria-hidden="true" />
            Go home
          </Link>
        </div>
        {error.digest && (
          <p className="mt-8 inline-flex flex-wrap items-center justify-center gap-2 text-xs opacity-70">
            Reference{" "}
            <CopyHash
              value={error.digest}
              label="error reference"
              head={10}
              tail={4}
            />
          </p>
        )}
      </div>
    </div>
  );
}
