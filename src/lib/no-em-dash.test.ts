import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { removeEmDashes } from "@/lib/sanitize";

const EM_DASH = String.fromCodePoint(0x2014);
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".css",
  ".mjs",
  ".md",
  ".svg",
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

describe("site copy", () => {
  it("normalizes compact and spaced em dashes", () => {
    const dash = String.fromCodePoint(0x2014);

    expect(removeEmDashes(`evidence${dash}only`)).toBe("evidence - only");
    expect(removeEmDashes(`evidence ${dash} only`)).toBe("evidence - only");
  });

  it("does not contain em dashes in application source", () => {
    const root = process.cwd();
    const files = [
      ...sourceFiles(join(root, "src")),
      ...sourceFiles(join(root, "scripts")),
      ...sourceFiles(join(root, "docs")),
      ...["README.md", "SECURITY.md", ".env.example"].map((name) =>
        join(root, name),
      ),
    ];
    const offenders = files.filter((file) =>
      readFileSync(file, "utf8").includes(EM_DASH),
    );

    expect(offenders).toEqual([]);
  });
});
