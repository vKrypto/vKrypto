// Shared by window modules and the service worker. Keep a terminal marker after
// deregistration so reopening the page cannot silently create another device.
(() => {
  let database;
  function db() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('notify-control-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return database;
  }
  async function update(fn) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite');
      const store = transaction.objectStore('state');
      const request = store.get('current');
      let value;
      request.onsuccess = () => {
        value = fn(request.result || { mode: 'active', version: 0 });
        store.put(value, 'current');
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || Error('Control state update aborted'));
    });
  }
  async function read() {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('state');
      const request = transaction.objectStore('state').get('current');
      request.onsuccess = () => resolve(request.result || { mode: 'active', version: 0 });
      request.onerror = () => reject(request.error);
    });
  }
  globalThis.NotifyState = { read, update };
})();
