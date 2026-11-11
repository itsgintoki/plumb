import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { events } from "../../src/db/schema.js";
import { runSimulator } from "../../src/simulator/send.js";
import { testWebhookSecret } from "../harness/env.js";
import { createTestStack, type TestStack } from "../harness/stack.js";

let stack: TestStack;

beforeEach(async () => {
  stack = await createTestStack();
});

afterEach(async () => {
  await stack.close();
});

async function countRows(): Promise<number> {
  const [row] = await stack.db
    .select({ count: sql<number>`count(*)::int` })
    .from(events);
  return row?.count ?? 0;
}

async function countJobs(): Promise<number> {
  const counts = await stack.queue.getJobCounts();
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

describe("simulator", () => {
  it("duplicates, delays, and reorders signed events without extra rows or jobs", async () => {
    const summary = await runSimulator({
      url: `${stack.baseUrl}/webhooks/razorpay`,
      secret: testWebhookSecret,
      events: 6,
      duplicates: 3,
      shuffle: true,
      delayMs: 5,
      seed: 42,
    });

    expect(summary.sent).toBe(18);
    expect(summary.accepted).toBe(18);
    expect(summary.duplicates).toBe(12);
    expect(summary.failed).toBe(0);
    expect(await countRows()).toBe(6);
    expect(await countJobs()).toBe(6);
  });
});
