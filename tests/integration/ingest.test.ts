import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { events } from "../../src/db/schema.js";
import { computeSignature } from "../../src/ingest/signature.js";
import { testWebhookSecret } from "../harness/env.js";
import { makeEventBody, postEvent } from "../harness/http.js";
import { createTestStack, type TestStack } from "../harness/stack.js";

let stack: TestStack;

beforeEach(async () => {
  stack = await createTestStack({ secondInstance: true });
});

afterEach(async () => {
  await stack.close();
});

async function countEvents(): Promise<number> {
  const [row] = await stack.db
    .select({ count: sql<number>`count(*)::int` })
    .from(events);
  return row?.count ?? 0;
}

async function countJobs(): Promise<number> {
  const counts = await stack.queue.getJobCounts();
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

describe("webhook ingest", () => {
  it("stores the exact bytes and enqueues one job", async () => {
    const body = makeEventBody(1);
    const response = await postEvent(stack.baseUrl, { eventId: "evt_exact", body });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, duplicate: false });

    const [row] = await stack.db.select().from(events);
    expect(row).toBeDefined();
    expect(row?.payload).toBe(body);
    expect(row?.payloadSha256).toBe(
      createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex"),
    );
    expect(row?.eventType).toBe("payment.captured");
    expect(row?.dispatchedAt).not.toBeNull();

    const job = await stack.queue.getJob("evt_exact");
    expect(job).toBeDefined();
    expect(job?.data).toEqual({ eventId: "evt_exact", version: 1 });
  });

  it("accepts an uppercase hex signature and stores it canonically", async () => {
    const body = makeEventBody(9);
    const signature = computeSignature(Buffer.from(body, "utf8"), testWebhookSecret).toUpperCase();

    const response = await postEvent(stack.baseUrl, {
      eventId: "evt_uppercase",
      body,
      signature,
    });

    expect(response.status).toBe(200);

    const [row] = await stack.db
      .select()
      .from(events)
      .where(eq(events.eventId, "evt_uppercase"));
    expect(row?.signature).toBe(signature.toLowerCase());
  });

  it("returns duplicate and keeps one row and one job on sequential replay", async () => {
    const body = makeEventBody(2);

    const first = await postEvent(stack.baseUrl, { eventId: "evt_replay", body });
    const second = await postEvent(stack.baseUrl, { eventId: "evt_replay", body });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, duplicate: true });
    expect(await countEvents()).toBe(1);
    expect(await countJobs()).toBe(1);
  });

  it("keeps one row and one job for ten parallel deliveries of the same event", async () => {
    const body = makeEventBody(3);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        postEvent(stack.baseUrl, { eventId: "evt_parallel", body }),
      ),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);

    const payloads = await Promise.all(responses.map((response) => response.json())) as Array<{
      ok: boolean;
      duplicate: boolean;
    }>;
    expect(payloads.filter((payload) => payload.duplicate === false)).toHaveLength(1);

    expect(await countEvents()).toBe(1);
    expect(await countJobs()).toBe(1);
  });

  it("dedupes across two app instances sharing one database", async () => {
    const secondBaseUrl = stack.secondBaseUrl;
    if (secondBaseUrl === undefined) {
      throw new Error("second instance was not started");
    }

    const body = makeEventBody(4);
    const urls = [stack.baseUrl, secondBaseUrl];

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        postEvent(urls[index % urls.length] ?? stack.baseUrl, {
          eventId: "evt_two_instances",
          body,
        }),
      ),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(await countEvents()).toBe(1);
    expect(await countJobs()).toBe(1);
  });

  it("rejects a bad signature without storing anything", async () => {
    const response = await postEvent(stack.baseUrl, {
      eventId: "evt_bad_signature",
      body: makeEventBody(5),
      signature: "0".repeat(64),
    });

    expect(response.status).toBe(401);
    expect(await countEvents()).toBe(0);
    expect(await countJobs()).toBe(0);
  });

  it("rejects a tampered body even with a valid original signature", async () => {
    const body = makeEventBody(6);
    const signature = computeSignature(Buffer.from(body, "utf8"), testWebhookSecret);
    const tampered = body.replace("149900", "1");

    const response = await postEvent(stack.baseUrl, {
      eventId: "evt_tampered",
      body: tampered,
      signature,
    });

    expect(response.status).toBe(401);
    expect(await countEvents()).toBe(0);
  });

  it("rejects a missing event id", async () => {
    const response = await postEvent(stack.baseUrl, {
      body: makeEventBody(7),
      includeEventId: false,
    });

    expect(response.status).toBe(400);
    expect(await countEvents()).toBe(0);
  });

  it("rejects a body that is not JSON", async () => {
    const response = await postEvent(stack.baseUrl, {
      eventId: "evt_text",
      body: makeEventBody(8),
      contentType: "text/plain",
    });

    expect(response.status).toBe(415);
    expect(await countEvents()).toBe(0);
  });

  it("stores an authentic but unparseable payload instead of dropping it", async () => {
    const body = "this is not json";
    const response = await postEvent(stack.baseUrl, { eventId: "evt_unparseable", body });

    expect(response.status).toBe(200);

    const [row] = await stack.db.select().from(events);
    expect(row?.eventType).toBe("unknown");
    expect(row?.payload).toBe(body);
    expect(await countJobs()).toBe(1);
  });

  it("rejects a body over the size limit", async () => {
    const body = JSON.stringify({
      event: "payment.captured",
      blob: "x".repeat(300 * 1024),
    });

    const response = await postEvent(stack.baseUrl, { eventId: "evt_too_large", body });

    expect(response.status).toBe(413);
    expect(await countEvents()).toBe(0);
  });
});
