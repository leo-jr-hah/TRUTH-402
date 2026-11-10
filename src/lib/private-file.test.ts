import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writePrivateFileAtomic } from "@/lib/private-file";

describe("private atomic file writes", () => {
  it("creates and replaces files as 0600 without leftover temporaries", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "truth402-private-"));
    const file = path.join(directory, "state.json");
    try {
      await writePrivateFileAtomic(file, "first");
      expect((await stat(file)).mode & 0o777).toBe(0o600);

      await chmod(file, 0o644);
      await writePrivateFileAtomic(file, "second");
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await readdir(directory)).toEqual(["state.json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("removes its temporary file when the atomic rename fails", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "truth402-cleanup-"));
    const target = path.join(directory, "occupied");
    try {
      await mkdir(target);
      await writeFile(path.join(target, "child"), "keep");
      await expect(
        writePrivateFileAtomic(target, "cannot replace a directory"),
      ).rejects.toBeDefined();
      expect(await readdir(directory)).toEqual(["occupied"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
