import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createApp } from '../server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, message) {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await sleep(100); }
  throw Error(message);
}
async function listen(server) {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) { if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } }

for (const separate of [false, true, 'detect']) test(`browser integration: ${separate ? 'separate frontend/API origins' : 'same origin'}`, { timeout: 60000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notify-e2e-'));
  let browser, backend, frontend;
  try {
    let pushClient, registrationId, visitorOrigin;
    const sent = [], allowedOrigins = [];
    const app = await createApp({ dataDir: dir, allowedOrigins, send: async (subscription, payload) => {
      sent.push({ subscription, payload: JSON.parse(payload) });
      // Simulate only the external push provider. Real worker handles the push
      // event and displays a real browser notification through Chrome DevTools.
      await pushClient.send('ServiceWorker.deliverPushMessage', { origin: visitorOrigin, registrationId, data: payload });
    } });
    let preflights = 0;
    backend = http.createServer((req, res) => { if (req.method === 'OPTIONS') preflights++; app.handler(req, res); });
    let apiOrigin;
    if (separate === 'detect') {
      await new Promise(r => backend.listen(8980, '127.0.0.1', r));
      apiOrigin = 'http://localhost:8980';
    } else apiOrigin = await listen(backend);
    visitorOrigin = apiOrigin;
    if (separate) {
      frontend = http.createServer(async (req, res) => {
        if (req.url === '/notify/config.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ apiBaseUrl: separate === 'detect' ? '' : apiOrigin + '/api' })); }
        const match = /^\/notify\/(index\.html|notify\.js|permissions\.js|client\.js|sw\.js|manifest\.json)?$/.exec(req.url);
        if (!match) { res.writeHead(404); return res.end(); }
        const file = match[1] || 'index.html';
        res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : 'text/html');
        res.end(await readFile(resolve(here, '../../build/notify', file)));
      });
      visitorOrigin = await listen(frontend);
      if (separate !== 'detect') allowedOrigins.push(visitorOrigin);
    }
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ permissions: ['notifications'] });
    await context.addInitScript(() => {
      const originalTimeout = window.setTimeout;
      window.setTimeout = (fn, ms, ...args) => originalTimeout(fn, ms === 60000 ? 200 : ms, ...args);
      // Chrome's remote push registration is replaced with an external-provider
      // fixture. No production code uses this fixture.
      const subscription = () => {
        const saved = JSON.parse(localStorage.getItem('test-push') || 'null');
        if (!saved) return null;
        return { endpoint: saved.endpoint, options: { applicationServerKey: Uint8Array.from(saved.key).buffer },
          toJSON: () => ({ endpoint: saved.endpoint, keys: { p256dh: 'test-public-key', auth: 'test-auth' } }),
          unsubscribe: async () => { localStorage.removeItem('test-push'); return true; } };
      };
      PushManager.prototype.getSubscription = async () => subscription();
      PushManager.prototype.subscribe = async options => {
        localStorage.setItem('test-push', JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-' + crypto.randomUUID(), key: [...options.applicationServerKey] }));
        return subscription();
      };
    });
    const page = await context.newPage();
    const errors = [], consoleSnapshots = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'info') { try { consoleSnapshots.push(JSON.parse(msg.text())); } catch {} } });
    pushClient = await context.newCDPSession(page);
    pushClient.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      for (const r of registrations) if (r.scopeURL === visitorOrigin + '/notify/' && !r.isDeleted) registrationId = r.registrationId;
    });
    await pushClient.send('ServiceWorker.enable');
    await page.goto(visitorOrigin + '/notify/');
    await until(async () => (await page.locator('#status').innerText()).includes('Backend connected'), 'backend connection indicator');
    assert.equal(await page.locator('#permissions input:not(:disabled):not(:checked)').count(), 0);
    // Reproduce a static host returning an HTML fallback for POST /api/session.
    await page.route('**/api/session', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><h1>Static fallback</h1>' }));
    await page.locator('#permissions input').evaluateAll(inputs => inputs.forEach(i => { i.checked = i.name === 'browser' || i.name === 'network'; }));
    await page.locator('#permissions button[type=submit]').click();
    await until(async () => (await page.locator('#collection-status').innerText()).includes('Backend returned HTML'), 'HTML API response is explained rather than parsed as JSON');
    assert.equal(app.store.read().devices.length, 0);
    await page.locator('#stop-logging').click();
    await page.unroute('**/api/session');
    await page.locator('#share-location').uncheck();
    await page.locator('#enable').click();
    await until(async () => (await page.locator('#status').innerText()).includes("You're subscribed"), 'push registration');
    assert.equal(app.store.read().devices.length, 1);
    assert(app.store.read().devices[0].subscription);
    const firstId = app.store.read().devices[0].id;
    if (!separate) await page.evaluate(() => {
      const key = `notify-device-session:${location.origin}/api`;
      localStorage.setItem('notify-device-session', localStorage.getItem(key));
      localStorage.removeItem(key);
    });
    // Reload reconciles with the server and migrates older stored credentials.
    await page.reload();
    await until(async () => (await page.locator('#status').innerText()).includes('synced with the backend'), 'reload subscription reconciliation');
    await page.locator('#permissions input').evaluateAll(inputs => inputs.forEach(i => { i.checked = i.name === 'browser' || i.name === 'network'; }));
    await page.locator('#permissions button[type=submit]').click();
    await until(() => app.store.read().logs.length >= 2, 'repeated snapshots reaching backend');
    assert(app.store.read().logs.every(l => l.deviceId === firstId && l.snapshot.browser && l.snapshot.network && !l.snapshot.location));
    assert(consoleSnapshots.length > 0 && consoleSnapshots.every(l => l.selected.includes('browser')));
    await page.locator('#stop-logging').click();
    await sleep(300);
    const count = app.store.read().logs.length;
    await sleep(1200);
    assert.equal(app.store.read().logs.length, count, 'Stop prevents further uploads');
    // Register another eligible recipient to prove the admin send is targeted.
    const other = await (await fetch(apiOrigin + '/api/session', { method: 'POST' })).json();
    const registration = await fetch(apiOrigin + '/api/devices', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': other.token }, body: JSON.stringify({ subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/other-device', keys: { p256dh: 'other-key', auth: 'other-auth' } }, consent: { notifications: true } }) });
    assert.equal(registration.status, 200);
    const admin = await context.newPage();
    await admin.goto(apiOrigin + '/admin/');
    assert.equal(await admin.locator('#token').count(), 0);
    await admin.locator('#load').click();
    await until(async () => await admin.locator('#devices tr').count() === 2, 'admin device list');
    await admin.locator('#devices tr').first().locator('button').click();
    await until(async () => (await admin.locator('#output').innerText()).includes('browser'), 'admin log viewer');
    await admin.locator(`#devices input[value="${firstId}"]`).check();
    await admin.locator('#title').fill('End-to-end test');
    await admin.locator('#body').fill('Frontend → backend → selected device');
    await admin.locator('#url').fill(visitorOrigin + '/notify/');
    await until(() => registrationId, 'service worker registration');
    await admin.locator('#send button').click();
    await until(async () => (await admin.locator('#status').innerText()).includes('1 accepted'), 'admin targeted push send');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].subscription.endpoint, app.store.read().devices[0].subscription.endpoint);
    await until(async () => await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration('./');
      const notifications = await reg.getNotifications();
      return notifications.some(n => n.title === 'End-to-end test' && n.body === 'Frontend → backend → selected device');
    }), 'service worker displayed notification');
    const persisted = await createApp({ dataDir: dir });
    assert.equal(persisted.store.read().logs.length, count);
    assert.equal(persisted.store.read().deliveries.length, 1);
    // A database reset invalidates the token: the client renews it on upload,
    // then offers to re-sync push rather than showing a false subscribed state.
    await app.store.update(db => { db.devices = []; db.logs = []; });
    await page.locator('#permissions button[type=submit]').click();
    await until(() => app.store.read().logs.length > 0, 'stale device-token recovery');
    assert.equal(app.store.read().devices.length, 1);
    await page.locator('#stop-logging').click();
    await page.reload();
    await until(async () => (await page.locator('#status').innerText()).includes('Backend connected'), 'missing backend subscription detected');
    assert.equal(await page.locator('#enable').isVisible(), true);
    await page.locator('#share-location').uncheck();
    await page.locator('#enable').click();
    await until(async () => (await page.locator('#status').innerText()).includes("You're subscribed"), 'push re-sync');
    await page.locator('#permissions input').evaluateAll(inputs => inputs.forEach(i => { i.checked = i.name === 'browser' || i.name === 'network'; }));
    await page.locator('#permissions button[type=submit]').click();
    await until(() => app.store.read().logs.length > 0, 'logging active before unsubscribe');
    await page.locator('#disable').click();
    await until(async () => (await page.locator('#status').innerText()).includes('Unsubscribed'), 'unsubscribe');
    await sleep(1200);
    assert.equal(app.store.read().devices.length, 0); assert.equal(app.store.read().logs.length, 0);
    if (separate) assert(preflights > 0, 'browser exercised CORS preflights');
    assert.deepEqual(errors, []);
    console.log(`PASS ${separate ? 'cross-origin' : 'same-origin'}: registration, reload sync, JSON logs, periodic uploads, Stop, admin list/logs, targeted push, worker notification, persistence, stale-token recovery, unsubscribe`);
  } finally {
    await browser?.close(); await close(frontend); await close(backend); await rm(dir, { recursive: true, force: true });
  }
});
