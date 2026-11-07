import { api, deviceStatus } from "./client.js";
const POLICY_VERSION = "2026-11-07";

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const enableBtn = $("enable");
const disableBtn = $("disable");
const shareLocation = $("share-location");

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

async function enable() {
  enableBtn.disabled = true;
  try {
    setStatus("Asking for permission…");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("Notifications are blocked. You can allow them in your browser's site settings.", "error");
      return;
    }

    const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
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

    const wantsLocation = shareLocation.checked;
    const geo = wantsLocation ? await getLocation() : null;

    setStatus("Registering this device…");
    await api("/devices", {
      subscription: subscription.toJSON(),
      geo,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      consent: { notifications: true, location: Boolean(geo), policyVersion: POLICY_VERSION },
    });
    setStatus("You're subscribed. You'll get notifications on this device.", "ok");
    render(true);
  } catch (err) {
    console.error(err);
    setStatus(`Something went wrong: ${err.message}`, "error");
  } finally {
    enableBtn.disabled = false;
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
  enableBtn.hidden = subscribed;
  shareLocation.closest("label").hidden = subscribed;
  disableBtn.hidden = !subscribed;
}

async function init() {
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

enableBtn.addEventListener("click", enable);
disableBtn.addEventListener("click", disable);
init();
