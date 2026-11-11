import { parseArgs } from "node:util";
import { runSimulator } from "./send.js";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3000/webhooks/razorpay" },
    secret: { type: "string" },
    events: { type: "string", default: "5" },
    duplicates: { type: "string", default: "1" },
    parallel: { type: "boolean", default: false },
    delay: { type: "string", default: "0" },
    shuffle: { type: "boolean", default: false },
    drop: { type: "string", default: "0" },
    seed: { type: "string", default: "1" },
  },
  allowPositionals: false,
});

const secret = values.secret ?? process.env.WEBHOOK_SECRETS?.split(",")[0]?.trim();
if (secret === undefined || secret.length === 0) {
  console.error("Provide --secret or set WEBHOOK_SECRETS.");
  process.exit(1);
}

const summary = await runSimulator({
  url: values.url,
  secret,
  events: parseInteger(values.events, "events"),
  duplicates: parseInteger(values.duplicates, "duplicates"),
  parallel: values.parallel,
  delayMs: parseInteger(values.delay, "delay"),
  shuffle: values.shuffle,
  dropRate: parseRate(values.drop),
  seed: parseInteger(values.seed, "seed"),
});

console.log(JSON.stringify(summary, null, 2));
if (summary.failed > 0) {
  process.exitCode = 1;
}

function parseInteger(raw: string, name: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return value;
}

function parseRate(raw: string): number {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("--drop must be between 0 and 1");
  }
  return value;
}
