import { createHmac, timingSafeEqual } from "node:crypto";

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

export function computeSignature(rawBody: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifySignature(
  rawBody: Buffer,
  header: string | undefined,
  secrets: readonly string[],
): boolean {
  if (header === undefined || !HEX_SHA256.test(header)) {
    return false;
  }

  const received = Buffer.from(header, "hex");
  let valid = false;

  for (const secret of secrets) {
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    if (received.length === expected.length && timingSafeEqual(received, expected)) {
      valid = true;
    }
  }

  return valid;
}
