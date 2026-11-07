# Notification service

Browser push notifications and signed outbound webhooks for a small audience, at near-zero cost.
The frontend is a static page on GitHub Pages (`build/notify/`). The backend is a single AWS Lambda
behind a free Function URL, plus one on-demand DynamoDB table.

```
GitHub Pages (ashutoshverma.com/notify/)
  button → Service Worker → push subscription (+ optional location)
        │  POST /devices
        ▼
Lambda Function URL ──► DynamoDB (devices, webhooks, logs)
        │
        ├─► browser push services (FCM / Mozilla / Apple) ──► visitor's device
        └─► your webhook URLs (HMAC-signed POST)
```

**Cost at ~100 users:** $0/month on the AWS always-free tier (Lambda 1M requests, DynamoDB 25 GB).
No API Gateway, NAT, WAF or Secrets Manager, so there are no fixed monthly charges.

## Deploy

Prerequisites: an AWS account, [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
configured (`aws configure`), [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html), Node.js 22+.

```bash
cd notification-service
npm install
npm run vapid            # prints a VAPID public + private key pair; keep both
openssl rand -hex 32     # your admin API key
npm run deploy           # sam build && sam deploy --guided
```

During `sam deploy --guided`, answer:

| Prompt | Value |
|---|---|
| Stack name | `notification-service` |
| Region | the one closest to your visitors, e.g. `ap-south-1` |
| AllowedOrigin | `https://ashutoshverma.com` |
| VapidPublicKey / VapidPrivateKey | from `npm run vapid` |
| AdminApiKey | from `openssl rand -hex 32` |
| "NotifyFunction Function Url has no authentication. Is this okay?" | `y` (admin routes check `x-api-key` themselves) |
| Save arguments to configuration file | `y` (samconfig.toml is git-ignored) |

Copy the `ApiUrl` output into `API_URL` at the top of
[build/notify/notify.js](../build/notify/notify.js), then push to `main`. GitHub Pages redeploys.

**Keep the VAPID keys.** If they change, every existing subscription stops working and visitors
have to subscribe again.

## Use it

```bash
API=https://xxxx.lambda-url.ap-south-1.on.aws
KEY=<your admin key>

# Notify everyone
curl -X POST $API/events -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"broadcast":true,"notification":{"title":"New post","body":"Kafka vs SQS","url":"https://ashutoshverma.com/"}}'

# Notify one visitor (userId is the anonymous id their browser registered with)
curl -X POST $API/events -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"userId":"<id>","notification":{"title":"Hi"}}'

# See registered devices / today's delivery log
curl $API/devices -H "x-api-key: $KEY"
curl "$API/logs?day=2026-11-07" -H "x-api-key: $KEY"

# Register a webhook. The response contains the signing secret, which is shown only once.
curl -X POST $API/webhooks -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"url":"https://example.com/hooks/notify","events":["order.shipped"]}'

# Send an event to webhooks only (no notification)
curl -X POST $API/events -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"name":"order.shipped","data":{"orderId":42}}'
```

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | liveness |
| GET | `/vapid-public-key` | none | key the browser needs to subscribe |
| POST | `/devices` | none | register a device (called by the page) |
| POST | `/devices/unsubscribe` | none | remove a device (`userId` + exact `endpoint`) |
| POST | `/events` | `x-api-key` | send a notification and/or fire webhooks |
| GET | `/devices[?userId=]` | `x-api-key` | list devices (push keys omitted) |
| GET | `/logs[?day=YYYY-MM-DD]` | `x-api-key` | delivery summaries, kept 30 days |
| GET / POST | `/webhooks` | `x-api-key` | list / create webhooks |
| DELETE | `/webhooks/{id}` | `x-api-key` | delete a webhook |

`POST /events` body: `name` (default `notification`), optional `notification {title, body, url, icon, tag}`,
target `userId` | `userIds[]` | `broadcast: true`, optional `data` (passed to the page and to webhooks).

## Verifying webhooks (receiver side)

Each POST carries `x-webhook-id` and `x-webhook-signature: t=<unix>,v1=<hex>`, where
`v1 = HMAC-SHA256(secret, "<t>.<raw body>")`.

```js
import crypto from "node:crypto";
function verify(rawBody, header, secret, toleranceSec = 300) {
  const [, t, v1] = header.match(/^t=(\d+),v1=([0-9a-f]{64})$/) ?? [];
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

Deliveries are retried up to 3 times on 5xx, 429 or network errors. Use `x-webhook-id` to drop duplicates.

## What's collected, and the safeguards

- **Stored per device:** push endpoint and keys, IP (from the request), user agent, language,
  time zone, and location only when the visitor ticks the box *and* the browser grants it.
  The consent time and policy version are stored too. Unsubscribing deletes the row.
- **SSRF protection:** device endpoints must be on known browser push hosts. Webhook URLs must be
  https and must not resolve to private, loopback or metadata IPs. This is checked at creation
  and again before each send.
- **Expired subscriptions** (404/410 from the push service) are deleted automatically.
- **Logs** expire after 30 days (DynamoDB TTL); CloudWatch logs are kept 7 days.

## Browser support notes

- Chrome, Edge and Firefox on desktop and Android work directly.
- Safari on macOS works directly.
- **iPhone/iPad only support web push for sites added to the Home Screen** (iOS 16.4+).
  The page includes a manifest for this and shows a hint when push isn't available.

## Local tests

```bash
npm test     # in-memory store, fake push/webhook receiver; no AWS needed
```

## When to grow beyond this

At roughly 5–10k devices, or if sends start to approach the 30 s timeout: put SQS between `/events`
and delivery, and add a GSI instead of scanning for broadcasts. Optionally put CloudFront in front of
the Function URL to get free country/city headers (the code already reads them).

### Local file-based backend

For the current local visitor page, permission snapshots and the device-selection
admin page, use [backend/README.md](../backend/README.md). The frontend now calls
the same-origin `/api` endpoints served by that backend. The Lambda service above
is a separate deployment option and is not used by the local frontend.
