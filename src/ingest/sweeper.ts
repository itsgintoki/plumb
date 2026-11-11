import type { Database } from "../db/client.js";
import { log } from "../log.js";
import { findUndispatched, markDispatched, recordDispatchFailure } from "./repository.js";

export type SweepOptions = {
  db: Database;
  enqueue: (eventId: string) => Promise<void>;
  limit?: number;
  minAgeMs?: number;
};

export async function sweepUndispatched({
  db,
  enqueue,
  limit = 100,
  minAgeMs = 5_000,
}: SweepOptions): Promise<{ candidates: number; dispatched: number }> {
  const cutoff = new Date(Date.now() - minAgeMs);
  const candidates = await findUndispatched(db, cutoff, limit);
  let dispatched = 0;

  for (const candidate of candidates) {
    try {
      await enqueue(candidate.eventId);
      await markDispatched(db, candidate.eventId);
      dispatched += 1;
    } catch {
      await recordDispatchFailure(db, candidate.eventId);
      log({ level: "warn", event: "dispatch_failed", eventId: candidate.eventId });
    }
  }

  return { candidates: candidates.length, dispatched };
}
