import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../src/app.mjs";
import { signWebhook } from "../src/delivery.mjs";
import { assertPublicHttpsUrl } from "../src/validate.mjs";

const ADMIN = "a".repeat(40);

function memoryStore() {
  const devices = new Map();
  const hooks = new Map();
  const logs = [];
  return {
    devices, hooks, logs,
    putDevice: async (d) => void devices.set(`${d.userId}/${d.deviceId}`, d),
    deleteDevice: async (u, id) => void devices.delete(`${u}/${id}`),
    devicesForUser: async (u) => [...devices.values()].filter((d) => d.userId === u),
    allDevices: async () => [...devices.values()],
    putWebhook: async (h) => void hooks.set(h.id, h),
    deleteWebhook: async (id) => void hooks.delete(id),
    listWebhooks: async () => [...hooks.values()],
    putLog: async (e) => void logs.push(e),
    listLogs: async () => logs,
  };
}

function setup({ pushImpl, fetchImpl } = {}) {
  const store = memoryStore();
  const pushed = [];
  const app = createApp({
    store,
    sendPush: pushImpl ?? (async (sub, payload) => void pushed.push({ sub, payload })),
    config: { adminApiKey: ADMIN, vapidPublicKey: "PUBKEY" },
    fetchImpl,
    checkUrl: async (u) => u,
    resolve: async () => [{ address: "93.184.216.34" }],
  });
  return { app, store, pushed };
}

const req = (method, path, body, headers = {}) => ({
  rawPath: path,
  headers,
  body: body === undefined ? undefined : JSON.stringify(body),
  requestContext: { http: { method, sourceIp: "203.0.113.7", userAgent: "TestUA/1.0" } },
});
const admin = { "x-api-key": ADMIN };
const sub = (n = 1) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
  keys: { p256dh: "p256", auth: "auth" },
});
const parse = (res) => ({ status: res.statusCode, body: JSON.parse(res.body) });

test("serves the VAPID public key", async () => {
  const { app } = setup();
  assert.deepEqual(parse(await app(req("GET", "/vapid-public-key"))), { status: 200, body: { publicKey: "PUBKEY" } });
});

test("registers a device with IP, user agent and consented geo", async () => {
  const { app, store } = setup();
  const res = parse(await app(req("POST", "/devices", {
    userId: "u1", subscription: sub(), consent: { notifications: true, location: true },
    geo: { lat: 28.6, lon: 77.2, accuracy: 30 },
  })));
  assert.equal(res.status, 201);
  const [d] = store.devices.values();
  assert.equal(d.ip, "203.0.113.7");
  assert.equal(d.userAgent, "TestUA/1.0");
  assert.deepEqual(d.geo, { lat: 28.6, lon: 77.2, accuracy: 30 });
});

test("drops geo when location consent is not given", async () => {
  const { app, store } = setup();
  await app(req("POST", "/devices", {
    userId: "u1", subscription: sub(), consent: { notifications: true }, geo: { lat: 1, lon: 1 },
  }));
  assert.equal([...store.devices.values()][0].geo, undefined);
});

test("rejects endpoints that are not browser push services", async () => {
  const { app } = setup();
  const res = parse(await app(req("POST", "/devices", {
    userId: "u1",
    subscription: { endpoint: "https://evil.example/hook", keys: { p256dh: "x", auth: "y" } },
    consent: { notifications: true },
  })));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /push service/);
});

test("rejects endpoint hosts that only look like push services", async () => {
  const { app } = setup();
  const res = await app(req("POST", "/devices", {
    userId: "u1",
    subscription: { endpoint: "https://fcm.googleapis.com.evil.example/x", keys: { p256dh: "x", auth: "y" } },
    consent: { notifications: true },
  }));
  assert.equal(res.statusCode, 400);
});

test("admin routes require the API key", async () => {
  const { app } = setup();
  assert.equal((await app(req("POST", "/events", { broadcast: true }))).statusCode, 401);
  assert.equal((await app(req("POST", "/events", {}, { "x-api-key": "wrong" }))).statusCode, 401);
});

test("sends to one user's devices and removes expired subscriptions", async () => {
  const pushed = [];
  const { app, store } = setup({
    pushImpl: async (s, payload) => {
      if (s.endpoint.endsWith("device-2")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      pushed.push(payload);
    },
  });
  for (const n of [1, 2]) {
    await app(req("POST", "/devices", { userId: "u1", subscription: sub(n), consent: { notifications: true } }));
  }
  await app(req("POST", "/devices", { userId: "u2", subscription: sub(3), consent: { notifications: true } }));

  const res = parse(await app(req("POST", "/events", {
    userId: "u1", notification: { title: "Hi", body: "Hello", url: "https://ashutoshverma.com" },
  }, admin)));

  assert.equal(res.status, 202);
  assert.deepEqual(res.body.push, { targeted: 2, sent: 1, failed: 1, removed: 1 });
  assert.equal(pushed[0].title, "Hi");
  assert.equal(store.devices.size, 2);  // device-2 deleted, device-3 untouched
  assert.equal(store.logs.length, 1);
});

test("broadcast reaches every device", async () => {
  const { app, pushed } = setup();
  for (const [u, n] of [["a", 1], ["b", 2], ["c", 3]]) {
    await app(req("POST", "/devices", { userId: u, subscription: sub(n), consent: { notifications: true } }));
  }
  const res = parse(await app(req("POST", "/events", { broadcast: true, notification: { title: "All" } }, admin)));
  assert.equal(res.body.push.sent, 3);
  assert.equal(pushed.length, 3);
});

test("webhooks: create, signed delivery to matching events only, list hides secret", async () => {
  const received = [];
  const { app } = setup({
    fetchImpl: async (url, init) => {
      received.push({ url, init });
      return { status: 200 };
    },
  });
  const created = parse(await app(req("POST", "/webhooks", {
    url: "https://receiver.example/hook", events: ["order.shipped"],
  }, admin)));
  assert.equal(created.status, 201);
  assert.match(created.body.secret, /^whsec_/);

  await app(req("POST", "/events", { name: "user.signup", data: { a: 1 } }, admin));
  assert.equal(received.length, 0);

  const res = parse(await app(req("POST", "/events", { name: "order.shipped", data: { orderId: 42 } }, admin)));
  assert.equal(received.length, 1);
  assert.deepEqual(res.body.webhooks.map((w) => w.ok), [true]);

  // Verify the signature the way a receiver would.
  const { init } = received[0];
  const [, t, v1] = init.headers["x-webhook-signature"].match(/^t=(\d+),v1=([0-9a-f]+)$/);
  const expected = crypto.createHmac("sha256", created.body.secret).update(`${t}.${init.body}`).digest("hex");
  assert.equal(v1, expected);
  assert.equal(JSON.parse(init.body).data.orderId, 42);

  const list = parse(await app(req("GET", "/webhooks", undefined, admin)));
  assert.equal(list.body[0].secret, undefined);
});

test("webhook delivery retries 5xx then reports failure", async () => {
  let calls = 0;
  const { app } = setup({ fetchImpl: async () => { calls++; return { status: 503 }; } });
  await app(req("POST", "/webhooks", { url: "https://receiver.example/hook" }, admin));
  const res = parse(await app(req("POST", "/events", { name: "x" }, admin)));
  assert.equal(calls, 3);
  assert.equal(res.body.webhooks[0].ok, false);
});

test("webhook URL must not resolve to a private address", async () => {
  await assert.rejects(
    assertPublicHttpsUrl("https://internal.example", async () => [{ address: "10.0.0.5" }]),
    /private address/,
  );
  await assert.rejects(
    assertPublicHttpsUrl("https://metadata.example", async () => [{ address: "169.254.169.254" }]),
    /private address/,
  );
  await assert.rejects(assertPublicHttpsUrl("http://plain.example", async () => []), /https/);
});

test("signWebhook is deterministic for a given timestamp", () => {
  assert.equal(signWebhook("s", "{}", 1), signWebhook("s", "{}", 1));
  assert.notEqual(signWebhook("s", "{}", 1), signWebhook("s", "{}", 2));
});

test("unknown route returns 404; bad JSON returns 400", async () => {
  const { app } = setup();
  assert.equal((await app(req("GET", "/nope"))).statusCode, 404);
  const bad = req("POST", "/devices");
  bad.body = "{not json";
  assert.equal((await app(bad)).statusCode, 400);
});
