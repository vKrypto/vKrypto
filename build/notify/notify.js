import { ensureWorkerVersion } from "./version.js";
import { api, deviceStatus, controlState } from "./client.js";
const POLICY_VERSION = "2026-11-07";

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const enableBtn = $("enable");
const disableBtn = $("disable");
const shareLocation = $("share-location");
enableBtn.disabled = true;

const setStatus = (text, kind = "") => {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
};

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function getLocation() {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(null),  // denied or unavailable: carry on without it
      { timeout: 10000, maximumAge: 600000 },
    );
  });
}

let enabling;
let deregistered = false;
let paused = false;
export function enableNotifications(options = {}) {
  if (!enabling) enabling = enable(options).finally(() => { enabling = undefined; });
  return enabling;
}
async function enable({ includeLocation = shareLocation.checked } = {}) {
  enableBtn.disabled = true;
  try {
    if (deregistered) throw Error('This device has been permanently deregistered.');
    if (paused) throw Error('Collection is paused. Wait for a Resume command before requesting permissions.');
    setStatus("Asking for permission…");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus(permission === 'denied'
        ? "Notifications are blocked. Allow them in your browser's site settings, then submit again."
        : 'The notification request was dismissed. Submit again and choose Allow to subscribe.', "error");
      return false;
    }

    if ((await controlState()).mode === 'deregistered') throw Error('This device has been permanently deregistered.');
    const reg = await navigator.serviceWorker.getRegistration("./") || await navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" });
    await navigator.serviceWorker.ready;

    const { publicKey } = await api("/vapid-public-key");
    const key = urlBase64ToUint8Array(publicKey);
    let subscription = await reg.pushManager.getSubscription();
    const oldKey = subscription?.options?.applicationServerKey;
    if (oldKey && String(new Uint8Array(oldKey)) !== String(key)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

    if ((await controlState()).mode === 'deregistered') {
      await subscription.unsubscribe();
      await reg.unregister();
      throw Error('This device has been permanently deregistered.');
    }
    const wantsLocation = includeLocation && (await controlState()).mode === 'active';
    const geo = wantsLocation ? await getLocation() : null;

    setStatus("Registering this device…");
    await api("/devices", {
      subscription: subscription.toJSON(),
      controlVersion: (await controlState()).version,
      geo,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      consent: { notifications: true, location: Boolean(geo), policyVersion: POLICY_VERSION },
    });
    setStatus("You're subscribed. You'll get notifications on this device.", "ok");
    render(true);
    return true;
  } catch (err) {
    console.error(err);
    setStatus(`Could not enable push notifications: ${err.message}`, "error");
    return false;
  } finally {
    enableBtn.disabled = deregistered || paused;
  }
}

async function disable() {
  disableBtn.disabled = true;
  try {
    const reg = await navigator.serviceWorker.getRegistration("./");
    const sub = await reg?.pushManager.getSubscription();
    window.dispatchEvent(new Event("notify-unsubscribed"));
    try { await api("/devices/unsubscribe", {}); }
    catch (error) { if (error.status !== 401) throw error; }
    if (sub) await sub.unsubscribe();
    setStatus("Unsubscribed. This device won't get notifications.");
    render(false);
  } catch (err) {
    setStatus(`Could not unsubscribe: ${err.message}`, "error");
  } finally {
    disableBtn.disabled = false;
  }
}

function render(subscribed) {
  NotifyState.update(state => state.mode === 'deregistered' ? state : { ...state, registration: subscribed ? 'registered' : 'unregistered' }).catch(console.error);
  enableBtn.hidden = subscribed;
  shareLocation.closest("label").hidden = subscribed;
  disableBtn.hidden = !subscribed;
}

function showDeregistered() {
  deregistered = true;
  enableBtn.disabled = true;
  disableBtn.hidden = true;
  setStatus('This device has been permanently deregistered. Collection and push are disabled.');
}
window.addEventListener('notify-control', event => {
  if (event.detail.mode === 'deregistered') showDeregistered();
  paused = event.detail.mode === 'paused';
  if (!deregistered) enableBtn.disabled = paused;
});
async function init() {
  try { await ensureWorkerVersion(); } catch (error) { setStatus(error.message, 'error'); return; }
  const state = await controlState();
  if (state.mode === 'deregistered') { showDeregistered(); return; }
  paused = state.mode === 'paused';
  enableBtn.disabled = paused;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    setStatus(
      "This browser doesn't support web notifications. On iPhone/iPad, add this site to your Home Screen first, then open it from there.",
      "error",
    );
    enableBtn.disabled = true;
    return;
  }
  try {
    await api('/health');
    const reg = await navigator.serviceWorker.getRegistration('./');
    if (reg) await reg.update().catch(() => {});
    const sub = await reg?.pushManager.getSubscription();
    const device = await deviceStatus();
    const subscribed = Boolean(sub) && Notification.permission === 'granted' && device?.pushEnabled && device.endpoint === sub.endpoint;
    render(subscribed);
    if (subscribed) setStatus("You're subscribed and synced with the backend.", 'ok');
    else setStatus('Backend connected. Enable notifications to sync this device.', 'ok');
  } catch (error) {
    render(false);
    setStatus(error.message, 'error');
  }
}

shareLocation.addEventListener('change', () => NotifyState.preferences({ shareSubscriptionLocation: shareLocation.checked }));
controlState().then(state => { if (typeof state.shareSubscriptionLocation === 'boolean') shareLocation.checked = state.shareSubscriptionLocation; });
enableBtn.addEventListener("click", () => enableNotifications());
disableBtn.addEventListener("click", disable);
init();
