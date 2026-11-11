import { describe, expect, it } from "vitest";
import { computeSignature, verifySignature } from "../../src/ingest/signature.js";

const secret = "unit-test-secret";
const body = Buffer.from('{"event":"payment.captured"}', "utf8");

describe("verifySignature", () => {
  it("accepts a signature made with the same secret", () => {
    expect(verifySignature(body, computeSignature(body, secret), [secret])).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifySignature(body, computeSignature(body, "other-secret"), [secret])).toBe(false);
  });

  it("rejects a tampered body", () => {
    const signature = computeSignature(body, secret);
    expect(
      verifySignature(Buffer.from('{"event":"payment.failed"}', "utf8"), signature, [secret]),
    ).toBe(false);
  });

  it("rejects malformed hash headers", () => {
    expect(verifySignature(body, "not-hex", [secret])).toBe(false);
    expect(verifySignature(body, "abc", [secret])).toBe(false);
    expect(verifySignature(body, "0".repeat(63), [secret])).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifySignature(body, undefined, [secret])).toBe(false);
  });

  it("accepts uppercase hex", () => {
    expect(verifySignature(body, computeSignature(body, secret).toUpperCase(), [secret])).toBe(true);
  });

  it("accepts any configured secret during rotation", () => {
    const secrets = ["new-secret", "old-secret"];
    expect(verifySignature(body, computeSignature(body, "new-secret"), secrets)).toBe(true);
    expect(verifySignature(body, computeSignature(body, "old-secret"), secrets)).toBe(true);
  });
});
