import { ensureWorkerVersion } from "./version.js";
import { api, controlState } from "./client.js";
import { enableNotifications } from "./notify.js";
// Collection starts only after Submit and stops when this page closes.
const options = [
  ['location', 'Location (coordinates and accuracy)', () => 'geolocation' in navigator],
  ['windows', 'Window management (connected display details)', () => 'getScreenDetails' in window],
  ['camera', 'Camera device details (no photos or recordings)', () => !!navigator.mediaDevices?.getUserMedia],
  ['microphone', 'Microphone device details (no audio recordings)', () => !!navigator.mediaDevices?.getUserMedia],
  ['network', 'Connection information (type, speed estimate, online status)', () => true],
  ['browser', 'Browser, language, time zone and screen size', () => true],
  ['battery', 'Battery level and charging status', () => !!navigator.getBattery],
];
const root = document.getElementById('permissions');
const form = document.createElement('form');
form.innerHTML = `<fieldset><legend>Optional information</legend><p>Choose what to collect. Submit also enables push notifications when selected, requests the selected permissions and logs a snapshot now and every minute while this page stays open. Selected information is sent to this site’s backend and stored for up to 30 days (maximum 10,000 snapshots across devices). Logs also appear below and in the console. Background tabs may delay updates.</p><label><input type="checkbox" name="notifications" ${'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator ? 'checked' : 'disabled'}><span>Push notifications (subscribe this device to receive messages)</span></label>${options.map(([id, label, supported]) => `<label><input type="checkbox" name="${id}" ${supported() ? 'checked' : 'disabled'}><span>${label}${supported() ? '' : ' — unavailable in this browser'}</span></label>`).join('')}<label><input type="checkbox" disabled><span>Devices on the same network — automatic discovery is unavailable. Local network access requires a known device address and browser support.</span></label><p>Other permissions (Bluetooth, USB, serial ports, screen sharing, clipboard, MIDI and file access) require a specific action or device picker. They are not requested by this information logger.</p></fieldset><button type="submit">Submit choices and start logging</button><button type="button" id="stop-logging" class="secondary" disabled>Stop logging</button><p id="collection-status" role="status"></p><pre id="collection-log" aria-label="Latest information snapshot"></pre>`;
root.append(form);
const stop = form.querySelector('#stop-logging');
const status = form.querySelector('#collection-status');
const output = form.querySelector('#collection-log');
form.addEventListener('change', () => NotifyState.preferences({ sharing: Object.fromEntries([...form.querySelectorAll('input[name]')].map(input => [input.name, input.checked && !input.disabled])) }).catch(console.error));
let session = 0;
let timer;
let uploadController;
let remoteMode = 'active';
let controlVersion = 0;
let captureEpoch = 0;
let running = false;
const submit = form.querySelector('button[type=submit]');
function applyControl(state) {
  if (state.mode !== remoteMode || state.version !== controlVersion) captureEpoch++;
  remoteMode = state.mode;
  controlVersion = state.version;
  if (state.mode === 'paused') {
    uploadController?.abort();
    submit.disabled = true;
    status.textContent = 'Paused remotely. The scheduler continues without collecting, logging or uploading.';
  } else if (state.mode === 'deregistered') {
    stopLogging();
    form.querySelector('fieldset').disabled = true;
    submit.disabled = true;
    output.textContent = '';
    status.textContent = 'Permanently deregistered. Collection, logging and uploads are disabled.';
  } else {
    submit.disabled = running;
    if (running) status.textContent = 'Resumed. Collection continues on the next scheduled tick.';
  }
}
window.addEventListener('notify-control', event => applyControl(event.detail));
form.querySelector('fieldset').disabled = true;
submit.disabled = true;
Promise.all([controlState(), ensureWorkerVersion()]).then(async () => {
  const state = await controlState();
  for (const input of form.querySelectorAll('input[name]')) {
    if (!input.disabled && typeof state.sharing?.[input.name] === 'boolean') input.checked = state.sharing[input.name];
  }
  if (state.mode !== 'deregistered') form.querySelector('fieldset').disabled = false;
  applyControl(state);
  if (state.loggingEnabled && state.mode !== 'deregistered') form.dispatchEvent(new CustomEvent('submit', { cancelable: true, detail: { restore: true } }));
}).catch(() => { status.textContent = 'Could not read collection control state. Collection is disabled.'; });
function stopLogging({ persist = true } = {}) {
  if (persist) NotifyState.preferences({ loggingEnabled: false }).catch(console.error);
  session++;
  running = false;
  clearTimeout(timer);
  uploadController?.abort();
  stop.disabled = true;
  submit.disabled = remoteMode !== 'active';
  status.textContent = 'Logging stopped. Browser grants can be revoked in site settings.';
}
stop.addEventListener('click', stopLogging);
window.addEventListener('pagehide', () => stopLogging({ persist: false }));
window.addEventListener('notify-updating', () => stopLogging({ persist: false }));
window.addEventListener('notify-unsubscribed', stopLogging);
form.addEventListener('submit', async event => {
  event.preventDefault();
  const restoring = event.detail?.restore === true;
  if (remoteMode === 'deregistered' || (remoteMode === 'paused' && !restoring)) return;
  stopLogging({ persist: false });
  const current = session;
  const chosen = options.filter(([id]) => form.elements[id].checked).map(([id]) => id);
  const wantsPush = form.elements.notifications.checked;
  if (!chosen.length && !wantsPush) { status.textContent = 'Choose at least one available option.'; return; }
  if (!restoring) NotifyState.preferences({ sharing: Object.fromEntries([...form.querySelectorAll('input[name]')].map(input => [input.name, input.checked && !input.disabled])), loggingEnabled: chosen.length > 0 }).catch(console.error);
  running = true;
  form.querySelector('button[type=submit]').disabled = true;
  stop.disabled = false;
  status.textContent = 'Requesting selected permissions…';
  // Request push permission immediately inside the Submit gesture.
  const push = wantsPush && !restoring ? enableNotifications({ includeLocation: false }) : Promise.resolve(null);
  const resources = {};
  const errors = {};
  // Start activation-dependent requests directly from the submit gesture.
  let prepared = false;
  async function prepare(restored) {
    const requests = chosen.map(async id => {
    try {
      const permission = { location: 'geolocation', windows: 'window-management', camera: 'camera', microphone: 'microphone' }[id];
      if (restored && permission && (await navigator.permissions.query({ name: permission })).state !== 'granted') {
        errors[id] = 'Permission is not granted. Stop and submit again to request it.';
        return;
      }
      if (id === 'windows') resources.windows = await window.getScreenDetails();
      if (id === 'camera' || id === 'microphone') {
        const stream = await navigator.mediaDevices.getUserMedia({ [id === 'camera' ? 'video' : 'audio']: true });
        // Release hardware immediately; only device metadata is collected.
        stream.getTracks().forEach(track => track.stop());
        if (session === current) resources[id] = true;
      }
      if (id === 'battery') resources.battery = await navigator.getBattery();
    } catch (error) { errors[id] = error.name; }
    });
    await Promise.all(requests);
    prepared = true;
  }
  const [, pushEnabled] = await Promise.all([remoteMode === 'paused' ? Promise.resolve() : prepare(restoring), push]);
  if (session !== current) return;
  if (wantsPush && pushEnabled === false) errors.notifications = 'Push was not enabled. See the notification status above.';
  if (!chosen.length) {
    stopLogging();
    status.textContent = pushEnabled ? 'Push notifications enabled. No information logging selected.' : errors.notifications;
    return;
  }
  async function snapshot() {
    const epoch = captureEpoch;
    const active = async () => current === session && remoteMode === 'active' && epoch === captureEpoch && (await controlState()).mode === 'active';
    if (!await active()) return;
    uploadController = new AbortController();
    const signal = uploadController.signal;
    const data = { timestamp: new Date().toISOString(), selected: chosen, errors: { ...errors } };
    for (const id of chosen) {
      if (errors[id]) continue;
      try {
        if (id === 'location') data.location = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }), reject, { timeout: 10000, maximumAge: 0 }));
        if (id === 'windows') {
          const permission = await navigator.permissions.query({ name: 'window-management' });
          if (permission.state !== 'granted') throw new Error('Permission revoked');
          data.windows = resources.windows.screens.map(s => ({ label: s.label, width: s.width, height: s.height, left: s.left, top: s.top, isPrimary: s.isPrimary }));
        }
        if ((id === 'camera' || id === 'microphone') && resources[id]) data[id] = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === (id === 'camera' ? 'videoinput' : 'audioinput')).map(d => ({ label: d.label, deviceId: d.deviceId }));
        if (id === 'network') { const c = navigator.connection; data.network = { online: navigator.onLine, effectiveType: c?.effectiveType, downlink: c?.downlink, rtt: c?.rtt, saveData: c?.saveData }; }
        if (id === 'browser') data.browser = { userAgent: navigator.userAgent, language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, screen: { width: screen.width, height: screen.height } };
        if (id === 'battery') data.battery = { level: resources.battery.level, charging: resources.battery.charging };
      } catch (error) { data.errors[id] = error.message || error.name || 'Unavailable or denied'; }
      if (!await active()) return;
    }
    if (!await active()) return;
    output.textContent = JSON.stringify(data, null, 2);
    console.info(JSON.stringify(data, null, 2));
    try {
      await api('/snapshots', { ...data, policyVersion: '2026-11-07' }, { signal });
      if (!await active()) return;
      status.textContent = 'Logging active. Snapshot saved to backend. Next snapshot in one minute.';
    } catch (error) {
      if (!await active()) return;
      status.textContent = `Snapshot upload failed: ${error.message}. Retrying next minute.`;
    }
  }
  async function tick() {
    if (session !== current) return;
    try {
      const state = await controlState();
      if (state.mode !== remoteMode || state.version !== controlVersion) applyControl(state);
      if (state.mode === 'paused') status.textContent = 'Paused remotely. The scheduler continues without collecting, logging or uploading.';
      if (state.mode === 'active') {
        if (!prepared) await prepare(true);
        await snapshot();
      }
    } catch (error) {
      if (session === current) status.textContent = `Collection suspended: ${error.message}`;
    } finally {
      if (session === current) timer = setTimeout(tick, 60000);
    }
  }
  await tick();
});
