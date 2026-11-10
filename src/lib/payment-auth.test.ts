import { describe, expect, it } from "vitest";
import {
  parsePaymentAuthorization,
  paymentAuthorization,
} from "@/lib/payment-auth";

describe("HTTP Payment auth parameter grammar", () => {
  it("supports case-insensitive schemes, tokens, whitespace and quoted-pairs", () => {
    expect(
      parsePaymentAuthorization(
        'pAyMeNt Method = sui, digest="demo-sui-tx-client01", invoice="a\\\"b,c"',
      ),
    ).toEqual({
      method: "sui",
      digest: "demo-sui-tx-client01",
      invoice: 'a"b,c',
    });
    const fields = {
      method: "sui",
      digest: "demo-sui-tx-client02",
      invoice: 'quoted"\\token',
    };
    expect(parsePaymentAuthorization(paymentAuthorization(fields))).toEqual(
      fields,
    );
  });
  it("rejects duplicate keys, smuggled schemes, controls and incomplete parameters", () => {
    for (const header of [
      "Bearer secret",
      "Payment ",
      'Payment digest="a", DIGEST="b"',
      'Payment digest="unterminated',
      'Payment digest="a", Basic secret',
      'Payment digest="a",',
      "Payment digest=a\n",
      'Payment digest="a"'.repeat(200),
    ])
      expect(() => parsePaymentAuthorization(header)).toThrow();
    expect(() => paymentAuthorization({ digest: "a\r\nb" })).toThrow();
    expect(() => paymentAuthorization({ "invalid key": "a" })).toThrow();
  });
});
