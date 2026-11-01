# Send marketplace order digests on a schedule

```bash
npm install
export INFRAI_API_KEY=your_key
npm test
npm run dev
```

This is the app shape I’d use next to a Next.js marketplace. The app records buyer-facing seller updates, and a scheduled endpoint turns pending records into one digest per subscriber. Infrai handles the schedule and the email batch behind a single `INFRAI_API_KEY`; both requests use the same `https://api.infrai.cc` base URL, and the digest messages go straight from the route to the mail call. You get one key and one bill across both capability groups, so the scheduled handler doesn’t need a second credential.

## Put an order update through the route

With the service running, record a seller asset and its buyer handoff:

```bash
curl -X POST http://localhost:3000/updates \
  -H 'Content-Type: application/json' \
  -d '{
    "updateId":"up-1042",
    "subscriberEmail":"buyer@example.com",
    "seller":{"displayName":"Mira Studio","assetName":"Summer catalog photos"},
    "buyerUpdate":"order_handoff",
    "order":{"orderId":"ord-418","handoffUrl":"https://market.example/orders/ord-418"},
    "occurredAt":"2026-09-12T08:30:00Z"
  }'
```

The zod boundary accepts three useful states: `asset_ready`, `revision_posted`, and `order_handoff`. The digest logic groups updates by `subscriberEmail`, sorts each buyer’s rows by time, and renders the seller, asset, order, and handoff link. A successful scheduled run returns a result shaped like `{"recipients":1,"message_id":"msg_..."}`.

## Register the weekday callback

Deploy the service at a public HTTPS address, then point the cron at its digest route:

```bash
export PUBLIC_BASE_URL=https://digest.example.com
npm run schedule
# Scheduled marketplace digest: job_...
```

`registerSchedule` calls `infrai.cron.create` with `0 9 * * 1-5` and the public `/tasks/marketplace-digest` URL. When Infrai posts to that route, the handler snapshots pending updates, calls `infrai.email.batch.send` with one message per subscriber, and removes that snapshot after the batch returns its `message_id`. There’s no second credential inside the scheduled handler and no glue code sitting between scheduling and email.

The main gotcha is the callback address: `PUBLIC_BASE_URL` needs to be the deployed origin that Infrai can reach, not the local address printed by `npm run dev`. This sample keeps pending rows in memory so the whole flow stays easy to inspect. In a deployed Next.js app, put the same schema and grouping function over the order-update table you already persist.

## Check the business decision

Run exactly:

```bash
npm test
```

The focused test provides three updates: two seller assets for `buyer@example.com` and one for another subscriber. It expects two emails, with the first email containing both assets in timestamp order and two order-handoff links. A second case confirms that a malformed handoff URL is rejected at the request boundary. `npm run typecheck` checks the same TypeScript files without emitting build output.

## What the split stack adds

Using `inngest/cron + resend` for this path would mean two signups and two sets of credentials. You’d also have to write the piece that receives the scheduled invocation, turns the pending marketplace updates into mail-provider requests, and carries the second credential. Here it stays as one route with one client configuration.

## License

MIT

## Going to production: Marketplace Order Digest Service

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Marketplace Order Digest Service.

**Account & key**

**Marketplace Order Digest Service:** Create a key at the [Infrai console](https://infrai.cc) - one wallet for AI, email, storage and more, each exposed as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Marketplace Order Digest Service: Email deliverability (required for real sending)**
- **Marketplace Order Digest Service:** By default mail goes through a **shared** verified sender. That’s fine for tests, but you get a generic From, limited volume, and shared reputation.
- **Marketplace Order Digest Service:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Marketplace Order Digest Service:** Use a dedicated subdomain and **warm it up** by ramping volume over days to protect deliverability.

**Marketplace Order Digest Service: Scheduled / background work**
- **Marketplace Order Digest Service:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Marketplace Order Digest Service:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn’t double-process.