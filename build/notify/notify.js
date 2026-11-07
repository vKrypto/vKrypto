// Set this to the ApiUrl output printed by `sam deploy` (no trailing slash needed).
const API_URL = "https://REPLACE-ME.lambda-url.us-east-1.on.aws";
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

function getUserId() {
  // Anonymous, stable per browser. Replace with your real user id if visitors log in.
  let id;
  try { id = localStorage.getItem("notify-user-id"); } catch {}
  if (!id) {
    id = crypto.randomUUID();
    try { localStorage.setItem("notify-user-id", id); } catch {}
  }
  return id;
}

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

async function api(path, body) {
  const res = await fetch(API_URL.replace(/\/$/, "") + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function enable() {
  enableBtn.disabled = true;
  try {
    if (API_URL.includes("REPLACE-ME")) throw new Error("Notification backend is not configured. Optional information logging below works locally.");
    setStatus("Asking for permission…");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("Notifications are blocked. You can allow them in your browser's site settings.", "error");
      return;
    }

    const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    await navigator.serviceWorker.ready;

    const { publicKey } = await api("/vapid-public-key");
    const subscription =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));

    const wantsLocation = shareLocation.checked;
    const geo = wantsLocation ? await getLocation() : null;

    setStatus("Registering this device…");
    await api("/devices", {
      userId: getUserId(),
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
    if (sub) {
      await api("/devices/unsubscribe", { userId: getUserId(), endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
    setStatus("Unsubscribed. This device won't get notifications.");
    render(false);
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
  const reg = await navigator.serviceWorker.getRegistration("./");
  const sub = await reg?.pushManager.getSubscription();
  const subscribed = Boolean(sub) && Notification.permission === "granted";
  render(subscribed);
  if (subscribed) setStatus("You're subscribed on this device.", "ok");
}

enableBtn.addEventListener("click", enable);
disableBtn.addEventListener("click", disable);
init();
