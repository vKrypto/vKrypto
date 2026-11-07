import crypto from "node:crypto";
import webpush from "web-push";
import { assertPublicHttpsUrl } from "./validate.mjs";

export function createPushSender({ publicKey, privateKey, subject }) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return (subscription, payload) =>
    webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 24 * 3600, urgency: "normal" });
}

// Sends to every device. Returns per-device results and the devices the push service
// says are gone (404/410), so the caller can delete them.
export async function pushToDevices(devices, payload, send) {
  const results = await Promise.allSettled(
    devices.map((d) => send({ endpoint: d.endpoint, keys: d.keys }, payload)),
  );
  const expired = [];
  let sent = 0;
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent++;
    } else {
      failed++;
      const code = r.reason?.statusCode;
      if (code === 404 || code === 410) expired.push(devices[i]);
      else console.warn("push failed", devices[i].deviceId, code, r.reason?.body ?? r.reason?.message);
    }
  });
  return { sent, failed, expired };
}

// Signature header: "t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${body}`)>"
export function signWebhook(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// POSTs the event to one webhook, retrying 5xx/network errors with backoff.
// Retries are kept short so the whole Lambda call stays well inside its 30s timeout.
export async function deliverWebhook(hook, event, { fetchImpl = fetch, attempts = 3, checkUrl = assertPublicHttpsUrl } = {}) {
  await checkUrl(hook.url);  // re-check DNS in case it changed to a private IP
  const body = JSON.stringify(event);
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchImpl(hook.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
        headers: {
          "content-type": "application/json",
          "user-agent": "notification-service-webhooks/1.0",
          "x-webhook-id": event.id,
          "x-webhook-signature": signWebhook(hook.secret, body),
        },
        body,
      });
      if (res.status < 300) return { ok: true, status: res.status, attempts: i + 1 };
      lastError = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break;  // client error: retrying won't help
    } catch (err) {
      lastError = err.message;
    }
    if (i < attempts - 1) await sleep(500 * 2 ** i);
  }
  return { ok: false, error: lastError };
}

export const webhookMatches = (hook, eventName) =>
  hook.events.includes("*") || hook.events.includes(eventName);
