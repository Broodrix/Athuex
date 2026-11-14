/* Athuex VFS façade — single API over RAM workspace + SMFS — v1.0.1 */
(function (SG) {
  'use strict';

  /** @type {Record<string,string>} */
  let filesRef = null;
  let onChange = null;

  function bind(filesObject, changeCb) {
    filesRef = filesObject;
    onChange = typeof changeCb === 'function' ? changeCb : null;
  }

  function listKeys() {
    return filesRef ? Object.keys(filesRef) : [];
  }

  function read(path) {
    const key = String(path || '').replace(/^\/+/, '');
    if (!key || !filesRef) return null;
    return filesRef[key] != null ? String(filesRef[key]) : null;
  }

  async function write(path, content, opts) {
    const key = String(path || '').replace(/^\/+/, '').replace(/\.\./g, '');
    if (!key || !filesRef) throw new Error('VFS not bound');
    content = content == null ? '' : String(content);
    if (opts && opts.checkpoint && typeof opts.checkpoint === 'function') {
      opts.checkpoint(key, filesRef[key]);
    }
    filesRef[key] = content;
    // Write-through SMFS
    if (window.SMFS && typeof SMFS.isReady === 'function' && SMFS.isReady()) {
      try {
        let expected;
        try {
          const r = await SMFS.read('/' + key);
          expected = r.crc;
        } catch (_) {}
        await SMFS.write('/' + key, content, expected);
      } catch (e) {
        console.warn('[VFS] SMFS write-through failed', key, e);
      }
    }
    if (onChange) onChange('write', key);
    return key;
  }

  async function remove(path) {
    const key = String(path || '').replace(/^\/+/, '');
    if (!key || !filesRef) return false;
    const isDir = !Object.prototype.hasOwnProperty.call(filesRef, key) &&
      Object.keys(filesRef).some(function (k) { return k === key || k.startsWith(key + '/'); });
    if (isDir) {
      Object.keys(filesRef).forEach(function (k) {
        if (k === key || k.startsWith(key + '/')) delete filesRef[k];
      });
    } else {
      delete filesRef[key];
    }
    if (window.SMFS && SMFS.isReady()) {
      try {
        if (isDir && typeof SMFS.walk === 'function') {
          const walk = await SMFS.walk();
          for (const row of walk || []) {
            const k = String(row.path || '').replace(/^\/+/, '');
            if (k === key || k.startsWith(key + '/')) {
              try { await SMFS.remove(row.path); } catch (_) {}
            }
          }
        } else {
          try { await SMFS.remove('/' + key); } catch (_) {}
        }
      } catch (_) {}
    }
    if (onChange) onChange('remove', key);
    return true;
  }

  async function hydrateFromSmfs() {
    if (!filesRef || !window.SMFS || !SMFS.isReady()) return 0;
    const walk = await SMFS.walk();
    let n = 0;
    for (const row of (walk || [])) {
      const key = String(row.path || '').replace(/^\/+/, '');
      if (!key) continue;
      try {
        const r = await SMFS.read(row.path);
        filesRef[key] = r.content;
        n++;
      } catch (_) {}
    }
    if (onChange && n) onChange('hydrate', n);
    return n;
  }

  async function syncToSmfs() {
    if (!filesRef || !window.SMFS || !SMFS.isReady()) return 0;
    const keys = Object.keys(filesRef);
    let n = 0;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      try {
        let expected;
        try {
          const r = await SMFS.read('/' + key);
          expected = r.crc;
        } catch (_) {}
        await SMFS.write('/' + key, String(filesRef[key] == null ? '' : filesRef[key]), expected);
        n++;
      } catch (e) {
        console.warn('[VFS] sync', key, e);
      }
    }
    return n;
  }

  SG.vfs = {
    bind: bind,
    listKeys: listKeys,
    read: read,
    write: write,
    remove: remove,
    hydrateFromSmfs: hydrateFromSmfs,
    syncToSmfs: syncToSmfs
  };
})(window.SG = window.SG || {});
