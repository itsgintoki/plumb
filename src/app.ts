import express, { type NextFunction, type Request, type Response } from "express";
import { createIngestRouter, type IngestDependencies } from "./ingest/routes.js";
import { log } from "./log.js";

export function createApp(dependencies: IngestDependencies) {
  const app = express();
  app.disable("x-powered-by");

  // The raw parser must see the webhook body before any JSON parser consumes the stream.
  app.use("/webhooks/razorpay", createIngestRouter(dependencies));

  app.use(express.json({ limit: "1mb" }));
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : 500;

    if (status === 413) {
      res.status(413).json({ error: "payload_too_large" });
      return;
    }
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: "invalid_request" });
      return;
    }

    log({ level: "error", event: "unhandled_error", message: error instanceof Error ? error.message : "unknown" });
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
