import * as C from "./collectors.js";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Each toggle maps to a collector. `prompt: true` means the browser shows a
// permission dialog the first time it runs. They are requested one at a time,
// in this order, when you activate.
const SOURCES = [
  { id: "device", label: "Device & browser (model, OS, CPU, RAM)", prompt: false },
  { id: "screen", label: "Screen & window size", prompt: false },
  { id: "network", label: "Network type & speed", prompt: false },
  { id: "battery", label: "Battery level & charging", prompt: false },
  { id: "geo", label: "Real location (GPS, continuous)", prompt: true },
  { id: "notify", label: "Notifications permission", prompt: true },
  { id: "camera", label: "Camera snapshot", prompt: true },
  { id: "mic", label: "Microphone level", prompt: true },
  { id: "motion", label: "Motion & orientation sensors", prompt: true },
  { id: "clipboard", label: "Clipboard text", prompt: true },
  { id: "idle", label: "Idle / screen-lock state", prompt: true },
];

const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  $("log").textContent = line + "\n" + $("log").textContent;
};

const live = {};          // continuously-updated values (location, motion, idle)
let swReg = null;
let timer = null;
let active = false;

function buildToggles() {
  $("sources").innerHTML = SOURCES.map((s) => `
    <label class="src">
      <input type="checkbox" data-src="${s.id}" checked>
      <span>${s.label}${s.prompt ? ' <em>(asks permission)</em>' : ""}</span>
    </label>`).join("");
}

const selected = () =>
  [...document.querySelectorAll("[data-src]")].filter((c) => c.checked).map((c) => c.dataset.src);

// Runs the one-time permission requests, one after another.
async function requestPermissions(ids) {
  for (const id of ids) {
    try {
      if (id === "geo") {
        log("Requesting location…");
        live.geoMeta = await C.startGeolocation((fix) => { live.location = fix; });
        if (live.geoMeta.first) live.location = live.geoMeta.first;
        log(live.geoMeta.granted ? "Location granted." : `Location: ${live.geoMeta.error || "unavailable"}`);
      } else if (id === "notify") {
        log("Requesting notifications…");
        live.notify = await C.requestNotifications();
        log(`Notifications: ${live.notify.permission ?? "unsupported"}`);
      } else if (id === "camera") {
        log("Requesting camera…");
        live.camera = await C.captureCameraFrame();
        log(live.camera.granted ? "Camera snapshot captured." : "Camera unavailable.");
        if (live.camera.jpeg) $("snapshot").src = live.camera.jpeg;
      } else if (id === "mic") {
        log("Requesting microphone…");
        live.mic = await C.sampleMicLevel();
        log(live.mic.granted ? `Mic level sampled (${live.mic.peakLevel}%).` : "Mic unavailable.");
      } else if (id === "motion") {
        log("Requesting motion sensors…");
        live.motionMeta = await C.startMotion((m) => { live.motion = m; });
        log(`Motion: ${live.motionMeta.granted ? "on" : (live.motionMeta.permission || "unsupported")}`);
      } else if (id === "clipboard") {
        log("Requesting clipboard…");
        live.clipboard = await C.readClipboard();
        log(live.clipboard.granted ? "Clipboard read." : "Clipboard unavailable.");
      } else if (id === "idle") {
        log("Requesting idle detection…");
        live.idleMeta = await C.startIdleDetection();
        log(`Idle detection: ${live.idleMeta.granted ? "on" : (live.idleMeta.permission || "unsupported")}`);
      }
    } catch (e) {
      log(`${id}: ${e.message}`);
      live[id] = C.asError(e);
    }
  }
}

// Gathers one full snapshot (called immediately and then every 5 min).
async function collectSnapshot(ids) {
  const snap = { at: new Date().toISOString(), sources: {} };
  const s = snap.sources;
  try {
    if (ids.includes("device")) s.device = C.collectDeviceInfo();
    if (ids.includes("screen")) s.screen = C.collectScreen();
    if (ids.includes("network")) s.network = C.collectNetwork();
    if (ids.includes("battery")) s.battery = await C.collectBattery().catch(C.asError);
    if (ids.includes("geo")) s.location = live.location ?? { pending: true };
    if (ids.includes("notify")) s.notifications = live.notify;
    if (ids.includes("camera")) s.camera = live.camera && { ...live.camera, jpeg: live.camera.jpeg ? "[captured]" : undefined };
    if (ids.includes("mic")) s.mic = live.mic;
    if (ids.includes("motion")) s.motion = live.motion ?? live.motionMeta;
    if (ids.includes("clipboard")) s.clipboard = live.clipboard;
    if (ids.includes("idle")) s.idle = live.idleMeta?.live ?? live.idleMeta;
  } catch (e) {
    snap.error = e.message;
  }
  return snap;
}

function sendToServiceWorker(snapshot) {
  // NOTE: not sent to any server in this build — only handed to the local service worker.
  navigator.serviceWorker?.controller?.postMessage({ type: "emergency-snapshot", snapshot });
}

async function cycle(ids) {
  const snap = await collectSnapshot(ids);
  $("output").textContent = JSON.stringify(snap, null, 2);
  sendToServiceWorker(snap);
  log(`Snapshot collected (${Object.keys(snap.sources).length} sources) → sent to service worker.`);
}

async function activate() {
  if (active) return;
  const ids = selected();
  if (!ids.length) return log("Select at least one source.");
  $("activate").disabled = true;
  $("activate").textContent = "Starting…";

  try {
    swReg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    await navigator.serviceWorker.ready;
  } catch (e) {
    log(`Service worker failed: ${e.message}`);
  }

  log("Emergency sharing activating. Granting permissions one by one…");
  await requestPermissions(ids.filter((id) => SOURCES.find((s) => s.id === id)?.prompt));

  active = true;
  await cycle(ids);
  timer = setInterval(() => cycle(ids), INTERVAL_MS);

  $("activate").hidden = true;
  $("stop").hidden = false;
  $("state").textContent = "● ACTIVE — collecting every 5 minutes";
  $("state").className = "on";
  log("Active. Next snapshot in 5 minutes. Keep this page open.");
}

function stop() {
  active = false;
  clearInterval(timer);
  if (live.geoMeta?.watchId != null) navigator.geolocation.clearWatch(live.geoMeta.watchId);
  $("stop").hidden = true;
  $("activate").hidden = false;
  $("activate").disabled = false;
  $("activate").textContent = "Activate emergency sharing";
  $("state").textContent = "○ stopped";
  $("state").className = "off";
  log("Stopped. No more snapshots.");
}

buildToggles();
$("activate").addEventListener("click", activate);
$("stop").addEventListener("click", stop);
$("collect-now").addEventListener("click", () => active && cycle(selected()));
// Exposed so automated tests can trigger a no-permission snapshot.
window.__emergency = { collectSnapshot, SOURCES };
log("Ready. Review the sources below, then activate.");
