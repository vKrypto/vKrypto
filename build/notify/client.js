let pending;
async function session() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('notify-device-session')); } catch {}
  if (saved?.token) return saved;
  if (!pending) pending = fetch('/api/session', { method: 'POST' }).then(async res => {
    if (!res.ok) throw Error('Local backend unavailable. Open this page from the backend server.');
    const data = await res.json();
    try { localStorage.setItem('notify-device-session', JSON.stringify(data)); } catch {}
    return data;
  }).catch(error => { pending = undefined; throw error; });
  return pending;
}
export async function api(path, body) {
  const identity = body ? await session() : null;
  const res = await fetch('/api' + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json', 'x-device-token': identity.token } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(data.error || `HTTP ${res.status}`);
  if (path === '/devices/unsubscribe') {
    try { localStorage.removeItem('notify-device-session'); } catch {}
    pending = undefined;
  }
  return data;
}
