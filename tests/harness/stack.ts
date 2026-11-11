import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Queue } from "bullmq";
import type { Pool } from "pg";
import { createApp } from "../../src/app.js";
import type { Database } from "../../src/db/client.js";
import { insertEvent, markDispatched, recordDispatchFailure } from "../../src/ingest/repository.js";
import type { NewEvent } from "../../src/ingest/types.js";
import { createIngestQueue, type IngestJobData } from "../../src/queue/ingest-queue.js";
import { createTestDatabase, type TestDatabase } from "./database.js";
import { testRedisUrl, testWebhookSecret } from "./env.js";
import { cleanupRedisPrefix, createRedisClient, createTestPrefix } from "./redis.js";

export type TestStackOptions = {
  secondInstance?: boolean;
  enqueueEvent?: (eventId: string) => Promise<void>;
  webhookSecrets?: readonly string[];
};

export type TestStack = {
  database: TestDatabase;
  db: Database;
  pool: Pool;
  prefix: string;
  queue: Queue<IngestJobData>;
  ingestQueue: ReturnType<typeof createIngestQueue>;
  baseUrl: string;
  secondBaseUrl?: string;
  close: () => Promise<void>;
};

async function startServer(
  app: ReturnType<typeof createApp>,
): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function closeServer(server: Server | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (server === undefined) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeIdleConnections();
  });
}

export async function createTestStack(options: TestStackOptions = {}): Promise<TestStack> {
  const database = await createTestDatabase();
  const prefix = createTestPrefix();
  const ingestQueue = createIngestQueue(testRedisUrl, prefix);
  const redis = createRedisClient();

  let primary: { server: Server; baseUrl: string } | undefined;
  let secondary: { server: Server; baseUrl: string } | undefined;

  try {
    await ingestQueue.waitUntilReady();

    const dependencies = {
      webhookSecrets: options.webhookSecrets ?? [testWebhookSecret],
      insertEvent: (event: NewEvent) => insertEvent(database.db, event),
      enqueueEvent: options.enqueueEvent ?? ingestQueue.enqueue,
      markDispatched: (eventId: string) => markDispatched(database.db, eventId),
      recordDispatchFailure: (eventId: string) => recordDispatchFailure(database.db, eventId),
    };

    primary = await startServer(createApp(dependencies));
    if (options.secondInstance === true) {
      secondary = await startServer(createApp(dependencies));
    }

    return {
      database,
      db: database.db,
      pool: database.pool,
      prefix,
      queue: ingestQueue.queue,
      ingestQueue,
      baseUrl: primary.baseUrl,
      ...(secondary === undefined ? {} : { secondBaseUrl: secondary.baseUrl }),
      async close() {
        await Promise.all([closeServer(primary?.server), closeServer(secondary?.server)]);
        await ingestQueue.close().catch(() => undefined);
        await cleanupRedisPrefix(redis, prefix).catch(() => undefined);
        redis.disconnect();
        await database.drop();
      },
    };
  } catch (error) {
    await Promise.all([closeServer(primary?.server), closeServer(secondary?.server)]);
    await ingestQueue.close().catch(() => undefined);
    redis.disconnect();
    await database.drop().catch(() => undefined);
    throw error;
  }
}
