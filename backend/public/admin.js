const $ = id => document.getElementById(id);
async function api(path, body) {
  const res = await fetch('/api/admin/' + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json(); if (!res.ok) throw Error(data.error); return data;
}
async function load() {
  const devices = await api('devices'); $('devices').replaceChildren();
  for (const d of devices) {
    const row = document.createElement('tr');
    const cell = () => { const td = document.createElement('td'); row.append(td); return td; };
    const check = document.createElement('input'); check.type = 'checkbox'; check.value = d.id; check.disabled = !d.pushEnabled; cell().append(check);
    cell().textContent = `${d.id.slice(0, 8)} · ${d.language || 'unknown language'}`;
    cell().textContent = new Date(d.lastSeen).toLocaleString(); cell().textContent = d.pushEnabled ? `Enabled · ${d.mode || 'active'}` : 'Not subscribed';
    const logs = document.createElement('button'); logs.textContent = 'View logs'; logs.onclick = () => run(async () => { $('output').textContent = JSON.stringify(await api('logs?deviceId=' + encodeURIComponent(d.id)), null, 2); }); cell().append(logs);
    $('devices').append(row);
  }
  $('status').textContent = `${devices.length} device(s) loaded.`;
}
async function run(fn) { try { await fn(); } catch (e) { $('status').textContent = e.message; } }
$('load').onclick = () => run(load);
$('send').onsubmit = event => {
  event.preventDefault();
  run(async () => {
    const button = $('send').querySelector('button'); button.disabled = true;
    try {
      const deviceIds = [...$('devices').querySelectorAll('input:checked')].map(i => i.value);
      if (!deviceIds.length) throw Error('Select at least one push-enabled device.');
      const result = await api('send', { deviceIds, type: $('message-type').value, title: $('title').value, body: $('body').value, url: $('url').value });
      $('output').textContent = JSON.stringify(result, null, 2); await load();
      $('status').textContent = `${result.results.filter(r => r.ok).length} accepted by push service; ${result.results.filter(r => !r.ok).length} failed.`;
    } finally { button.disabled = false; }
  });
};

run(load);

$('message-type').onchange = () => {
  const notification = $('message-type').value === 'notification';
  $('title').required = notification;
  for (const id of ['title', 'body', 'url']) $(id).disabled = false;
};
