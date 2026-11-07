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
  for (let i = 0; i < 100; i++) {
    try { if (await fn()) return; } catch (error) { if (!/Execution context was destroyed|Cannot find context/.test(error.message)) throw error; }
    await sleep(100);
  }
  throw Error(message);
}
async function listen(server) {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) { if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } }

for (const separate of [false, true, 'detect']) test(`browser integration: ${separate === 'detect' ? 'automatic local discovery' : separate ? 'separate frontend/API origins' : 'same origin'}`, { timeout: 60000 }, async () => {
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
    let deploymentVersion;
    const originalWorker = await readFile(resolve(here, '../../build/notify/sw.js'), 'utf8');
    function deploymentAsset(req, res) {
      const path = new URL(req.url, 'http://local').pathname;
      if (!deploymentVersion || !['/notify/sw.js', '/notify/version.json'].includes(path)) return false;
      res.setHeader('cache-control', 'no-store');
      res.setHeader('content-type', path.endsWith('.json') ? 'application/json' : 'text/javascript');
      res.end(path.endsWith('.json') ? JSON.stringify({ version: deploymentVersion }) : originalWorker.replace(/^const SW_VERSION = .*;/, `const SW_VERSION = ${JSON.stringify(deploymentVersion)};`));
      return true;
    }
    let preflights = 0;
    backend = http.createServer((req, res) => { if (deploymentAsset(req, res)) return; if (req.method === 'OPTIONS') preflights++; app.handler(req, res); });
    let apiOrigin;
    if (separate === 'detect') {
      await new Promise(r => backend.listen(8980, '127.0.0.1', r));
      apiOrigin = 'http://localhost:8980';
    } else apiOrigin = await listen(backend);
    visitorOrigin = apiOrigin;
    if (separate) {
      frontend = http.createServer(async (req, res) => {
        if (deploymentAsset(req, res)) return;
        if (new URL(req.url, 'http://local').pathname === '/notify/config.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ apiBaseUrl: separate === 'detect' ? '' : apiOrigin + '/api' })); }
        const match = /^\/notify\/(index\.html|notify\.js|permissions\.js|client\.js|sw\.js|manifest\.json|state\.js|version\.js|version\.json)?$/.exec(new URL(req.url, 'http://local').pathname);
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
      window.setTimeout = (fn, ms, ...args) => ms === 60000 ? originalTimeout(() => { window.schedulerTicks = (window.schedulerTicks || 0) + 1; fn(...args); }, 200) : originalTimeout(fn, ms, ...args);
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
    await page.locator('#permissions input').evaluateAll(inputs => inputs.forEach(i => { i.checked = ['notifications', 'browser', 'network'].includes(i.name); }));
    await page.locator('#permissions button[type=submit]').click();
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
    await page.locator('#stop-logging').click();
    await page.locator('#permissions input').evaluateAll(inputs => inputs.forEach(i => { i.checked = i.name === 'browser' || i.name === 'network'; }));
    await page.locator('#permissions button[type=submit]').click();
    await until(() => app.store.read().logs.length >= 2, 'repeated snapshots reaching backend');
    assert(app.store.read().logs.every(l => l.deviceId === firstId && l.snapshot.browser && l.snapshot.network && !l.snapshot.location), JSON.stringify({ firstId, logs: app.store.read().logs }));
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
    // Control commands travel through the same admin API and real worker.
    await page.locator('#permissions button[type=submit]').click();
    await until(() => app.store.read().logs.length > count, 'logger restarted for pause test');
    async function command(type, id = firstId) {
      await admin.locator('#message-type').selectOption(type);
      for (const field of ['title', 'body', 'url']) assert.equal(await admin.locator('#' + field).isEnabled(), true);
      await admin.locator('#title').fill(`Custom ${type} title`);
      await admin.locator('#body').fill(`Custom ${type} description`);
      await admin.locator(`#devices input[value="${id}"]`).check();
      const previous = sent.length;
      await admin.locator('#send button').click();
      await until(() => sent.length > previous, `${type} push sent`);
      await until(async () => (await admin.locator('#status').innerText()).includes('1 accepted') && !await admin.locator('#send button').isDisabled(), `${type} push accepted`);
    }
    await command('pause');
    await until(async () => (await page.evaluate(() => NotifyState.read())).mode === 'paused', 'worker persisted pause');
    await until(async () => page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration('./')).getNotifications()).some(n => n.title === 'Custom pause title' && n.body === 'Custom pause description')), 'control notification uses custom wording');
    await until(() => app.store.read().devices[0].mode === 'paused', 'backend persisted pause');
    await sleep(300);
    const pausedLogs = app.store.read().logs.length, pausedConsole = consoleSnapshots.length;
    const ticks = await page.evaluate(() => window.schedulerTicks || 0);
    await sleep(1200);
    assert.equal(app.store.read().logs.length, pausedLogs);
    assert.equal(consoleSnapshots.length, pausedConsole, 'no console snapshots while paused');
    assert((await page.evaluate(() => window.schedulerTicks)) > ticks, 'scheduler still ticks while paused');
    const beforeUpgrade = await page.evaluate(() => JSON.parse(localStorage.getItem('notify-preferences-v1')));
    assert.equal(beforeUpgrade.mode, 'paused');
    assert.equal(beforeUpgrade.registration, 'registered');
    assert.equal(beforeUpgrade.sharing.browser, true);
    const previousEndpoint = app.store.read().devices.find(d => d.id === firstId).subscription.endpoint;
    deploymentVersion = 'e2e-deployment-2';
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await page.reload();
    try {
    await until(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('notify-preferences-v1')))).swVersion === deploymentVersion && (await page.locator('#collection-status').innerText()).includes('Paused remotely'), 'worker upgrade and paused collector restored');
    } catch (error) { console.log('UPGRADE DEBUG', await page.locator('body').innerText(), await page.evaluate(() => localStorage.getItem('notify-preferences-v1')), errors); throw error; }
    await until(() => app.store.read().devices.find(d => d.id === firstId).subscription.endpoint !== previousEndpoint, 'replacement subscription synced to backend');
    await sleep(1000);
    assert.equal(navigations, 2, 'one requested navigation and exactly one upgrade reload');
    const upgraded = await page.evaluate(() => JSON.parse(localStorage.getItem('notify-preferences-v1')));
    assert.equal(upgraded.mode, 'paused');
    assert.deepEqual(upgraded.sharing, beforeUpgrade.sharing);
    assert.equal(upgraded.loggingEnabled, true);
    assert.equal(app.store.read().logs.length, pausedLogs, 'upgrade does not collect while paused');
    const observer = await context.newPage();
    await observer.goto(visitorOrigin + '/notify/');
    await until(async () => (await observer.locator('#collection-status').innerText()).includes('Paused remotely'), 'pause persists in a fresh page');
    await observer.close();
    await command('resume');
    await until(() => app.store.read().logs.length > pausedLogs, 'resume continues uploads');
    const resumedState = await page.evaluate(() => NotifyState.read());
    await pushClient.send('ServiceWorker.deliverPushMessage', { origin: visitorOrigin, registrationId, data: JSON.stringify({ type: 'pause', version: resumedState.version - 1 }) });
    await sleep(300);
    assert.equal((await page.evaluate(() => NotifyState.read())).mode, 'active', 'stale control push ignored');
    await page.locator('#stop-logging').click();
    // A database reset invalidates the token: the client renews it on upload,
    // then offers to re-sync push rather than showing a false subscribed state.
    await app.store.update(db => { db.devices = []; db.logs = []; db.deliveries = []; });
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
    if (await page.locator('#stop-logging').isEnabled()) await page.locator('#stop-logging').click();
    await page.locator('#permissions input').evaluateAll(inputs => inputs.forEach(i => { i.checked = i.name === 'browser' || i.name === 'network'; }));
    await page.locator('#permissions button[type=submit]').click();
    await until(() => app.store.read().logs.length > 0, 'logging active before unsubscribe');
    await page.locator('#disable').click();
    await until(async () => (await page.locator('#status').innerText()).includes('Unsubscribed'), 'unsubscribe');
    await sleep(1200);
    assert.equal(app.store.read().devices.length, 0, JSON.stringify(app.store.read().devices.map(({ id, subscription, selected }) => ({ id, push: !!subscription, selected })))); assert.equal(app.store.read().logs.length, 0);
    // Deregistration is terminal: delete records, stop scheduler, remove worker,
    // forget credentials, and remain inactive after the next page load.
    await page.locator('#permissions input').evaluateAll(inputs => inputs.forEach(i => { i.checked = ['notifications', 'browser'].includes(i.name); }));
    await page.locator('#permissions button[type=submit]').click();
    await until(() => app.store.read().devices.some(d => d.subscription) && app.store.read().logs.length > 0, 'new subscription before deregister');
    const finalId = app.store.read().devices[0].id;
    await admin.locator('#load').click();
    await until(async () => await admin.locator(`#devices input[value="${finalId}"]`).count() === 1, 'final device loaded');
    await command('deregister', finalId);
    await until(async () => (await page.locator('#collection-status').innerText()).includes('Permanently deregistered'), 'open page stops after deregister');
    await until(() => app.store.read().devices.length === 0, 'backend device deleted');
    assert.equal(app.store.read().logs.length, 0);
    assert.equal(app.store.read().deliveries.length, 0);
    await until(async () => await page.evaluate(async () => !(await navigator.serviceWorker.getRegistration('./'))), 'worker unregistered');
    assert.equal((await page.evaluate(() => NotifyState.read())).credential, undefined);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('notify-device-session'))), false);
    let apiCalls = 0;
    page.on('request', request => { if (request.url().includes('/api/')) apiCalls++; });
    await page.reload();
    await until(async () => (await page.locator('#collection-status').innerText()).includes('Permanently deregistered'), 'terminal state survives reload');
    await sleep(1000);
    assert.equal(apiCalls, 0, 'no API requests after deregister/reload');
    assert.equal(await page.locator('#enable').isDisabled(), true);
    assert.equal(app.store.read().devices.length, 0);
    if (separate) assert(preflights > 0, 'browser exercised CORS preflights');
    assert.deepEqual(errors, []);
    console.log(`PASS ${separate ? 'cross-origin' : 'same-origin'}: registration, reload sync, JSON logs, periodic uploads, Stop, admin list/logs, targeted push, worker notification, persistence, pause/resume, scheduler continuity, stale-command rejection, stale-token recovery, unsubscribe, permanent deregistration, version replacement, localStorage restoration, single upgrade reload`);
  } finally {
    await browser?.close(); await close(frontend); await close(backend); await rm(dir, { recursive: true, force: true });
  }
});
