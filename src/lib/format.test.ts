import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "@/lib/format";

describe("SSR-safe time display", () => {
  it("formats evidence timestamps in explicit UTC", () => {
    const timestamp = "2026-10-25T23:30:00-07:00";
    expect(formatDate(timestamp)).toBe("Oct 26, 2026");
    expect(formatDateTime(timestamp).replace(/\s/gu, " ")).toBe(
      "Oct 26, 6:30 AM UTC",
    );
  });
});
