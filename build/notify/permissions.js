import { api } from "./client.js";
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
let session = 0;
let timer;
let uploadController;
function stopLogging() {
  session++;
  clearTimeout(timer);
  uploadController?.abort();
  stop.disabled = true;
  form.querySelector('button[type=submit]').disabled = false;
  status.textContent = 'Logging stopped. Browser grants can be revoked in site settings.';
}
stop.addEventListener('click', stopLogging);
window.addEventListener('pagehide', stopLogging);
window.addEventListener('notify-unsubscribed', stopLogging);
form.addEventListener('submit', async event => {
  event.preventDefault();
  stopLogging();
  const current = session;
  const chosen = options.filter(([id]) => form.elements[id].checked).map(([id]) => id);
  const wantsPush = form.elements.notifications.checked;
  if (!chosen.length && !wantsPush) { status.textContent = 'Choose at least one available option.'; return; }
  uploadController = new AbortController();
  const signal = uploadController.signal;
  form.querySelector('button[type=submit]').disabled = true;
  stop.disabled = false;
  status.textContent = 'Requesting selected permissions…';
  // Request push permission immediately inside the Submit gesture.
  const push = wantsPush ? enableNotifications({ includeLocation: false }) : Promise.resolve(null);
  const resources = {};
  const errors = {};
  // Start activation-dependent requests directly from the submit gesture.
  const requests = chosen.map(async id => {
    try {
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
  const [, pushEnabled] = await Promise.all([Promise.all(requests), push]);
  if (session !== current) return;
  if (wantsPush && !pushEnabled) errors.notifications = 'Push was not enabled. See the notification status above.';
  if (!chosen.length) {
    stopLogging();
    status.textContent = pushEnabled ? 'Push notifications enabled. No information logging selected.' : errors.notifications;
    return;
  }
  async function snapshot() {
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
      if (session !== current) return;
    }
    if (session !== current) return;
    output.textContent = JSON.stringify(data, null, 2);
    console.info(JSON.stringify(data, null, 2));
    try {
      await api('/snapshots', { ...data, policyVersion: '2026-11-07' }, { signal });
      if (session !== current) return;
      status.textContent = 'Logging active. Snapshot saved to backend. Next snapshot in one minute.';
    } catch (error) {
      if (session !== current) return;
      status.textContent = `Snapshot upload failed: ${error.message}. Retrying next minute.`;
    }
    timer = setTimeout(snapshot, 60000);
  }
  await snapshot();
});
