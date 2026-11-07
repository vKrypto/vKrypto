// Each collector returns a plain object (or throws). They are grouped by whether
// the browser shows a permission prompt. Everything is best-effort: a missing API
// or a denied permission is recorded, never fatal.

export const asError = (e) => ({ error: e?.message || String(e) });

// ---- No permission needed -------------------------------------------------

export function collectDeviceInfo() {
  const n = navigator;
  return {
    userAgent: n.userAgent,
    platform: n.userAgentData?.platform ?? n.platform,
    mobile: n.userAgentData?.mobile ?? /Mobi/i.test(n.userAgent),
    languages: n.languages ?? [n.language],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffsetMin: new Date().getTimezoneOffset(),
    deviceMemoryGB: n.deviceMemory ?? null,
    cpuCores: n.hardwareConcurrency ?? null,
    cookiesEnabled: n.cookieEnabled,
    online: n.onLine,
    referrer: document.referrer || null,
    pageUrl: location.href,
  };
}

export function collectScreen() {
  const s = window.screen;
  return {
    screen: { width: s.width, height: s.height, availWidth: s.availWidth, availHeight: s.availHeight },
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    colorDepth: s.colorDepth,
    orientation: s.orientation?.type ?? null,
  };
}

export function collectNetwork() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return { supported: false };
  return {
    supported: true,
    effectiveType: c.effectiveType,
    downlinkMbps: c.downlink,
    rttMs: c.rtt,
    saveData: c.saveData,
    type: c.type ?? null,
  };
}

export async function collectBattery() {
  if (!navigator.getBattery) return { supported: false };
  const b = await navigator.getBattery();
  return {
    supported: true,
    level: Math.round(b.level * 100),
    charging: b.charging,
    chargingTimeSec: Number.isFinite(b.chargingTime) ? b.chargingTime : null,
    dischargingTimeSec: Number.isFinite(b.dischargingTime) ? b.dischargingTime : null,
  };
}

// ---- Permission-gated (prompt on first use) -------------------------------

export function requestNotifications() {
  if (!("Notification" in window)) return Promise.resolve({ supported: false });
  return Notification.requestPermission().then((permission) => ({ supported: true, permission }));
}

// One-shot fix plus a continuous watch. onUpdate receives every later fix.
export function startGeolocation(onUpdate) {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({ supported: false, watchId: null });
    const opts = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
    const toFix = (p) => ({
      lat: p.coords.latitude,
      lon: p.coords.longitude,
      accuracyM: p.coords.accuracy,
      altitude: p.coords.altitude,
      heading: p.coords.heading,
      speed: p.coords.speed,
      at: new Date(p.timestamp).toISOString(),
    });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const watchId = navigator.geolocation.watchPosition(
          (q) => onUpdate?.(toFix(q)), () => {}, opts,
        );
        resolve({ supported: true, granted: true, watchId, first: toFix(p) });
      },
      (err) => resolve({ supported: true, granted: false, error: err.message, watchId: null }),
      opts,
    );
  });
}

// Grabs one still frame, then stops the camera so the light goes off.
export async function captureCameraFrame() {
  if (!navigator.mediaDevices?.getUserMedia) return { supported: false };
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  try {
    const track = stream.getVideoTracks()[0];
    const video = Object.assign(document.createElement("video"), { srcObject: stream, muted: true });
    await video.play();
    await new Promise((r) => (video.readyState >= 2 ? r() : (video.onloadeddata = r)));
    const canvas = Object.assign(document.createElement("canvas"), {
      width: Math.min(video.videoWidth, 640),
      height: Math.min(video.videoWidth, 640) * (video.videoHeight / video.videoWidth),
    });
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return {
      supported: true,
      granted: true,
      label: track.label,
      width: canvas.width,
      height: canvas.height,
      jpeg: canvas.toDataURL("image/jpeg", 0.5),
    };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

// Opens the mic briefly, measures loudness, then releases it.
export async function sampleMicLevel(ms = 800) {
  if (!navigator.mediaDevices?.getUserMedia) return { supported: false };
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const start = performance.now();
    let peak = 0;
    while (performance.now() - start < ms) {
      analyser.getByteTimeDomainData(buf);
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      await new Promise((r) => setTimeout(r, 50));
    }
    await ctx.close();
    return { supported: true, granted: true, label: stream.getAudioTracks()[0].label, peakLevel: Math.round((peak / 128) * 100) };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

// Motion/orientation: iOS 13+ needs an explicit permission call from a user gesture.
export async function startMotion(onUpdate) {
  const hasOrient = "DeviceOrientationEvent" in window;
  const hasMotion = "DeviceMotionEvent" in window;
  if (!hasOrient && !hasMotion) return { supported: false };
  for (const Evt of [window.DeviceOrientationEvent, window.DeviceMotionEvent]) {
    if (Evt && typeof Evt.requestPermission === "function") {
      const res = await Evt.requestPermission().catch((e) => e.message);
      if (res !== "granted") return { supported: true, granted: false, permission: res };
    }
  }
  const latest = {};
  if (hasOrient) addEventListener("deviceorientation", (e) => {
    latest.orientation = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
    onUpdate?.(latest);
  });
  if (hasMotion) addEventListener("devicemotion", (e) => {
    latest.accelerationG = e.accelerationIncludingGravity
      ? { x: e.accelerationIncludingGravity.x, y: e.accelerationIncludingGravity.y, z: e.accelerationIncludingGravity.z }
      : null;
    onUpdate?.(latest);
  });
  return { supported: true, granted: true };
}

export async function readClipboard() {
  if (!navigator.clipboard?.readText) return { supported: false };
  const text = await navigator.clipboard.readText();
  return { supported: true, granted: true, text };
}

export async function startIdleDetection() {
  if (!("IdleDetector" in window)) return { supported: false };
  const permission = await window.IdleDetector.requestPermission();
  if (permission !== "granted") return { supported: true, granted: false, permission };
  const detector = new window.IdleDetector();
  const state = {};
  detector.addEventListener("change", () => {
    state.userState = detector.userState;
    state.screenState = detector.screenState;
  });
  await detector.start({ threshold: 60000 });
  return { supported: true, granted: true, live: state };
}

// These can't run in a timed loop: each needs its own fresh user tap and a chooser.
export const GESTURE_ONLY = ["Screen capture", "Bluetooth device", "USB device", "Contacts"];
