import { Pool } from "pg";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { insertEvent, markDispatched, recordDispatchFailure } from "./ingest/repository.js";
import { sweepUndispatched } from "./ingest/sweeper.js";
import { log } from "./log.js";
import { createIngestQueue } from "./queue/ingest-queue.js";

const config = loadConfig();
const pool = new Pool({ connectionString: config.databaseUrl });
pool.on("error", (error) => {
  log({ level: "error", event: "database_pool_error", message: error.message });
});
const db = createDatabase(pool);
const ingestQueue = createIngestQueue(config.redisUrl, config.redisPrefix);

const app = createApp({
  webhookSecrets: config.webhookSecrets,
  insertEvent: (event) => insertEvent(db, event),
  enqueueEvent: ingestQueue.enqueue,
  markDispatched: (eventId) => markDispatched(db, eventId),
  recordDispatchFailure: (eventId) => recordDispatchFailure(db, eventId),
});

void ingestQueue.waitUntilReady().catch(() => {
  log({ level: "error", event: "queue_unavailable_at_startup" });
});

const server = app.listen(config.port, () => {
  log({ event: "server_started", port: config.port });
});

const SWEEP_INTERVAL_MS = 5_000;
let sweeping = false;

const sweepTimer = setInterval(() => {
  if (sweeping) {
    return;
  }
  sweeping = true;
  void sweepUndispatched({ db, enqueue: ingestQueue.enqueue })
    .then((result) => {
      if (result.candidates > 0) {
        log({ event: "sweep_completed", ...result });
      }
    })
    .catch((error: unknown) => {
      log({ level: "error", event: "sweep_failed", message: error instanceof Error ? error.message : "unknown" });
    })
    .finally(() => {
      sweeping = false;
    });
}, SWEEP_INTERVAL_MS);
sweepTimer.unref();

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  log({ event: "shutdown_started", signal });
  clearInterval(sweepTimer);
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
  await ingestQueue.close();
  await pool.end();
  log({ event: "shutdown_complete" });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
