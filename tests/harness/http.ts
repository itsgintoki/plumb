import { computeSignature } from "../../src/ingest/signature.js";
import { testWebhookSecret } from "./env.js";

export type PostEventOptions = {
  eventId?: string;
  body: string;
  secret?: string;
  signature?: string;
  contentType?: string;
  includeEventId?: boolean;
};

export function postEvent(baseUrl: string, options: PostEventOptions): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": options.contentType ?? "application/json",
    "x-razorpay-signature": options.signature
      ?? computeSignature(Buffer.from(options.body, "utf8"), options.secret ?? testWebhookSecret),
  };

  if (options.includeEventId !== false) {
    headers["x-razorpay-event-id"] = options.eventId ?? "evt_test";
  }

  return fetch(`${baseUrl}/webhooks/razorpay`, {
    method: "POST",
    headers,
    body: options.body,
  });
}

export function makeEventBody(index = 0, eventType = "payment.captured"): string {
  return JSON.stringify({
    entity: "event",
    event: eventType,
    created_at: 1_700_000_000,
    payload: {
      payment: {
        entity: {
          id: `pay_${index}`,
          amount: 149_900,
          currency: "INR",
          status: eventType === "payment.captured" ? "captured" : "authorized",
        },
      },
    },
  });
}
