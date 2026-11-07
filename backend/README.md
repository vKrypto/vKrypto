# Local notification backend

Requires Node.js 22+. Run one server process:

```sh
cd backend
npm ci
npm start
```

Visitor page: http://localhost:8980/notify/
Admin page: http://localhost:8980/admin/

Copy `adminToken` from `backend/data/config.json` into the admin page. The token
is kept only in the page's memory. Do not share the config file; it also holds
the VAPID private key. Set `VAPID_SUBJECT=mailto:you@example.com` to your contact
address before using push beyond local testing. `PORT` defaults to 8980. The
server binds to loopback only. Use the backend URL rather than the old static
preview on port 8976.

On the visitor page, enable notifications and accept the browser prompt. That
registers a push subscription. The separate information form has supported
options selected by default; Submit requests permissions and uploads snapshots
immediately and once per minute after the previous collection completes. Stop
or closing the page ends collection. Browser throttling may delay background
updates. Camera/microphone are released immediately; no recordings are made.
Unsupported capabilities and automatic LAN discovery remain unavailable.

In admin, load devices, select push-enabled rows, enter a title/message/link,
and Send. Results mean accepted by the push provider, not proof that the user
saw the notification. Expired subscriptions (404/410) are disabled automatically.
Actual push requires internet access to the browser's push provider and a real
browser subscription. Localhost supports browser secure-context APIs.

## Storage and API

`data/database.json` stores devices, consent, snapshots and delivery results.
Writes are serialized and replace the JSON file atomically. `data/config.json`
keeps the same VAPID keys across restarts; losing it requires resubscribing.
Both files and dependencies are git-ignored. This is a single-process local
backend, not a multi-process database.

Snapshots are pruned on upload to the newest 10,000 entries and 30 days;
delivery results are capped at 1,000. Unsubscribe deletes the device and its
snapshots. Browser device tokens authorize registration/uploads/removal;
admin routes require `x-admin-token`. Push keys and device tokens are omitted
from device listings. API bodies are capped at 64 KiB. No CORS is enabled.

- `GET /api/health`, `GET /api/vapid-public-key`
- `POST /api/session` → device ID and token
- `POST /api/devices`, `/api/snapshots`, `/api/devices/unsubscribe` with `x-device-token`
- `GET /api/admin/devices`, `/api/admin/logs?deviceId=…`, `/api/admin/deliveries`
- `POST /api/admin/send` with `{deviceIds, title, body, url}`

All admin routes need `x-admin-token`. Only selected snapshot fields are saved.
`npm test` tests the API with an injected push sender and temporary file storage,
including persistence, access control, endpoint validation, selected fields,
targeted delivery, expired subscriptions and unsubscribe deletion. It does not
send real push messages.
