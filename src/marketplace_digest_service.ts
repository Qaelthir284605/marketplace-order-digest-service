import { createServer, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createInfraiClient, InfraiError, type InfraiClient } from "./infrai_client.ts";
import { buildSubscriberDigests, marketplaceUpdateSchema, type MarketplaceUpdate } from "./marketplace_digest.ts";

const updates: MarketplaceUpdate[] = [];
const callbackSchema = z.object({}).passthrough();

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function digestRequestId(batch: MarketplaceUpdate[]): string {
  const ids = batch.map((item) => item.updateId).sort().join(":");
  return `marketplace-digest-${createHash("sha256").update(ids).digest("hex").slice(0, 24)}`;
}

export async function deliverPendingDigests(infrai: InfraiClient): Promise<{ recipients: number; message_id?: string }> {
  const snapshot = updates.slice();
  const messages = buildSubscriberDigests(snapshot);
  if (messages.length === 0) return { recipients: 0 };
  const sent = await infrai.email.batch.send({ messages }, digestRequestId(snapshot));
  updates.splice(0, snapshot.length);
  return { recipients: messages.length, message_id: sent.message_id };
}

export async function registerSchedule(infrai: InfraiClient, task: string): Promise<string> {
  const result = await infrai.cron.create(
    { cron_expr: "0 9 * * 1-5", task },
    `marketplace-weekday-digest-${createHash("sha256").update(task).digest("hex").slice(0, 20)}`,
  );
  return result.job_id;
}

export function createMarketplaceServer(infrai: InfraiClient) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/updates") {
        const update = marketplaceUpdateSchema.parse(await readJson(request));
        updates.push(update);
        return json(response, 202, { accepted: update.updateId });
      }
      if (request.method === "POST" && request.url === "/tasks/marketplace-digest") {
        callbackSchema.parse(await readJson(request));
        return json(response, 200, await deliverPendingDigests(infrai));
      }
      return json(response, 404, { error: "Route not found" });
    } catch (error) {
      if (error instanceof z.ZodError) return json(response, 400, { error: "Invalid request", issues: error.issues });
      if (error instanceof InfraiError) {
        const status = error.status >= 400 && error.status < 500 ? error.status : 502;
        return json(response, status, { error: error.code, message: error.message });
      }
      return json(response, 500, { error: "Request failed" });
    }
  });
}

const infrai = createInfraiClient();
if (process.argv[2] === "schedule") {
  const publicUrl = z.string().url().parse(process.env.PUBLIC_BASE_URL);
  const jobId = await registerSchedule(infrai, `${publicUrl.replace(/\/$/, "")}/tasks/marketplace-digest`);
  console.log(`Scheduled marketplace digest: ${jobId}`);
} else {
  const port = Number(process.env.PORT ?? "3000");
  createMarketplaceServer(infrai).listen(port, () => console.log(`Marketplace digest service listening on http://localhost:${port}`));
}
