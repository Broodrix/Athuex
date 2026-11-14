// Chunked IndexedDB persistence for SMFS volumes
(function () {
  'use strict';
  const IDB_NAME = 'athuex-smfs';
  const IDB_STORE = 'volumes';
  const CHUNK = 1024 * 1024;

  function openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveVolume(name, bytes) {
    const db = await openIDB();
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put({ total: u8.length, chunks: Math.ceil(u8.length / CHUNK) || 1 }, name + ':meta');
      for (let i = 0; i < u8.length; i += CHUNK) {
        store.put(u8.slice(i, i + CHUNK), name + ':chunk:' + (i / CHUNK));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadVolume(name) {
    const db = await openIDB();
    const meta = await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(name + ':meta');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!meta) return null;
    const out = new Uint8Array(meta.total);
    for (let i = 0; i < meta.chunks; i++) {
      const chunk = await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(name + ':chunk:' + i);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (chunk) out.set(new Uint8Array(chunk), i * CHUNK);
    }
    return out;
  }

  async function deleteVolume(name) {
    const db = await openIDB();
    const meta = await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(name + ':meta');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.delete(name + ':meta');
      if (meta) {
        for (let i = 0; i < meta.chunks; i++) store.delete(name + ':chunk:' + i);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  window.SMFSPersistence = { saveVolume, loadVolume, deleteVolume };
})();
