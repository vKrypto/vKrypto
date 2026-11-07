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
from device listings. API bodies are capped at 64 KiB. Cross-origin visitor APIs are restricted to explicitly configured origins.

- `GET /api/health`, `GET /api/vapid-public-key`
- `POST /api/session` → device ID and token
- `GET /api/device` with `x-device-token` reports current subscription state
- `POST /api/devices`, `/api/snapshots`, `/api/devices/unsubscribe` with `x-device-token`
- `GET /api/admin/devices`, `/api/admin/logs?deviceId=…`, `/api/admin/deliveries`
- `POST /api/admin/send` with `{deviceIds, title, body, url}`

All admin routes need `x-admin-token`. Only selected snapshot fields are saved.
`npm test` tests the API with an injected push sender and temporary file storage,
including persistence, access control, endpoint validation, selected fields,
targeted delivery, expired subscriptions and unsubscribe deletion. It does not
send real push messages.

## Frontend configuration and GitHub Pages

Local frontend and backend work together at `http://localhost:8980/notify/`.
`build/notify/config.json` contains `{ "apiBaseUrl": "" }`: an empty value uses
`/api` on the current origin. Device credentials are scoped to the configured
backend. The frontend checks the backend subscription on reload and renews stale
device credentials after database deletion. Existing same-origin credentials
are migrated automatically.

For a GitHub Pages frontend and separately hosted backend, set the public API
base in that file before building, for example:

```json
{ "apiBaseUrl": "https://notify.example.com/api" }
```

On the backend set `ALLOWED_ORIGINS=https://ashutoshverma.com` (comma-separated
exact origins, without trailing slashes). Use `PUBLIC_ORIGIN=https://notify.example.com`
when HTTPS terminates at a reverse proxy so origin checks and default links use
the public address. Keep the listener on loopback and proxy to it. Admin remains
on the backend origin and requires its token; cross-origin admin access is not
enabled. Use the frontend's full URL in the notification link field when sending
from a separate backend. Remote API addresses must use HTTPS; HTTP is accepted
only for loopback development. A publicly reachable backend has not been deployed.

The Pages workflow builds `build/` with Jekyll into `_site/`. Notification HTML,
configuration and browser scripts are copied as static assets, then verified
before uploading. Backend code and private data remain outside the Jekyll source.
GitHub Pages hosts only the static frontend; it does not run Node.js.
Console snapshots are formatted JSON strings that can be copied into a parser.

## Browser end-to-end tests

```sh
npm test
npm run test:e2e
```

The browser suite needs local Chrome (`/usr/bin/google-chrome`, or set
`CHROME_PATH`). It starts isolated servers with temporary databases and tests
both same-origin hosting and separate frontend/backend origins, including real
CORS preflights. It covers notification registration, reload reconciliation,
JSON console output, repeated uploads (the minute timer is accelerated), Stop,
admin selection/logs/send, actual service-worker notification display, persistence,
legacy credential migration, stale-token recovery, re-sync and unsubscribe cleanup.

Only the external push provider is simulated: the fixture replaces Chrome's
remote subscription registration and uses Chrome DevTools to deliver the message
to the real service worker. Production uses `web-push`; these tests do not verify
Google/Mozilla/Apple delivery or interactive hardware prompts. All test data is
removed and browser/server processes are closed when the suite finishes.
