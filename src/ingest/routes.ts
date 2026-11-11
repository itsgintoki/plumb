import { createHash } from "node:crypto";
import express from "express";
import { log } from "../log.js";
import { verifySignature } from "./signature.js";
import type { NewEvent } from "./types.js";

export type IngestDependencies = {
  webhookSecrets: readonly string[];
  insertEvent: (event: NewEvent) => Promise<number | undefined>;
  enqueueEvent: (eventId: string) => Promise<void>;
  markDispatched: (eventId: string) => Promise<void>;
  recordDispatchFailure: (eventId: string) => Promise<void>;
};

const MAX_BODY_BYTES = 256 * 1024;
const EVENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,255}$/;

export function createIngestRouter(dependencies: IngestDependencies): express.Router {
  const router = express.Router();

  router.post(
    "/",
    express.raw({ type: "application/json", limit: MAX_BODY_BYTES }),
    async (req, res) => {
      const startedAt = performance.now();
      const rawBody: unknown = req.body;

      if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
        res.status(415).json({ error: "unsupported_media_type" });
        return;
      }

      const signature = req.get("x-razorpay-signature");
      if (signature === undefined || !verifySignature(rawBody, signature, dependencies.webhookSecrets)) {
        log({ level: "warn", event: "ingest_rejected", reason: "invalid_signature" });
        res.status(401).json({ error: "invalid_signature" });
        return;
      }

      const eventId = req.get("x-razorpay-event-id");
      if (eventId === undefined || !EVENT_ID_PATTERN.test(eventId)) {
        res.status(400).json({ error: "invalid_event_id" });
        return;
      }

      const eventType = readEventType(rawBody);
      let insertedId: number | undefined;

      try {
        insertedId = await dependencies.insertEvent({
          eventId,
          eventType,
          payload: rawBody.toString("utf8"),
          payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
          signature: signature.toLowerCase(),
        });
      } catch (error) {
        log({ level: "error", event: "ingest_failed", reason: "insert_failed", message: messageOf(error) });
        res.status(500).json({ error: "internal_error" });
        return;
      }

      const duplicate = insertedId === undefined;

      if (!duplicate) {
        try {
          await dependencies.enqueueEvent(eventId);
          await dependencies.markDispatched(eventId);
        } catch (error) {
          await dependencies.recordDispatchFailure(eventId).catch(() => undefined);
          log({ level: "warn", event: "ingest_dispatch_pending", eventId, message: messageOf(error) });
        }
      }

      log({
        event: "ingest_completed",
        eventId,
        eventType,
        duplicate,
        durationMs: Math.round(performance.now() - startedAt),
      });
      res.status(200).json({ ok: true, duplicate });
    },
  );

  return router;
}

function readEventType(rawBody: Buffer): string {
  try {
    const parsed: unknown = JSON.parse(rawBody.toString("utf8"));
    if (typeof parsed === "object" && parsed !== null && "event" in parsed) {
      const value = (parsed as { event?: unknown }).event;
      if (typeof value === "string" && value.length > 0 && value.length <= 200) {
        return value;
      }
    }
  } catch {
    // Authentic but unparseable payloads are still recorded; M2 decides what they mean.
  }
  return "unknown";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "unknown";
}
