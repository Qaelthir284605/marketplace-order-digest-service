import assert from "node:assert/strict";
import test from "node:test";
import { buildSubscriberDigests, marketplaceUpdateSchema } from "./marketplace_digest.ts";

test("groups seller assets and order handoffs by subscribed buyer", () => {
  const input = [
    { updateId: "up-2", subscriberEmail: "buyer@example.com", seller: { displayName: "Mira", assetName: "Launch icons" }, buyerUpdate: "order_handoff", order: { orderId: "ord-41", handoffUrl: "https://market.example/orders/ord-41" }, occurredAt: "2026-09-12T09:00:00Z" },
    { updateId: "up-1", subscriberEmail: "buyer@example.com", seller: { displayName: "Jo", assetName: "Storefront theme" }, buyerUpdate: "revision_posted", order: { orderId: "ord-40", handoffUrl: "https://market.example/orders/ord-40" }, occurredAt: "2026-09-12T08:00:00Z" },
    { updateId: "up-3", subscriberEmail: "other@example.com", seller: { displayName: "Mira", assetName: "Product photos" }, buyerUpdate: "asset_ready", order: { orderId: "ord-42", handoffUrl: "https://market.example/orders/ord-42" }, occurredAt: "2026-09-12T10:00:00Z" },
  ].map((item) => marketplaceUpdateSchema.parse(item));

  const messages = buildSubscriberDigests(input);
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.to, "buyer@example.com");
  assert.equal(messages[0]?.subject, "2 marketplace updates");
  assert.match(messages[0]?.html ?? "", /Storefront theme.*Launch icons/);
  assert.equal((messages[0]?.html.match(/Open handoff/g) ?? []).length, 2);
});

test("rejects an update without a valid handoff URL", () => {
  const result = marketplaceUpdateSchema.safeParse({
    updateId: "up-bad",
    subscriberEmail: "buyer@example.com",
    seller: { displayName: "Jo", assetName: "Theme" },
    buyerUpdate: "order_handoff",
    order: { orderId: "ord-99", handoffUrl: "local-order" },
    occurredAt: "2026-09-12T08:00:00Z",
  });
  assert.equal(result.success, false);
});
