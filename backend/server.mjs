import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import webpush from 'web-push';
import { openStore } from './store.mjs';
import { validateSubscription, validateGeo, HttpError } from '../notification-service/src/validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fields = ['location', 'windows', 'camera', 'microphone', 'network', 'browser', 'battery'];
const fail = (status, message) => { throw new HttpError(status, message); };
const text = (v, max = 500) => typeof v === 'string' ? v.slice(0, max) : '';
export async function createApp({ dataDir = join(here, 'data'), send, adminToken } = {}) {
  const store = await openStore(dataDir);
  const configPath = join(dataDir, 'config.json');
  let config;
  try { config = JSON.parse(await readFile(configPath, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    config = { ...webpush.generateVAPIDKeys(), adminToken: randomBytes(32).toString('hex') };
    await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  }
  const token = adminToken || config.adminToken;
  const deliver = send || ((subscription, payload) => webpush.sendNotification(subscription, payload, {
    vapidDetails: { subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com', publicKey: config.publicKey, privateKey: config.privateKey }, timeout: 10000,
  }));
  function authorized(given, expected) {
    return typeof given === 'string' && Buffer.byteLength(given) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  }
  async function body(req) {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 65536) fail(413, 'Body too large'); }
    try { const b = JSON.parse(raw); if (!b || typeof b !== 'object' || Array.isArray(b)) throw Error(); return b; }
    catch { fail(400, 'Expected a JSON object'); }
  }
  function device(req) {
    const found = store.read().devices.find(d => authorized(req.headers['x-device-token'], d.token));
    if (!found) fail(401, 'Device registration required');
    return found;
  }
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://' + req.headers.host);
      const path = url.pathname;
      // No cross-origin API access; reject browser writes from other origins.
      if (req.method === 'POST' && req.headers.origin && req.headers.origin !== url.origin) fail(403, 'Cross-origin request rejected');
      if (path.startsWith('/api/admin/')) {
        if (!authorized(req.headers['x-admin-token'], token)) fail(401, 'Admin token required');
      }
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true });
      if (req.method === 'GET' && path === '/api/vapid-public-key') return json(res, 200, { publicKey: config.publicKey });
      if (req.method === 'POST' && path === '/api/session') {
        const d = { id: randomUUID(), token: randomBytes(32).toString('hex'), createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), subscription: null };
        await store.update(db => { db.devices.push(d); });
        return json(res, 201, { id: d.id, token: d.token });
      }
      if (req.method === 'POST' && path === '/api/devices') {
        const d = device(req), b = await body(req);
        const subscription = validateSubscription(b.subscription);
        const geo = validateGeo(b.geo);
        if (b.consent?.notifications !== true) fail(400, 'Notification consent required');
        await store.update(db => {
          if (db.devices.some(x => x.id !== d.id && x.subscription?.endpoint === subscription.endpoint)) fail(409, 'Subscription already registered');
          Object.assign(db.devices.find(x => x.id === d.id), { subscription, geo: geo || null, language: text(b.language, 100), timezone: text(b.timezone, 100), consent: { notifications: true, location: !!geo, policyVersion: text(b.consent.policyVersion, 50), at: new Date().toISOString() }, userAgent: text(req.headers['user-agent']), lastSeen: new Date().toISOString() });
        });
        return json(res, 200, { id: d.id });
      }
      if (req.method === 'POST' && path === '/api/devices/unsubscribe') {
        const d = device(req);
        await store.update(db => { db.devices = db.devices.filter(x => x.id !== d.id); db.logs = db.logs.filter(x => x.deviceId !== d.id); });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/snapshots') {
        const d = device(req), b = await body(req);
        if (!Array.isArray(b.selected) || !b.selected.length || b.selected.some(x => !fields.includes(x))) fail(400, 'Invalid selected capabilities');
        if (b.policyVersion !== '2026-11-07') fail(400, 'Consent policy required');
        const snapshot = { selected: [...new Set(b.selected)], errors: b.errors && typeof b.errors === 'object' ? b.errors : {} };
        for (const key of snapshot.selected) if (b[key] !== undefined) snapshot[key] = b[key];
        await store.update(db => {
          const now = new Date().toISOString();
          db.logs.push({ id: randomUUID(), deviceId: d.id, receivedAt: now, policyVersion: b.policyVersion, snapshot });
          const cutoff = Date.now() - 30 * 86400000;
          db.logs = db.logs.filter(x => Date.parse(x.receivedAt) >= cutoff).slice(-10000);
          const row = db.devices.find(x => x.id === d.id); row.lastSeen = now; row.selected = snapshot.selected;
        });
        return json(res, 201, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/admin/devices') {
        return json(res, 200, store.read().devices.map(({ token, subscription, ...d }) => ({ ...d, pushEnabled: !!subscription })));
      }
      if (req.method === 'GET' && path === '/api/admin/logs') {
        return json(res, 200, store.read().logs.filter(x => !url.searchParams.get('deviceId') || x.deviceId === url.searchParams.get('deviceId')).slice(-100));
      }
      if (req.method === 'GET' && path === '/api/admin/deliveries') return json(res, 200, store.read().deliveries.slice(-100));
      if (req.method === 'POST' && path === '/api/admin/send') {
        const b = await body(req);
        if (!Array.isArray(b.deviceIds) || !b.deviceIds.length || b.deviceIds.length > 100 || b.deviceIds.some(id => typeof id !== 'string')) fail(400, 'Select 1–100 devices');
        if (!text(b.title, 120).trim()) fail(400, 'Title required');
        const target = new URL(b.url || '/notify/', url.origin);
        if (!['https:', 'http:'].includes(target.protocol)) fail(400, 'Invalid notification URL');
        const devices = store.read().devices;
        const chosen = [...new Set(b.deviceIds)].map(id => devices.find(d => d.id === id));
        if (chosen.some(d => !d?.subscription)) fail(400, 'Every selected device must have an active push subscription');
        const payload = JSON.stringify({ title: text(b.title, 120), body: text(b.body, 1000), url: target.href });
        const results = [];
        for (const d of chosen) {
          let result = { deviceId: d.id, sentAt: new Date().toISOString(), ok: true };
          try { await deliver(d.subscription, payload); }
          catch (error) {
            result.ok = false; result.status = error.statusCode || 0; result.error = 'Push delivery failed';
            if ([404, 410].includes(error.statusCode)) await store.update(db => { const row = db.devices.find(x => x.id === d.id); if (row) row.subscription = null; });
          }
          results.push(result);
        }
        await store.update(db => { db.deliveries.push(...results); db.deliveries = db.deliveries.slice(-1000); });
        return json(res, 200, { results });
      }
      if (req.method === 'GET') {
        const staticFiles = { '/': '../build/notify/index.html', '/notify/': '../build/notify/index.html', '/admin/': 'public/index.html', '/admin/admin.js': 'public/admin.js' };
        const name = staticFiles[path] || (/^\/notify\/(notify\.js|permissions\.js|client\.js|sw\.js|manifest\.json)$/.test(path) ? '../build' + path : null);
        if (name) {
          const content = await readFile(resolve(here, name));
          const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : 'text/html';
          res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); return res.end(content);
        }
      }
      fail(404, 'Not found');
    } catch (error) { json(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' }); }
  };
  return { handler, store, adminToken: token };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  const port = Number(process.env.PORT || 8980);
  http.createServer(app.handler).listen(port, '127.0.0.1', () => {
    console.log(`Visitor page: http://localhost:${port}/notify/\nAdmin page: http://localhost:${port}/admin/\nAdmin token is stored in backend/data/config.json (adminToken).`);
  });
}
