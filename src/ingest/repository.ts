import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { events } from "../db/schema.js";
import type { NewEvent } from "./types.js";

export async function insertEvent(
  db: Database,
  event: NewEvent,
): Promise<number | undefined> {
  const [inserted] = await db
    .insert(events)
    .values(event)
    .onConflictDoNothing({ target: events.eventId })
    .returning({ id: events.id });

  return inserted?.id;
}

export async function markDispatched(db: Database, eventId: string): Promise<void> {
  await db
    .update(events)
    .set({
      dispatchedAt: sql`clock_timestamp()`,
      dispatchAttempts: sql`${events.dispatchAttempts} + 1`,
    })
    .where(eq(events.eventId, eventId));
}

export async function recordDispatchFailure(db: Database, eventId: string): Promise<void> {
  await db
    .update(events)
    .set({
      dispatchAttempts: sql`${events.dispatchAttempts} + 1`,
    })
    .where(eq(events.eventId, eventId));
}

export async function findUndispatched(db: Database, cutoff: Date, limit: number) {
  return db
    .select({ id: events.id, eventId: events.eventId })
    .from(events)
    .where(and(isNull(events.dispatchedAt), lt(events.receivedAt, cutoff)))
    .orderBy(events.id)
    .limit(limit);
}
