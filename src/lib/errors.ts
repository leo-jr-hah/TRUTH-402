import { ZodError } from "zod";

import { removeEmDashes, publicJson } from "@/lib/sanitize";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
    public readonly headers?: HeadersInit,
  ) {
    super(message);
    this.name = "AppError";
  }
}

function errorEnvelope(code: string, message: string, details?: unknown) {
  return {
    error: {
      code,
      message: removeEmDashes(message),
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    return publicJson(
      errorEnvelope(
        "VALIDATION_ERROR",
        "The request contains invalid fields.",
        {
          issues: error.issues.map((issue) => ({
            code: issue.code,
            path: issue.path,
            message:
              issue.code === "unrecognized_keys"
                ? "Unrecognized fields."
                : issue.message,
          })),
        },
      ),
      { status: 422, headers: { "cache-control": "no-store" } },
    );
  }

  if (error instanceof AppError) {
    const headers = new Headers(error.headers);
    headers.set("cache-control", "no-store");
    return publicJson(errorEnvelope(error.code, error.message, error.details), {
      status: error.status,
      headers,
    });
  }

  // Do not log provider/request payloads or secrets carried by unknown errors.
  console.error(
    "Unhandled TRUTH-402 error. Details withheld at the public boundary.",
  );
  return publicJson(
    errorEnvelope("INTERNAL_ERROR", "An unexpected error occurred."),
    { status: 500, headers: { "cache-control": "no-store" } },
  );
}

export async function readJson(
  request: Request,
  maxBytes = 64 * 1_024,
): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) {
    throw new AppError(
      "INVALID_JSON",
      "The request body must be valid JSON.",
      400,
    );
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AppError(
          "PAYLOAD_TOO_LARGE",
          `The request body exceeds the ${maxBytes}-byte limit.`,
          413,
        );
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "INVALID_JSON",
      "The request body must be valid JSON.",
      400,
    );
  }
}

/** Named alias for routes that want to make the streaming byte limit explicit. */
export const readJsonBodyWithLimit = readJson;
