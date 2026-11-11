import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const events = pgTable("events", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  eventId: text("event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  signature: text("signature").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true, precision: 3 })
    .notNull()
    .default(sql`clock_timestamp()`),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true, precision: 3 }),
  dispatchAttempts: integer("dispatch_attempts").notNull().default(0),
}, (table) => [
  check("events_event_id_length", sql`char_length(${table.eventId}) BETWEEN 1 AND 255`),
  check("events_event_type_length", sql`char_length(${table.eventType}) BETWEEN 1 AND 200`),
  check("events_payload_sha256_format", sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`),
  check("events_signature_format", sql`${table.signature} ~ '^[0-9a-f]{64}$'`),
  check("events_dispatch_attempts_nonnegative", sql`${table.dispatchAttempts} >= 0`),
  index("events_pending_dispatch_idx").on(table.dispatchedAt, table.receivedAt),
]);

export type Event = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
