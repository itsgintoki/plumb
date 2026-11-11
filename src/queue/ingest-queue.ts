import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { log } from "../log.js";

export const ingestQueueName = "payments-ingest";
export const ingestJobName = "payment-event-received";

export type IngestJobData = {
  eventId: string;
  version: 1;
};

export const ingestJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { count: 1_000 },
  removeOnFail: false,
};

export type IngestQueue = {
  queue: Queue<IngestJobData>;
  enqueue: (eventId: string) => Promise<void>;
  waitUntilReady: () => Promise<void>;
  close: () => Promise<void>;
};

export function createIngestQueue(redisUrl: string, prefix: string): IngestQueue {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 5_000,
    commandTimeout: 5_000,
  });
  connection.on("error", () => log({ level: "error", event: "redis_producer_error" }));

  const queue = new Queue<IngestJobData>(ingestQueueName, {
    connection,
    prefix,
    defaultJobOptions: ingestJobOptions,
  });
  queue.on("error", () => log({ level: "error", event: "ingest_queue_error" }));

  async function enqueue(eventId: string): Promise<void> {
    if (connection.status !== "ready") {
      throw new Error("queue_unavailable");
    }
    await queue.add(ingestJobName, { eventId, version: 1 }, { jobId: eventId });
  }

  return {
    queue,
    enqueue,
    async waitUntilReady(): Promise<void> {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          queue.waitUntilReady(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("queue_unavailable")), 5_000);
          }),
        ]);
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
    },
    async close(): Promise<void> {
      connection.disconnect();
      await queue.close();
    },
  };
}
