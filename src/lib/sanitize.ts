const RESERVED_MEMORY_MARKER = /VERDICTO_DATA_V(?=\d+:)/giu;

/** Replace em dashes with a plain, portable separator for all displayed text. */
export function removeEmDashes(value: string): string {
  return value.replace(/[ \t]*\u2014[ \t]*/gu, " - ");
}

/** Normalize response copies only, never stored memory bytes or their hashes. */
export function publicJson(value: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(removeEmDashes(JSON.stringify(value)), {
    ...init,
    headers,
  });
}

export function stripUnsafeControls(value: string): string {
  return [...value]
    .map((character) => {
      const point = character.codePointAt(0) ?? 0;
      const unsafe =
        point <= 0x1f ||
        (point >= 0x7f && point <= 0x9f) ||
        (point >= 0x202a && point <= 0x202e) ||
        (point >= 0x2066 && point <= 0x2069);
      return unsafe ? " " : character;
    })
    .join("");
}

/**
 * Normalize short, human-authored text before storage or display.
 *
 * React still provides the required context-aware HTML escaping at render time.
 * This storage boundary additionally removes controls/bidi overrides, normalizes
 * em dashes, collapses line breaks, neutralizes HTML brackets, and prevents a
 * user string from imitating TRUTH402's line-delimited memory envelope marker.
 */
export function sanitizeUserText(value: string): string {
  return removeEmDashes(stripUnsafeControls(value.normalize("NFKC")))
    .replaceAll("<", "‹")
    .replaceAll(">", "›")
    .replace(RESERVED_MEMORY_MARKER, "TRUTH402 DATA V")
    .replace(/\s+/gu, " ")
    .trim();
}
