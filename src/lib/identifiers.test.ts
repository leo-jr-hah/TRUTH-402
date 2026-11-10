import { describe, expect, it } from "vitest";

import { percentage, round, slugifyParticipant } from "@/lib/identifiers";

describe("identifier and numeric helpers", () => {
  it("creates stable, safe participant slugs", () => {
    expect(slugifyParticipant("  Amína Yusuf! ")).toBe("amina-yusuf");
    expect(slugifyParticipant("***")).toBe("participant");
  });

  it("rounds values consistently", () => {
    expect(round(1.23456, 3)).toBe(1.235);
    expect(percentage(2 / 3)).toBe(66.7);
  });
});
