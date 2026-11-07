// Shared by window modules and the service worker. Keep a terminal marker after
// deregistration so reopening the page cannot silently create another device.
(() => {
  let database;
  function defaults() {
    try {
      const saved = JSON.parse(localStorage.getItem('notify-preferences-v1'));
      if (saved && ['active', 'paused', 'deregistered'].includes(saved.mode)) return saved;
    } catch {}
    return { mode: 'active', version: 0, registration: 'unregistered', loggingEnabled: false };
  }
  function withLocalPreferences(state) {
    try {
      const saved = JSON.parse(localStorage.getItem('notify-preferences-v1'));
      for (const key of ['sharing', 'loggingEnabled', 'shareSubscriptionLocation']) {
        if (saved?.[key] !== undefined && state.mode !== 'deregistered') state[key] = saved[key];
      }
    } catch {}
    return state;
  }
  function mirror(state) {
    try {
      const { credential, ...preferences } = state;
      localStorage.setItem('notify-preferences-v1', JSON.stringify(preferences));
    } catch {}
  }
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
        value = fn(withLocalPreferences(request.result || defaults()));
        store.put(value, 'current');
      };
      transaction.oncomplete = () => { mirror(value); resolve(value); };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || Error('Control state update aborted'));
    });
  }
  async function read() {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('state');
      const request = transaction.objectStore('state').get('current');
      request.onsuccess = () => { const state = withLocalPreferences(request.result || defaults()); mirror(state); resolve(state); };
      request.onerror = () => reject(request.error);
    });
  }
  function preferences(patch) {
    // Save synchronously so an immediate reload cannot lose a user choice.
    try { mirror({ ...defaults(), ...patch }); } catch {}
    return update(state => state.mode === 'deregistered' ? state : { ...state, ...patch });
  }
  globalThis.NotifyState = { read, update, preferences };
})();
