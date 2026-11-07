import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createApp } from '../server.mjs';

test('file persistence, device ownership, selected snapshots, targeted delivery and expiry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notify-backend-'));
  try {
    const sent = [];
    let expired = false;
    const app = await createApp({ dataDir: dir, allowedOrigins: ['https://example.github.io'], send: async (sub, payload) => { sent.push({ sub, payload }); if (expired) throw { statusCode: 410 }; } });
    async function call(method, path, body, headers = {}) {
      const req = Readable.from(body ? [JSON.stringify(body)] : []);
      Object.assign(req, { method, url: path, headers: { host: 'localhost:8980', ...headers } });
      let status, result;
      await app.handler(req, { setHeader() {}, writeHead(code) { status = code; }, end(raw) { result = raw ? JSON.parse(raw) : null; } });
      return { status, data: result };
    }
    assert.equal((await call('GET', '/api/admin/devices')).status, 200);
    assert.equal((await call('POST', '/api/session', null, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await call('OPTIONS', '/api/snapshots', null, { origin: 'https://example.github.io' })).status, 204);
    assert.equal((await call('GET', '/api/admin/devices', null, { origin: 'https://example.github.io' })).status, 403);
    const a = (await call('POST', '/api/session', null, { origin: 'https://example.github.io' })).data;
    const b = (await call('POST', '/api/session')).data;
    const auth = { 'x-device-token': a.token };
    const admin = {};
    assert.equal((await call('GET', '/api/device', null, auth)).data.id, a.id);
    assert.equal((await call('GET', '/api/device')).status, 401);
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: 'fake', auth: 'fake' } };
    assert.equal((await call('POST', '/api/devices', { subscription, consent: { notifications: true } }, auth)).status, 200);
    assert.equal((await call('POST', '/api/devices', { subscription: { ...subscription, endpoint: 'https://127.0.0.1/push' }, consent: { notifications: true } }, auth)).status, 400);
    assert.equal((await call('POST', '/api/snapshots', { selected: ['browser'], browser: { language: 'en' }, location: { latitude: 1 }, policyVersion: '2026-11-07' }, auth)).status, 201);
    const logs = (await call('GET', '/api/admin/logs', null, admin)).data;
    assert.equal(logs.length, 1); assert.equal(logs[0].snapshot.location, undefined);
    const devices = (await call('GET', '/api/admin/devices', null, admin)).data;
    assert.equal(devices[0].token, undefined); assert.equal(devices[0].subscription, undefined);
    assert.equal((await call('POST', '/api/admin/send', { deviceIds: [b.id], title: 'Hi' }, admin)).status, 400);
    assert.equal((await call('POST', '/api/admin/send', { deviceIds: [a.id], title: 'Hi', url: 'javascript:alert(1)' }, admin)).status, 400);
    const result = await call('POST', '/api/admin/send', { deviceIds: [a.id], title: 'Hi' }, admin);
    assert.equal(result.data.results[0].ok, true); assert.equal(sent.length, 1);
    const reopened = await createApp({ dataDir: dir });
    assert.equal(reopened.store.read().logs.length, 1);
    assert.equal(reopened.store.read().devices.length, 2);
    expired = true;
    await call('POST', '/api/admin/send', { deviceIds: [a.id], title: 'Expired' }, admin);
    assert.equal(app.store.read().devices.find(d => d.id === a.id).subscription, null);
    assert.equal((await call('POST', '/api/devices/unsubscribe', {}, { 'x-device-token': 'wrong' })).status, 401);
    await call('POST', '/api/devices/unsubscribe', {}, auth);
    assert.equal(app.store.read().logs.length, 0);
    assert.equal(app.store.read().devices.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
