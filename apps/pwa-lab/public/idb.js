/* Ajudante mínimo de IndexedDB, usado pela página e pelo service worker (script clássico). */
/* global self */
;(function (root) {
  const DB_NAME = 'pingo-lab'
  let dbPromise

  function open() {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        db.createObjectStore('shares', { keyPath: 'id', autoIncrement: true })
        db.createObjectStore('reminders', { keyPath: 'id' })
        db.createObjectStore('kv')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return dbPromise
  }

  async function tx(store, mode, fn) {
    const db = await open()
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode)
      const out = fn(t.objectStore(store))
      t.oncomplete = () => resolve(out.result)
      t.onerror = () => reject(t.error)
    })
  }

  root.labIdb = {
    add: (store, value) => tx(store, 'readwrite', (s) => s.add(value)),
    put: (store, value, key) => tx(store, 'readwrite', (s) => s.put(value, key)),
    get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
    all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  }
})(typeof self !== 'undefined' ? self : window)
