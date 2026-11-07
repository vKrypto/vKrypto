import crypto from "node:crypto";
import {
  HttpError, validateSubscription, validateGeo, validateUserId, validateEventName, assertPublicHttpsUrl,
} from "./validate.mjs";
import { pushToDevices, deliverWebhook, webhookMatches } from "./delivery.mjs";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_TARGET_USERS = 500;

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const deviceIdFor = (endpoint) => crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 32);

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new HttpError(413, "body too large");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new HttpError(400, "body must be a JSON object");
  }
}

function requireAdmin(event, adminKey) {
  const given = Buffer.from(event.headers?.["x-api-key"] ?? "");
  const expected = Buffer.from(adminKey);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new HttpError(401, "invalid or missing x-api-key");
  }
}

function str(value, max, field, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw new HttpError(400, `${field} is required`);
    return undefined;
  }
  if (typeof value !== "string" || value.length > max) throw new HttpError(400, `${field} must be a string up to ${max} chars`);
  return value;
}

/**
 * deps: { store, sendPush, config: { adminApiKey, vapidPublicKey }, fetchImpl?, checkUrl? }
 */
export function createApp(deps) {
  const { store, sendPush, config } = deps;
  const webhookOpts = { fetchImpl: deps.fetchImpl, checkUrl: deps.checkUrl ?? assertPublicHttpsUrl };

  // ---- public routes (called from the GitHub Pages site) -------------------

  async function registerDevice(event) {
    const body = parseBody(event);
    const userId = validateUserId(body.userId);
    const subscription = validateSubscription(body.subscription);
    if (body.consent?.notifications !== true) throw new HttpError(400, "consent.notifications must be true");
    const geo = body.consent?.location === true ? validateGeo(body.geo) : undefined;
    const h = event.headers ?? {};
    const now = new Date().toISOString();
    const device = {
      userId,
      deviceId: deviceIdFor(subscription.endpoint),
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      ip: event.requestContext?.http?.sourceIp,
      userAgent: str(event.requestContext?.http?.userAgent ?? h["user-agent"], 512, "userAgent"),
      language: str(body.language, 35, "language"),
      timezone: str(body.timezone, 64, "timezone"),
      // Present only if CloudFront sits in front of the Function URL.
      country: h["cloudfront-viewer-country"],
      city: h["cloudfront-viewer-city"],
      geo,
      consent: {
        notifications: true,
        location: body.consent?.location === true,
        policyVersion: str(body.consent?.policyVersion, 32, "consent.policyVersion"),
        at: now,
      },
      updatedAt: now,
    };
    await store.putDevice(device);
    return json(201, { deviceId: device.deviceId, userId });
  }

  async function unregisterDevice(event) {
    const body = parseBody(event);
    const userId = validateUserId(body.userId);
    const endpoint = str(body.endpoint, 2048, "endpoint", { required: true });
    // Knowing the exact endpoint URL is proof of owning the subscription.
    await store.deleteDevice(userId, deviceIdFor(endpoint));
    return json(200, { ok: true });
  }

  // ---- admin routes (x-api-key) --------------------------------------------

  async function sendEvent(event) {
    const body = parseBody(event);
    const name = validateEventName(body.name ?? "notification");
    const n = body.notification;
    if (n != null && typeof n !== "object") throw new HttpError(400, "notification must be an object");
    const notification = n && {
      title: str(n.title, 120, "notification.title", { required: true }),
      body: str(n.body, 500, "notification.body"),
      url: str(n.url, 2048, "notification.url"),
      icon: str(n.icon, 2048, "notification.icon"),
      tag: str(n.tag, 64, "notification.tag"),
    };

    let devices = [];
    if (notification) {
      if (body.broadcast === true) {
        devices = await store.allDevices();
      } else {
        const ids = body.userIds ?? (body.userId ? [body.userId] : null);
        if (!Array.isArray(ids) || ids.length === 0) {
          throw new HttpError(400, "give userId, userIds[] or broadcast: true when sending a notification");
        }
        if (ids.length > MAX_TARGET_USERS) throw new HttpError(400, `at most ${MAX_TARGET_USERS} userIds`);
        const lists = await Promise.all(ids.map((id) => store.devicesForUser(validateUserId(id))));
        devices = lists.flat();
      }
    }

    const outEvent = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      data: body.data ?? null,
      notification: notification ?? null,
    };

    const push = notification
      ? await pushToDevices(devices, { ...notification, id: outEvent.id, data: outEvent.data }, sendPush)
      : { sent: 0, failed: 0, expired: [] };
    await Promise.all(push.expired.map((d) => store.deleteDevice(d.userId, d.deviceId)));

    const hooks = (await store.listWebhooks()).filter((h) => webhookMatches(h, name));
    const hookResults = await Promise.all(
      hooks.map((h) =>
        deliverWebhook(h, outEvent, webhookOpts).catch((err) => ({ ok: false, error: err.message })),
      ),
    );
    const webhooks = hooks.map((h, i) => ({ id: h.id, ...hookResults[i] }));

    const summary = {
      eventId: outEvent.id,
      name,
      push: { targeted: devices.length, sent: push.sent, failed: push.failed, removed: push.expired.length },
      webhooks,
    };
    await store.putLog(summary);
    return json(202, summary);
  }

  async function createWebhook(event) {
    const body = parseBody(event);
    const url = await assertPublicHttpsUrl(str(body.url, 2048, "url", { required: true }), deps.resolve);
    const events = body.events ?? ["*"];
    if (!Array.isArray(events) || events.length === 0 || events.length > 50) {
      throw new HttpError(400, "events must be a non-empty array (max 50)");
    }
    events.forEach(validateEventName);
    const hook = {
      id: crypto.randomUUID(),
      url,
      events,
      secret: `whsec_${crypto.randomBytes(24).toString("hex")}`,
      createdAt: new Date().toISOString(),
    };
    await store.putWebhook(hook);
    // The secret is returned only here; store it on the receiving side.
    return json(201, hook);
  }

  async function listWebhooks() {
    const hooks = await store.listWebhooks();
    return json(200, hooks.map(({ id, url, events, createdAt }) => ({ id, url, events, createdAt })));
  }

  async function listDevices(event) {
    const userId = event.queryStringParameters?.userId;
    const items = userId ? await store.devicesForUser(validateUserId(userId)) : await store.allDevices();
    return json(200, items.map(({ pk, sk, type, keys, endpoint, ...rest }) => rest));
  }

  async function listLogs(event) {
    const day = event.queryStringParameters?.day ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, "day must be YYYY-MM-DD");
    const items = await store.listLogs(day);
    return json(200, items.map(({ pk, sk, type, ttl, ...rest }) => rest));
  }

  // ---- router ----------------------------------------------------------------

  return async function handle(event) {
    const method = event.requestContext?.http?.method ?? "GET";
    const path = (event.rawPath ?? "/").replace(/\/+$/, "") || "/";
    try {
      if (method === "GET" && path === "/health") return json(200, { ok: true });
      if (method === "GET" && path === "/vapid-public-key") return json(200, { publicKey: config.vapidPublicKey });
      if (method === "POST" && path === "/devices") return await registerDevice(event);
      if (method === "POST" && path === "/devices/unsubscribe") return await unregisterDevice(event);

      const admin = [
        ["GET", "/devices", listDevices],
        ["POST", "/events", sendEvent],
        ["GET", "/logs", listLogs],
        ["GET", "/webhooks", listWebhooks],
        ["POST", "/webhooks", createWebhook],
      ].find(([m, p]) => m === method && p === path);
      const hookDelete = method === "DELETE" && path.match(/^\/webhooks\/([0-9a-f-]{36})$/);

      if (admin || hookDelete) requireAdmin(event, config.adminApiKey);
      if (admin) return await admin[2](event);
      if (hookDelete) {
        await store.deleteWebhook(hookDelete[1]);
        return json(200, { ok: true });
      }
      return json(404, { error: "not found" });
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      console.error(err);
      return json(500, { error: "internal error" });
    }
  };
}
