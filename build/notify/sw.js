const SW_VERSION = "local-1fc973ce34d93a06";
importScripts('./state.js?v=' + encodeURIComponent(SW_VERSION));
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
const commands = new Set(['pause', 'resume', 'deregister']);
const modeFor = { pause: 'paused', resume: 'active', deregister: 'deregistered' };

async function broadcast(state) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  await Promise.all(clients.filter(client => client.url.startsWith(self.registration.scope)).map(client => client.postMessage({ type: 'notify-control', mode: state.mode, version: state.version })));
}
async function handlePush(msg) {
  const type = msg.type || 'notification';
  const current = await NotifyState.read();
  if (current.mode === 'deregistered') return;
  if (commands.has(type)) {
    if (!Number.isSafeInteger(msg.version) || msg.version <= 0) return;
    let applied = false;
    let credential;
    const state = await NotifyState.update(previous => {
      if (previous.mode === 'deregistered' || msg.version <= previous.version) return previous;
      applied = true;
      credential = previous.credential;
      return type === 'deregister'
        ? { mode: 'deregistered', version: msg.version }
        : { ...previous, mode: modeFor[type], version: msg.version };
    });
    if (!applied) return;
    await broadcast(state);
    if (type === 'deregister') {
      // The backend also deletes records when accepting this command. This
      // authenticated request makes cleanup idempotent if the worker runs first.
      if (credential) await fetch(credential.base + '/devices/unsubscribe', {
        method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json', 'x-device-token': credential.token }, body: '{}',
      }).catch(() => {});
      try {
        const subscription = await self.registration.pushManager.getSubscription();
        await subscription?.unsubscribe();
      } catch {}
      const notifications = await self.registration.getNotifications();
      notifications.forEach(notification => notification.close());
      await self.registration.unregister();
    } else {
      // Web Push subscriptions require user-visible messages. Show control
      // acknowledgements rather than relying on unsupported silent pushes.
      await self.registration.showNotification(type === 'pause' ? 'Information collection paused' : 'Information collection resumed', {
        body: type === 'pause' ? 'The scheduler remains active while this page is open.' : 'Selected information will be collected on the next scheduled tick.',
        tag: 'notify-control', data: { url: self.registration.scope },
      });
    }
    return;
  }
  if (type !== 'notification') return;
  await self.registration.showNotification(msg.title || 'New notification', {
    body: msg.body || '', icon: msg.icon || '/favicon.ico', tag: msg.tag,
    data: { url: msg.url || self.registration.scope, id: msg.id },
  });
}
self.addEventListener('message', event => {
  if (event.data?.type === 'NOTIFY_VERSION') event.ports[0]?.postMessage({ version: SW_VERSION });
});
self.addEventListener('push', event => {
  let msg;
  try { msg = event.data?.json() || {}; } catch { msg = { type: 'notification', body: event.data?.text() }; }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
  event.waitUntil(handlePush(msg));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  let url;
  try { url = new URL(event.notification.data?.url || self.registration.scope, self.location.origin); } catch { return; }
  if (!['http:', 'https:'].includes(url.protocol)) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
    const existing = wins.find(win => win.url === url.href);
    return existing ? existing.focus() : self.clients.openWindow(url.href);
  }));
});
