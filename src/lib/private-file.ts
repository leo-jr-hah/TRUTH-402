import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Write a private file through an adjacent, exclusive temporary file and an
 * atomic rename. A failed write or rename always attempts to remove the temp.
 */
export async function writePrivateFileAtomic(
  file: string,
  contents: string,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporary, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    // rename preserves the temporary file's 0600 mode, including when replacing
    // an older target that had broader permissions.
    await rename(temporary, file);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new AggregateError(
          [error, cleanupError],
          "Private file write failed and its temporary file could not be removed.",
        );
      }
    }
    throw error;
  }
}
