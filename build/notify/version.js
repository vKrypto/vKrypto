import { api, controlState } from './client.js';
const scope = new URL('./', import.meta.url).href;
const workerUrl = new URL('./sw.js', import.meta.url);
let updating;
function workerVersion(worker) {
  if (!worker) return Promise.resolve(null);
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 1500);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.version); };
    worker.postMessage({ type: 'NOTIFY_VERSION' }, [channel.port2]);
  });
}
async function activated(reg) {
  const worker = reg.installing || reg.waiting || reg.active;
  if (worker?.state === 'activated') return worker;
  if (!worker) throw Error('The replacement service worker did not install.');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Service worker update timed out.')), 20000);
    const changed = () => {
      if (worker.state === 'activated') { clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve(worker); }
      if (worker.state === 'redundant') { clearTimeout(timer); worker.removeEventListener('statechange', changed); reject(Error('Service worker installation failed.')); }
    };
    worker.addEventListener('statechange', changed); changed();
  });
}
export function ensureWorkerVersion() {
  if (!updating) updating = check().finally(() => { updating = undefined; });
  return updating;
}
async function check() {
  if (!('serviceWorker' in navigator)) return;
  const state = await controlState();
  if (state.mode === 'deregistered') return;
  const old = await navigator.serviceWorker.getRegistration(scope);
  if (old && old.scope !== scope) return;
  if (!old && state.registration !== 'registered' && !state.workerUpdate) return; // Never enroll a new visitor.
  const response = await fetch(new URL('./version.json', import.meta.url), { cache: 'no-store' });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw Error('Could not load the service worker deployment version.');
  const { version } = await response.json();
  if (typeof version !== 'string' || !version) throw Error('Invalid service worker deployment version.');
  if (await workerVersion(old?.active) === version && (!state.swVersion || state.swVersion === version) && !state.workerUpdate) {
    await NotifyState.update(state => ({ ...state, swVersion: version }));
    return;
  }
  const lock = 'notify-worker-update';
  const replace = async () => {
    const latest = await navigator.serviceWorker.getRegistration(scope);
    const pending = (await controlState()).workerUpdate;
    const saved = await controlState();
    const matches = latest && await workerVersion(latest.active) === version && (!saved.swVersion || saved.swVersion === version);
    if (matches && !pending) {
      if (state.swVersion && state.swVersion !== version) reloadOnce(version);
      return;
    }
    const original = await latest?.pushManager.getSubscription();
    const needsPush = Boolean(original || pending?.needsPush || saved.registration === 'registered');
    if (needsPush) await api('/health'); // Keep the old installation if API is offline.
    window.dispatchEvent(new Event('notify-updating'));
    if ((await controlState()).mode === 'deregistered') return;
    await NotifyState.update(state => ({ ...state, workerUpdate: { version, needsPush } }));
    let reg = latest;
    if (!matches) {
      await original?.unsubscribe();
      await latest?.unregister();
      reg = await navigator.serviceWorker.register(workerUrl.href + '?v=' + encodeURIComponent(version), { scope, updateViaCache: 'none' });
    }
    const active = await activated(reg);
    if (await workerVersion(active) !== version) throw Error('The installed service worker does not match this deployment. Please retry after deployment completes.');
    if ((await controlState()).mode === 'deregistered') { await reg.unregister(); return; }
    if (needsPush && Notification.permission === 'granted') {
      const { publicKey } = await api('/vapid-public-key');
      const padded = (publicKey + '='.repeat((4 - publicKey.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
      const key = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
      const subscription = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api('/devices', { subscription: subscription.toJSON(), controlVersion: (await controlState()).version,
        consent: { notifications: true, location: false, policyVersion: '2026-11-07' } });
    }
    await NotifyState.update(({ workerUpdate, ...state }) => state.mode === 'deregistered' ? state : { ...state, swVersion: version, registration: needsPush && Notification.permission === 'granted' ? 'registered' : 'unregistered' });
    // sessionStorage prevents a failed/partially propagated deployment reload loop.
    reloadOnce(version);
  };
  if (navigator.locks) await navigator.locks.request(lock, replace);
  else await replace();
}
function reloadOnce(version) {
  const key = 'notify-reloaded-version';
  if (sessionStorage.getItem(key) !== version) { sessionStorage.setItem(key, version); location.reload(); }
}
// Shared layouts load this module on ordinary site pages as well as /notify/.
ensureWorkerVersion().catch(error => window.dispatchEvent(new CustomEvent('notify-update-error', { detail: error.message })));
