import { lookup } from "node:dns/promises";
import net from "node:net";

// Browser push services. Only endpoints on these hosts are accepted, so a caller
// can't register an arbitrary URL and make this Lambda POST to it (SSRF).
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",            // Chrome, Edge (Chromium), Android
  "push.services.mozilla.com",     // Firefox
  "notify.windows.com",            // legacy Edge / Windows
  "push.apple.com",                // Safari (macOS / iOS 16.4+)
];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const hostMatches = (host, suffix) => host === suffix || host.endsWith("." + suffix);

export function validateSubscription(sub) {
  if (!sub || typeof sub !== "object") throw new HttpError(400, "subscription is required");
  const { endpoint, keys } = sub;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new HttpError(400, "subscription.endpoint is not a valid URL");
  }
  if (url.protocol !== "https:") throw new HttpError(400, "subscription.endpoint must be https");
  if (!PUSH_HOST_SUFFIXES.some((s) => hostMatches(url.hostname, s))) {
    throw new HttpError(400, "subscription.endpoint is not a known push service");
  }
  if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
    throw new HttpError(400, "subscription.keys.p256dh and keys.auth are required");
  }
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export function validateGeo(geo) {
  if (geo == null) return undefined;
  const lat = Number(geo.lat);
  const lon = Number(geo.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new HttpError(400, "geo.lat / geo.lon are invalid");
  }
  const accuracy = Number.isFinite(Number(geo.accuracy)) ? Number(geo.accuracy) : undefined;
  return { lat, lon, accuracy };
}

export function validateUserId(userId) {
  if (typeof userId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(userId)) {
    throw new HttpError(400, "userId must be 1-64 chars of letters, digits, _ or -");
  }
  return userId;
}

export function validateEventName(name) {
  if (typeof name !== "string" || !/^[a-z0-9_.*-]{1,64}$/.test(name)) {
    throw new HttpError(400, "event names must be 1-64 chars of a-z, 0-9, _ . - (or *)");
  }
  return name;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

// Webhook targets must be public https URLs. The DNS is checked again at send time.
export async function assertPublicHttpsUrl(raw, resolve = lookup) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "url is not valid");
  }
  if (url.protocol !== "https:") throw new HttpError(400, "webhook url must be https");
  const addrs = await resolve(url.hostname, { all: true }).catch(() => {
    throw new HttpError(400, "webhook host does not resolve");
  });
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new HttpError(400, "webhook url resolves to a private address");
  }
  return url.toString();
}
