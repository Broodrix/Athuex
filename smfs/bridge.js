/* Main-thread SMFS API */
(function () {
  'use strict';
  let worker = null;
  let seq = 0;
  const pending = new Map();
  const changeListeners = [];
  let ready = false;
  let mode = 'none';

  function ensureWorker() {
    if (worker) return;
    worker = new Worker('smfs/worker.js');
    worker.onmessage = (e) => {
      const { id, ok, result, error, event, path } = e.data || {};
      if (event === 'change' && path) {
        changeListeners.forEach((cb) => { try { cb(path); } catch (_) {} });
        return;
      }
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error || 'SMFS error'));
    };
    worker.onerror = (err) => {
      pending.forEach((p) => p.reject(new Error(err.message || 'Worker error')));
      pending.clear();
    };
  }

  function call(op, payload) {
    ensureWorker();
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ op, id, payload });
      } catch (e) {
        pending.delete(id);
        reject(e);
      }
    });
  }

  async function mount(name, _unused, opts) {
    const res = await call('mount', {
      name: name || 'workspace',
      sizeMB: (opts && opts.sizeMB) || 32,
      clear: !!(opts && opts.clear)
    });
    ready = true;
    mode = (res && res.mode) || 'exclusive';
    return res;
  }

  function readText(path) {
    return call('read', { path }).then((r) => r.content);
  }
  function read(path) { return call('read', { path }); }
  function write(path, content, expectedCrc) {
    return call('write', { path, content, expectedCrc }).then((r) => {
      changeListeners.forEach((cb) => { try { cb(path); } catch (_) {} });
      return r;
    });
  }
  function list(path) { return call('list', { path: path || '/' }); }
  function walk() { return call('walk'); }
  function remove(path) {
    return call('remove', { path }).then((r) => {
      changeListeners.forEach((cb) => { try { cb(path); } catch (_) {} });
      return r;
    });
  }
  async function exportVolume() {
    const r = await call('export');
    return r.bytes;
  }
  function importVolume(bytes) {
    return call('import', { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes) });
  }
  function onChange(cb) {
    if (typeof cb === 'function') changeListeners.push(cb);
  }
  function isReady() { return ready; }
  function getMode() { return mode; }
  function stat() { return call('stat'); }

  window.SMFS = {
    mount, readText, read, write, list, walk, remove, stat,
    exportVolume, importVolume, onChange, isReady, getMode
  };
})();
