import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AppError, errorResponse, readJson } from "@/lib/errors";

describe("API error and JSON handling", () => {
  it("uses one error envelope for validation and application errors", async () => {
    let validationError: unknown;
    try {
      z.object({ value: z.string() }).parse({ value: 1 });
    } catch (error) {
      validationError = error;
    }

    const validationResponse = errorResponse(validationError);
    const validationBody = await validationResponse.json();
    expect(validationBody).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: expect.any(String),
        details: { issues: expect.any(Array) },
      },
    });
    expect(validationBody.error.issues).toBeUndefined();

    const appResponse = errorResponse(
      new AppError("RATE_LIMITED", "Slow down.", 429, { retryAfterSeconds: 3 }),
    );
    expect(await appResponse.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Slow down.",
        details: { retryAfterSeconds: 3 },
      },
    });
  });

  it("normalizes em dashes in public error messages", async () => {
    const dash = String.fromCodePoint(0x2014);
    const response = errorResponse(
      new AppError("PROVIDER_ERROR", `Provider${dash}request failed.`, 502),
    );

    expect((await response.json()).error.message).toBe(
      "Provider - request failed.",
    );
  });

  it("enforces the byte limit even without Content-Length", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"value":"too large"}'));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readJson(request, 8)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
    });
  });
});
