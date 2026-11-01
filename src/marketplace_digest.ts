import { z } from "zod";
import type { EmailMessage } from "./infrai_client.ts";

export const marketplaceUpdateSchema = z.object({
  updateId: z.string().min(1),
  subscriberEmail: z.string().email(),
  seller: z.object({
    displayName: z.string().min(1),
    assetName: z.string().min(1),
  }),
  buyerUpdate: z.enum(["asset_ready", "revision_posted", "order_handoff"]),
  order: z.object({
    orderId: z.string().min(1),
    handoffUrl: z.string().url(),
  }),
  occurredAt: z.string().datetime(),
});

export type MarketplaceUpdate = z.infer<typeof marketplaceUpdateSchema>;

const labels: Record<MarketplaceUpdate["buyerUpdate"], string> = {
  asset_ready: "asset ready",
  revision_posted: "revision posted",
  order_handoff: "order handoff ready",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] as string);
}

export function buildSubscriberDigests(updates: MarketplaceUpdate[]): EmailMessage[] {
  const grouped = new Map<string, MarketplaceUpdate[]>();
  for (const update of updates) {
    const list = grouped.get(update.subscriberEmail) ?? [];
    list.push(update);
    grouped.set(update.subscriberEmail, list);
  }

  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([to, items]) => ({
    to,
    subject: `${items.length} marketplace update${items.length === 1 ? "" : "s"}`,
    html: `<h1>Your marketplace digest</h1><ul>${items
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .map((item) => `<li><strong>${escapeHtml(item.seller.assetName)}</strong> from ${escapeHtml(item.seller.displayName)}: ${labels[item.buyerUpdate]} for order ${escapeHtml(item.order.orderId)}. <a href="${escapeHtml(item.order.handoffUrl)}">Open handoff</a></li>`)
      .join("")}</ul>`,
  }));
}
