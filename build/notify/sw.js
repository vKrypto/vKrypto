// Service worker: shows incoming push messages and opens their link on click.
self.addEventListener("push", (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { body: event.data?.text() }; }

  const title = msg.title || "New notification";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: msg.body || "",
      icon: msg.icon || "/favicon.ico",
      tag: msg.tag,
      data: { url: msg.url || "/", id: msg.id },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const existing = wins.find((w) => w.url === url);
      return existing ? existing.focus() : self.clients.openWindow(url);
    }),
  );
});
