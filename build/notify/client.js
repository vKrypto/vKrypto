let config;
let pending;
const timeout = 15000;
async function request(url, options = {}) {
  try {
    return await fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout), cache: 'no-store' });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw Error(error.name === 'TimeoutError' ? 'Backend request timed out. Please retry.' : 'Cannot reach the backend. Check your connection and the configured API address.');
  }
}
export async function readJson(response, label = 'Backend') {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const hint = label === 'Backend'
      ? 'Open the local page at http://localhost:8980/notify/. For GitHub Pages, configure a deployed HTTPS backend in notify/config.json.'
      : 'Check that notify/config.json exists and contains valid JSON.';
    const error = Error(`${label} returned HTML or another non-JSON response (HTTP ${response.status}). ${hint}`);
    error.status = response.status;
    throw error;
  }
  try {
    const value = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch {
    throw Error(`${label} returned invalid JSON (HTTP ${response.status}).`);
  }
}
async function settings() {
  if (!config) config = (async () => {
    const response = await request(new URL('./config.json', import.meta.url));
    if (!response.ok) throw Error('Could not load notification API configuration.');
    const { apiBaseUrl = '' } = await readJson(response, 'API configuration');
    if (typeof apiBaseUrl !== 'string') throw Error('apiBaseUrl must be a string in notify/config.json.');
    let url = new URL(apiBaseUrl || '/api', location.origin);
    if (!apiBaseUrl && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      // Static/Jekyll previews have no /api routes. Prefer their same-origin
      // API when present, otherwise connect to our local backend.
      try {
        const health = await readJson(await request(new URL(url.href.replace(/\/$/, '') + '/health')));
        if (health.ok !== true) throw Error('Not the notification backend');
      } catch {
        const local = new URL('http://localhost:8980/api');
        try {
          const health = await readJson(await request(local.href + '/health'));
          if (health.ok !== true) throw Error('Not the notification backend');
          url = local;
        } catch { throw Error('Local backend is unavailable. Start it with npm start --prefix backend, then open http://localhost:8980/notify/.'); }
      }
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error('The backend API must use HTTPS (HTTP is allowed on localhost).');
    if (url.username || url.password || url.search || url.hash) throw Error('Invalid backend API address.');
    const base = url.href.replace(/\/$/, '');
    return { base, key: `notify-device-session:${base}` };
  })().catch(error => { config = undefined; throw error; });
  return config;
}
function savedIdentity(key) {
  try {
    let value = JSON.parse(localStorage.getItem(key));
    if (!value && key === `notify-device-session:${location.origin}/api`) {
      value = JSON.parse(localStorage.getItem('notify-device-session'));
      if (value?.token && value?.id) {
        localStorage.setItem(key, JSON.stringify(value));
        localStorage.removeItem('notify-device-session');
      }
    }
    if (value?.token && value?.id) return value;
  } catch {}
  return null;
}
async function clearIdentity() {
  const { key } = await settings();
  try { localStorage.removeItem(key); } catch {}
  pending = undefined;
}
async function session() {
  const { base, key } = await settings();
  const saved = savedIdentity(key);
  if (saved) return saved;
  if (!pending) pending = (async () => {
    const response = await request(base + '/session', { method: 'POST' });
    const data = await readJson(response);
    if (!response.ok) throw Error(data.error || 'Device registration failed.');
    try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
    return data;
  })().catch(error => { pending = undefined; throw error; });
  return pending;
}
export async function api(path, body, options = {}, retry = true) {
  options.signal?.throwIfAborted();
  const { base } = await settings();
  const privateRequest = Boolean(body) || path === '/device';
  const identity = privateRequest ? await session() : null;
  options.signal?.throwIfAborted();
  const response = await request(base + path, {
    signal: options.signal,
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(identity ? { 'x-device-token': identity.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await readJson(response);
  if (response.status === 401 && privateRequest) {
    await clearIdentity();
    // A deleted/reset database must not permanently strand a browser's saved token.
    if (retry && !options.signal?.aborted && path !== '/device' && path !== '/devices/unsubscribe') return api(path, body, options, false);
  }
  if (!response.ok) {
    const error = Error(data.error || `Backend returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (path === '/devices/unsubscribe') await clearIdentity();
  return data;
}
export async function deviceStatus() {
  const { key } = await settings();
  if (!savedIdentity(key) && !pending) return null;
  try { return await api('/device'); }
  catch (error) { if (error.status === 401) return null; throw error; }
}
