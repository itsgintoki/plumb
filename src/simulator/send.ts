import { computeSignature } from "../ingest/signature.js";
import { mulberry32, shuffle } from "./prng.js";

export type SimulatorOptions = {
  url: string;
  secret: string;
  events?: number;
  duplicates?: number;
  parallel?: boolean;
  delayMs?: number;
  shuffle?: boolean;
  dropRate?: number;
  seed?: number;
  fetchImpl?: typeof fetch;
};

export type SimulatorSummary = {
  sent: number;
  accepted: number;
  duplicates: number;
  failed: number;
  statuses: Record<string, number>;
};

type Delivery = {
  eventId: string;
  body: string;
  signature: string;
};

const EVENT_TYPES = [
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "refund.processed",
] as const;

export async function runSimulator(options: SimulatorOptions): Promise<SimulatorSummary> {
  const {
    url,
    secret,
    events = 5,
    duplicates = 1,
    parallel = false,
    delayMs = 0,
    shuffle: shouldShuffle = false,
    dropRate = 0,
    seed = 1,
    fetchImpl = fetch,
  } = options;

  if (!Number.isInteger(events) || events < 1) {
    throw new RangeError("events must be a positive integer");
  }
  if (!Number.isInteger(duplicates) || duplicates < 1) {
    throw new RangeError("duplicates must be a positive integer");
  }
  if (delayMs < 0) {
    throw new RangeError("delayMs must be non-negative");
  }
  if (dropRate < 0 || dropRate > 1) {
    throw new RangeError("dropRate must be between 0 and 1");
  }

  const random = mulberry32(seed);
  const runId = `sim_${Date.now().toString(36)}`;
  const deliveries: Delivery[] = [];

  for (let index = 0; index < events; index += 1) {
    const eventId = `evt_${runId}_${index}`;
    const eventType = EVENT_TYPES[index % EVENT_TYPES.length] ?? "payment.authorized";
    const body = JSON.stringify({
      entity: "event",
      event: eventType,
      created_at: Math.floor(Date.now() / 1_000),
      payload: {
        payment: {
          entity: {
            id: `pay_${runId}_${index}`,
            amount: 149_900,
            currency: "INR",
            status: eventType === "payment.captured" ? "captured" : "authorized",
          },
        },
      },
    });
    const signature = computeSignature(Buffer.from(body, "utf8"), secret);

    for (let copy = 0; copy < duplicates; copy += 1) {
      deliveries.push({ eventId, body, signature });
    }
  }

  const kept = dropRate > 0
    ? deliveries.filter(() => random() >= dropRate)
    : deliveries;
  const ordered = shouldShuffle ? shuffle(kept, random) : kept;

  const summary: SimulatorSummary = {
    sent: 0,
    accepted: 0,
    duplicates: 0,
    failed: 0,
    statuses: {},
  };

  const sendOne = async (delivery: Delivery): Promise<void> => {
    summary.sent += 1;
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": delivery.signature,
          "x-razorpay-event-id": delivery.eventId,
        },
        body: delivery.body,
      });

      const status = String(response.status);
      summary.statuses[status] = (summary.statuses[status] ?? 0) + 1;

      if (!response.ok) {
        summary.failed += 1;
        return;
      }

      const payload = await response.json().catch(() => ({})) as { duplicate?: unknown };
      summary.accepted += 1;
      if (payload.duplicate === true) {
        summary.duplicates += 1;
      }
    } catch {
      summary.failed += 1;
    }
  };

  if (parallel) {
    await Promise.all(ordered.map(sendOne));
  } else {
    for (const delivery of ordered) {
      await sendOne(delivery);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  return summary;
}
