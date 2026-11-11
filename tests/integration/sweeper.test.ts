import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { events } from "../../src/db/schema.js";
import { sweepUndispatched } from "../../src/ingest/sweeper.js";
import { makeEventBody, postEvent } from "../harness/http.js";
import { createTestStack, type TestStack } from "../harness/stack.js";

let stack: TestStack | undefined;

afterEach(async () => {
  if (stack !== undefined) {
    await stack.close();
    stack = undefined;
  }
});

describe("dispatch sweeper", () => {
  it("dispatches an event whose inline enqueue failed", async () => {
    let failing = true;
    let active: TestStack | undefined;

    active = await createTestStack({
      enqueueEvent: async (eventId) => {
        if (failing) {
          throw new Error("redis down");
        }
        if (active === undefined) {
          throw new Error("stack missing");
        }
        await active.ingestQueue.enqueue(eventId);
      },
    });
    stack = active;

    const response = await postEvent(active.baseUrl, {
      eventId: "evt_pending",
      body: makeEventBody(1),
    });
    expect(response.status).toBe(200);

    const [pending] = await active.db
      .select()
      .from(events)
      .where(eq(events.eventId, "evt_pending"));
    expect(pending?.dispatchedAt).toBeNull();
    expect(pending?.dispatchAttempts).toBe(1);
    expect(await active.queue.getJob("evt_pending")).toBeUndefined();

    failing = false;
    const result = await sweepUndispatched({
      db: active.db,
      enqueue: active.ingestQueue.enqueue,
      minAgeMs: 0,
    });
    expect(result).toEqual({ candidates: 1, dispatched: 1 });

    const [dispatched] = await active.db
      .select()
      .from(events)
      .where(eq(events.eventId, "evt_pending"));
    expect(dispatched?.dispatchedAt).not.toBeNull();
    expect(dispatched?.dispatchAttempts).toBe(2);
    expect(await active.queue.getJob("evt_pending")).toBeDefined();

    const second = await sweepUndispatched({
      db: active.db,
      enqueue: active.ingestQueue.enqueue,
      minAgeMs: 0,
    });
    expect(second.candidates).toBe(0);

    const counts = await active.queue.getJobCounts();
    expect(Object.values(counts).reduce((total, count) => total + count, 0)).toBe(1);
  });

  it("leaves the event pending while dispatch keeps failing", async () => {
    const active = await createTestStack({
      enqueueEvent: async () => {
        throw new Error("redis down");
      },
    });
    stack = active;

    const response = await postEvent(active.baseUrl, {
      eventId: "evt_still_down",
      body: makeEventBody(2),
    });
    expect(response.status).toBe(200);

    const result = await sweepUndispatched({
      db: active.db,
      enqueue: async () => {
        throw new Error("redis down");
      },
      minAgeMs: 0,
    });
    expect(result).toEqual({ candidates: 1, dispatched: 0 });

    const [row] = await active.db
      .select()
      .from(events)
      .where(eq(events.eventId, "evt_still_down"));
    expect(row?.dispatchedAt).toBeNull();
    expect(row?.dispatchAttempts).toBe(2);
    expect(await active.queue.getJob("evt_still_down")).toBeUndefined();
  });
});
