CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"signature" text NOT NULL,
	"received_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	"dispatched_at" timestamp (3) with time zone,
	"dispatch_attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "events_event_id_length" CHECK (char_length("events"."event_id") BETWEEN 1 AND 255),
	CONSTRAINT "events_event_type_length" CHECK (char_length("events"."event_type") BETWEEN 1 AND 200),
	CONSTRAINT "events_payload_sha256_format" CHECK ("events"."payload_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "events_signature_format" CHECK ("events"."signature" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "events_dispatch_attempts_nonnegative" CHECK ("events"."dispatch_attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX "events_pending_dispatch_idx" ON "events" USING btree ("dispatched_at","received_at");