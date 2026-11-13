/* Athuex local Q4_K_M GGUF engine — v1.2.0
 *
 * Loads any llama.cpp Q4_K_M GGUF (general.file_type 15, or a *.Q4_K_M.gguf
 * name when the header omits file_type) through the vendored wllama runtime.
 * Weights are fetched with GET. wllama's loadModelFromUrl is not used: its
 * HEAD probe throws "Failed to fetch" on QuickEdit and other static servers.
 * There is no offline text agent. If the GGUF is not loaded, callers use NVIDIA.
 */
(function (SG) {
  'use strict';
  const VERSION = '1.2.0';
  const WLLAMA_VER = '2.3.5';
  const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@' + WLLAMA_VER + '/esm';
  const IDB_NAME = 'athuex-local-gguf';
  const IDB_VER = 1;
  const IDB_STORE = 'models';
  const IDB_KEY = 'primary-gguf';
  const HEADER_SCAN = 8 * 1024 * 1024;
  const FTYPE_Q4_K_M = 15;
  const FTYPE_NAME = {
    0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 7: 'Q8_0', 8: 'Q5_0', 9: 'Q5_1',
    10: 'Q2_K', 11: 'Q3_K_S', 12: 'Q3_K_M', 13: 'Q3_K_L', 14: 'Q4_K_S', 15: 'Q4_K_M',
    16: 'Q5_K_S', 17: 'Q5_K_M', 18: 'Q6_K'
  };

  let status = 'unavailable';
  let progress = 0;
  let lastError = null;
  let modelLabel = 'none';
  let loadedInfo = null;
  let wllama = null;
  let modelReady = false;
  let loadPromise = null;
  let wllamaImportPromise = null;
  let bootStarted = false;
  let runtimeKind = 'none';
  const listeners = new Set();

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(getStatus()); } catch (_) {}
    });
  }

  function onStatus(fn) {
    if (typeof fn === 'function') listeners.add(fn);
    return function () { listeners.delete(fn); };
  }

  function getStatus() {
    return {
      status: status,
      progress: progress,
      error: lastError,
      version: VERSION,
      model: modelLabel,
      architecture: loadedInfo && loadedInfo.architecture || '',
      quant: loadedInfo && loadedInfo.quant || '',
      hasGgufRuntime: !!modelReady,
      backend: modelReady ? 'wllama-gguf' : 'none',
      runtime: runtimeKind
    };
  }

  function pageIsHttp() {
    try {
      var p = location.protocol || '';
      return p === 'http:' || p === 'https:';
    } catch (_) { return false; }
  }

  function toAbsoluteUrl(url) {
    var u = String(url || '').trim();
    if (!u) return null;
    if (/^(https?:|blob:)/i.test(u)) return u;
    try {
      return new URL(u, document.baseURI || location.href).href;
    } catch (_) {
      return null;
    }
  }

  function fileBaseName(urlOrName) {
    var s = String(urlOrName || '');
    try { s = decodeURIComponent(s); } catch (_) {}
    s = s.split('?')[0].split('#')[0];
    var parts = s.split('/');
    return parts[parts.length - 1] || 'model.gguf';
  }

  function nameIsQ4KM(name) {
    var n = String(name || '');
    return /\.gguf$/i.test(n) && /q4[_\-.]?k[_\-.]?m/i.test(n);
  }

  function deviceRamGB() {
    try {
      var d = navigator.deviceMemory;
      if (typeof d === 'number' && d > 0) return d;
    } catch (_) {}
    return 4;
  }

  function assertFits(bytes) {
    var gb = deviceRamGB();
    var budget = Math.floor(gb * 0.40 * 1024 * 1024 * 1024);
    if (bytes > budget) {
      throw new Error(
        'Model is ' + Math.round(bytes / 1048576) + 'MB. This browser reports ~' +
        gb + 'GB RAM and can hold about ' + Math.round(budget / 1048576) + 'MB of Q4_K_M weights.'
      );
    }
  }

  function pickCtx(info, bytes) {
    var train = (info && info.contextLength) || 0;
    var gb = deviceRamGB();
    var ctx = 2048;
    if (gb <= 2 || bytes > 900 * 1048576) ctx = 512;
    else if (gb <= 3 || bytes > 500 * 1048576) ctx = 1024;
    if (train > 0) ctx = Math.min(ctx, train);
    if (ctx < 256) ctx = 256;
    return ctx;
  }

  /* ---------- GGUF header (little-endian, versions 2 and 3) ---------- */
  function fixedSize(t) {
    if (t === 0 || t === 1 || t === 7) return 1;
    if (t === 2 || t === 3) return 2;
    if (t === 4 || t === 5 || t === 6) return 4;
    if (t === 10 || t === 11 || t === 12) return 8;
    return 0;
  }

  function readScalar(view, off, t) {
    if (t === 0) return view.getUint8(off);
    if (t === 1) return view.getInt8(off);
    if (t === 2) return view.getUint16(off, true);
    if (t === 3) return view.getInt16(off, true);
    if (t === 4) return view.getUint32(off, true);
    if (t === 5) return view.getInt32(off, true);
    if (t === 6) return view.getFloat32(off, true);
    if (t === 7) return view.getUint8(off) ? 1 : 0;
    if (t === 10 || t === 11) {
      var lo = view.getUint32(off, true);
      var hi = view.getUint32(off + 4, true);
      if (hi > 0x1fffff) return null;
      return hi * 4294967296 + lo;
    }
    if (t === 12) return view.getFloat64(off, true);
    return null;
  }

  function readU64(view, off) {
    if (off + 8 > view.byteLength) return null;
    var lo = view.getUint32(off, true);
    var hi = view.getUint32(off + 4, true);
    if (hi !== 0) return { value: -1, next: off + 8 };
    return { value: lo, next: off + 8 };
  }

  function readString(view, off) {
    var n = readU64(view, off);
    if (!n || n.value < 0) return null;
    var end = n.next + n.value;
    if (end > view.byteLength) return null;
    var bytes = new Uint8Array(view.buffer, view.byteOffset + n.next, n.value);
    return { value: new TextDecoder('utf-8', { fatal: false }).decode(bytes), next: end };
  }

  function readValue(view, off, vtype) {
    if (vtype === 8) {
      var s = readString(view, off);
      if (!s) return null;
      return { value: s.value.length <= 4096 ? s.value : '', next: s.next };
    }
    if (vtype === 9) {
      if (off + 12 > view.byteLength) return null;
      var et = view.getUint32(off, true);
      var ln = readU64(view, off + 4);
      if (!ln || ln.value < 0) return null;
      off = ln.next;
      var sz = fixedSize(et);
      if (sz > 0) {
        var bytes = ln.value * sz;
        if (bytes > view.byteLength || off + bytes > view.byteLength) return null;
        return { value: null, next: off + bytes };
      }
      if (et === 8) {
        for (var i = 0; i < ln.value; i++) {
          var st = readString(view, off);
          if (!st) return null;
          off = st.next;
        }
        return { value: null, next: off };
      }
      return null;
    }
    var width = fixedSize(vtype);
    if (!width || off + width > view.byteLength) return null;
    return { value: readScalar(view, off, vtype), next: off + width };
  }

  function inspectGguf(buffer, fileName) {
    var view = buffer instanceof DataView
      ? buffer
      : new DataView(buffer.buffer || buffer, buffer.byteOffset || 0, buffer.byteLength);
    if (view.byteLength < 24) {
      return { ok: false, hard: true, error: 'File is too small to be GGUF' };
    }
    if (view.getUint32(0, true) !== 0x46554747) {
      return { ok: false, hard: true, error: 'Not a GGUF file (missing GGUF magic)' };
    }
    var version = view.getUint32(4, true);
    if (version < 2 || version > 3) {
      return { ok: false, hard: true, error: 'Unsupported GGUF version ' + version };
    }
    var nKvInfo = readU64(view, 16);
    if (!nKvInfo || nKvInfo.value < 0 || nKvInfo.value > 100000) {
      return { ok: false, hard: true, error: 'GGUF metadata count is corrupt' };
    }
    var off = 24;
    var meta = {};
    var truncated = false;
    for (var i = 0; i < nKvInfo.value; i++) {
      var key = readString(view, off);
      if (!key) { truncated = true; break; }
      off = key.next;
      if (off + 4 > view.byteLength) { truncated = true; break; }
      var vtype = view.getUint32(off, true);
      off += 4;
      var val = readValue(view, off, vtype);
      if (!val) { truncated = true; break; }
      off = val.next;
      if (val.value != null && val.value !== '') meta[key.value] = val.value;
    }
    var arch = typeof meta['general.architecture'] === 'string' ? meta['general.architecture'] : '';
    var gname = typeof meta['general.name'] === 'string' ? meta['general.name'] : '';
    var fileType = typeof meta['general.file_type'] === 'number' ? meta['general.file_type'] : null;
    var ctxKey = arch ? (arch + '.context_length') : '';
    var contextLength = ctxKey && typeof meta[ctxKey] === 'number' ? meta[ctxKey] : 0;
    var named = nameIsQ4KM(fileName);
    if (fileType != null && fileType !== FTYPE_Q4_K_M) {
      return {
        ok: false,
        hard: true,
        error: 'This GGUF is ' + (FTYPE_NAME[fileType] || ('ftype ' + fileType)) + ', not Q4_K_M.',
        architecture: arch,
        name: gname,
        fileType: fileType
      };
    }
    if (fileType == null && !named) {
      return {
        ok: false,
        hard: !truncated,
        truncated: truncated,
        error: truncated
          ? 'Header scan did not reach general.file_type. Use a file named *-Q4_K_M.gguf.'
          : 'Not a Q4_K_M GGUF. Need general.file_type 15 or a *.Q4_K_M.gguf name.'
      };
    }
    return {
      ok: true,
      hard: false,
      truncated: truncated,
      architecture: arch,
      name: gname || fileBaseName(fileName),
      fileType: fileType,
      contextLength: contextLength,
      quant: 'Q4_K_M',
      verified: fileType === FTYPE_Q4_K_M ? 'metadata' : 'filename'
    };
  }

  function bytesToView(bytes) {
    if (!bytes) return new DataView(new ArrayBuffer(0));
    if (bytes instanceof DataView) return bytes;
    if (bytes instanceof ArrayBuffer) return new DataView(bytes);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  async function readBlobPrefix(blob, n) {
    var slice = blob.slice(0, Math.min(n, blob.size || n));
    var ab = await slice.arrayBuffer();
    return new DataView(ab);
  }

  async function inspectBlob(blob, fileName) {
    var view = await readBlobPrefix(blob, HEADER_SCAN);
    return inspectGguf(view, fileName);
  }

  /* ---------- IndexedDB (single primary model) ---------- */
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      var req = indexedDB.open(IDB_NAME, IDB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IDB open failed')); };
    });
  }

  function idbFinish(db, tx, resolve, reject, value) {
    var done = false;
    function end(err) {
      if (done) return;
      done = true;
      try { db.close(); } catch (_) {}
      if (err) reject(err);
      else resolve(value);
    }
    tx.oncomplete = function () { end(null); };
    tx.onerror = function () { end(tx.error || new Error('IDB transaction failed')); };
    tx.onabort = function () { end(tx.error || new Error('IDB transaction aborted')); };
  }

  async function idbSave(blob, meta) {
    var db = await idbOpen();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, 'readwrite');
      idbFinish(db, tx, resolve, reject, true);
      tx.objectStore(IDB_STORE).put({
        blob: blob,
        name: (meta && meta.name) || 'model.gguf',
        architecture: meta && meta.architecture || '',
        quant: 'Q4_K_M',
        savedAt: Date.now(),
        size: blob && blob.size
      }, IDB_KEY);
    });
  }

  async function idbLoad() {
    var db = await idbOpen();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, 'readonly');
      var req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      var value = null;
      req.onsuccess = function () { value = req.result || null; };
      req.onerror = function () { value = null; };
      idbFinish(db, tx, function () { resolve(value); }, reject, null);
    });
  }

  async function idbClear() {
    try {
      var db = await idbOpen();
      return await new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        idbFinish(db, tx, resolve, reject, true);
        tx.objectStore(IDB_STORE).delete(IDB_KEY);
      });
    } catch (_) {
      return false;
    }
  }

  /* ---------- wllama runtime: vendored first, CDN fallback ---------- */
  function importWllamaOnce() {
    if (wllamaImportPromise) return wllamaImportPromise;
    var localJs = toAbsoluteUrl('models/wllama.js');
    function take(mod, kind) {
      var Ctor = mod && (mod.Wllama || (mod.default && mod.default.Wllama) || mod.default);
      if (!Ctor) throw new Error('Wllama export missing');
      runtimeKind = kind;
      return Ctor;
    }
    wllamaImportPromise = import(localJs).then(function (mod) {
      return take(mod, 'vendored');
    }).catch(function () {
      return import(CDN_BASE + '/index.js').then(function (mod) {
        return take(mod, 'cdn');
      });
    }).catch(function (e) {
      wllamaImportPromise = null;
      runtimeKind = 'none';
      throw e;
    });
    return wllamaImportPromise;
  }

  function wasmPaths() {
    if (runtimeKind === 'vendored') {
      return { 'single-thread/wllama.wasm': toAbsoluteUrl('models/wllama.wasm') };
    }
    return {
      'single-thread/wllama.wasm': CDN_BASE + '/single-thread/wllama.wasm',
      'multi-thread/wllama.wasm': CDN_BASE + '/multi-thread/wllama.wasm'
    };
  }

  async function ensureWllamaInstance() {
    if (wllama) {
      if (modelReady) return wllama;
      await destroyWllama();
    }
    if (typeof WebAssembly === 'undefined') throw new Error('WebAssembly is not available in this WebView');
    var WllamaCtor = await importWllamaOnce();
    wllama = new WllamaCtor(wasmPaths(), {
      parallelDownloads: 1,
      allowOffline: true,
      logger: { debug: function () {}, log: function () {}, warn: function () {}, error: function () {} }
    });
    return wllama;
  }

  async function destroyWllama() {
    var inst = wllama;
    wllama = null;
    modelReady = false;
    loadedInfo = null;
    try {
      if (inst && typeof inst.exit === 'function') await inst.exit();
    } catch (_) {}
  }

  function checkLoaded(inst) {
    try {
      if (typeof inst.isModelLoaded === 'function') return !!inst.isModelLoaded();
    } catch (_) {}
    return true;
  }

  async function loadModelBlobs(blobs, label, info) {
    var total = 0;
    for (var i = 0; i < blobs.length; i++) total += blobs[i].size || 0;
    assertFits(total);
    status = 'loading';
    progress = 0.55;
    lastError = null;
    modelLabel = label || 'Q4_K_M.gguf';
    emit();
    var inst = await ensureWllamaInstance();
    var ctx = pickCtx(info, total);
    progress = 0.7;
    emit();
    try {
      await inst.loadModel(blobs, {
        n_ctx: ctx,
        n_threads: 1,
        n_batch: 128,
        embeddings: false
      });
    } catch (e) {
      var msg = String(e && e.message || e);
      await destroyWllama();
      if (runtimeKind === 'vendored' && /wasm|fetch|compile|network|mime/i.test(msg)) {
        wllamaImportPromise = null;
        runtimeKind = 'cdn-forced';
        wllamaImportPromise = import(CDN_BASE + '/index.js').then(function (mod) {
          var Ctor = mod.Wllama || (mod.default && mod.default.Wllama) || mod.default;
          if (!Ctor) throw new Error('Wllama export missing from CDN');
          runtimeKind = 'cdn';
          return Ctor;
        });
        inst = await ensureWllamaInstance();
        try {
          await inst.loadModel(blobs, {
            n_ctx: ctx,
            n_threads: 1,
            n_batch: 128,
            embeddings: false
          });
        } catch (e2) {
          await destroyWllama();
          throw e2;
        }
      } else {
        throw e;
      }
    }
    if (!checkLoaded(inst)) {
      await destroyWllama();
      throw new Error('loadModel finished but the model is not loaded');
    }
    loadedInfo = info || { quant: 'Q4_K_M', name: modelLabel };
    loadedInfo.nCtx = ctx;
    modelReady = true;
    status = 'ready';
    progress = 1;
    lastError = null;
    emit();
    return getStatus();
  }

  async function acceptBlobs(blobs, label) {
    if (!blobs || !blobs.length) throw new Error('No GGUF data');
    var info = await inspectBlob(blobs[0], label);
    if (!info.ok) {
      var err = new Error(info.error || 'Not a Q4_K_M GGUF');
      err.gguf = info;
      throw err;
    }
    var pretty = (info.name || label || 'model') + '';
    if (!/\.gguf$/i.test(pretty)) pretty += ' Q4_K_M';
    return loadModelBlobs(blobs, pretty, info);
  }

  async function loadFromFile(file) {
    if (!file) throw new Error('No file selected');
    if (loadPromise) {
      try { await loadPromise; } catch (_) {}
    }
    await destroyWllama();
    status = 'loading';
    progress = 0.05;
    lastError = null;
    modelLabel = file.name || 'local.gguf';
    emit();

    loadPromise = (async function () {
      try {
        var blob = file instanceof Blob ? file : new Blob([file], { type: 'application/octet-stream' });
        var st = await acceptBlobs([blob], file.name || 'local.gguf');
        try { await idbSave(blob, { name: file.name || modelLabel, architecture: loadedInfo && loadedInfo.architecture }); }
        catch (cacheErr) { console.warn('GGUF IDB cache failed', cacheErr); }
        return st;
      } catch (e) {
        lastError = String(e && e.message || e);
        status = 'error';
        modelReady = false;
        await destroyWllama();
        emit();
        throw e;
      } finally {
        loadPromise = null;
      }
    })();
    return loadPromise;
  }

  function shardUrls(firstUrl) {
    var m = String(firstUrl).match(/-(\d{5})-of-(\d{5})\.gguf(\?[^#]*)?$/i);
    if (!m) return [firstUrl];
    var total = parseInt(m[2], 10);
    if (!total || total < 2 || total > 32 || m[1] !== '00001') return [firstUrl];
    var base = firstUrl.replace(/-(\d{5})-of-(\d{5})\.gguf(\?[^#]*)?$/i, '');
    var q = m[3] || '';
    var out = [];
    for (var i = 1; i <= total; i++) {
      var id = String(i);
      while (id.length < 5) id = '0' + id;
      out.push(base + '-' + id + '-of-' + m[2] + '.gguf' + q);
    }
    return out;
  }

  function concatBytes(chunks, maxLen) {
    var got = 0;
    for (var i = 0; i < chunks.length; i++) got += chunks[i].byteLength;
    var n = maxLen ? Math.min(got, maxLen) : got;
    var out = new Uint8Array(n);
    var o = 0;
    for (var j = 0; j < chunks.length && o < n; j++) {
      var c = chunks[j];
      var take = Math.min(c.byteLength, n - o);
      out.set(take === c.byteLength ? c : c.subarray(0, take), o);
      o += take;
    }
    return out;
  }

  async function fetchPrefix(url, n) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, 20000) : null;
    try {
      var res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { Range: 'bytes=0-' + (n - 1) },
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!(res.status === 200 || res.status === 206)) return null;
      if (!res.body || !res.body.getReader) {
        var ab = await res.arrayBuffer();
        return new Uint8Array(ab).subarray(0, n);
      }
      var reader = res.body.getReader();
      var chunks = [];
      var got = 0;
      while (got < n) {
        var step = await reader.read();
        if (step.done) break;
        chunks.push(step.value);
        got += step.value.byteLength;
      }
      try { await reader.cancel(); } catch (_) {}
      return concatBytes(chunks, n);
    } catch (_) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fetchBlob(url, onProgress) {
    var res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) throw new Error('GET ' + res.status + ' for ' + fileBaseName(url));
    var total = Number(res.headers.get('Content-Length') || res.headers.get('content-length') || 0);
    if (!res.body || typeof res.body.getReader !== 'function') {
      var blob = await res.blob();
      if (onProgress) onProgress(blob.size, blob.size);
      return blob;
    }
    var reader = res.body.getReader();
    var chunks = [];
    var got = 0;
    while (true) {
      var step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      got += step.value.byteLength;
      if (onProgress) onProgress(got, total || got);
    }
    return new Blob(chunks, { type: 'application/octet-stream' });
  }

  async function probeMagic(url) {
    var prefix = await fetchPrefix(url, 16);
    if (!prefix || prefix.byteLength < 4) return false;
    return prefix[0] === 0x47 && prefix[1] === 0x47 && prefix[2] === 0x55 && prefix[3] === 0x46;
  }

  async function discoverModelUrls() {
    var urls = [];
    var seen = {};
    function add(name) {
      if (!name || seen[name]) return;
      if (!nameIsQ4KM(name)) return;
      var shard = name.match(/-(\d{5})-of-(\d{5})\.gguf$/i);
      if (shard && shard[1] !== '00001') return;
      seen[name] = true;
      var abs = toAbsoluteUrl('models/' + name);
      if (abs) urls.push(abs);
    }
    var listed = false;
    if (pageIsHttp()) {
      try {
        var indexUrl = toAbsoluteUrl('models/');
        var res = await fetch(indexUrl, { method: 'GET', cache: 'no-store' });
        if (res.ok) {
          listed = true;
          var text = await res.text();
          var re = /href\s*=\s*["']([^"']+)["']/gi;
          var m;
          while ((m = re.exec(text))) {
            add(fileBaseName(m[1]));
          }
          var re2 = /([A-Za-z0-9._+\-]*q4[_\-.]?k[_\-.]?m(?:-\d{5}-of-\d{5})?\.gguf)/gi;
          while ((m = re2.exec(text))) add(m[1]);
        }
      } catch (_) {}
      // Only guess a filename when the server will not list models/.
      // A listed directory with no Q4_K_M file must not 404 a hardcoded path.
      if (!listed && !urls.length) {
        var guess = toAbsoluteUrl('models/LFM2.5-350M-Q4_K_M.gguf');
        if (guess && await probeMagic(guess)) urls.push(guess);
      }
    }
    return urls;
  }

  /**
   * Download a Q4_K_M GGUF with GET (never HEAD / loadModelFromUrl) and load it.
   * Resolves to a status object. Does not throw.
   */
  async function loadFromUrl(url, opts) {
    opts = opts || {};
    var abs = toAbsoluteUrl(url);
    if (!abs || !/^https?:/i.test(abs)) {
      lastError = 'Need an http(s) URL for the GGUF';
      status = 'error';
      emit();
      return getStatus();
    }
    if (loadPromise && !opts.nested) {
      try { await loadPromise; } catch (_) {}
    }
    await destroyWllama();
    var label = fileBaseName(abs);
    status = 'loading';
    progress = 0.02;
    lastError = null;
    modelLabel = label;
    emit();

    var work = (async function () {
      try {
        var parts = shardUrls(abs);
        var prefix = await fetchPrefix(parts[0], HEADER_SCAN);
        if (!prefix || prefix.byteLength < 4) {
          throw new Error('Model URL not reachable. Put the .gguf in models/ or use Load GGUF file.');
        }
        var preInfo = inspectGguf(bytesToView(prefix), label);
        if (!preInfo.ok && preInfo.hard) throw new Error(preInfo.error);
        var blobs = [];
        for (var i = 0; i < parts.length; i++) {
          var blob = await fetchBlob(parts[i], function (loaded, total) {
            var span = 0.7 / parts.length;
            var frac = total ? (loaded / total) : 0;
            progress = 0.08 + span * i + span * Math.min(1, frac);
            emit();
          });
          blobs.push(blob);
        }
        var st = await acceptBlobs(blobs, label);
        if (blobs.length === 1) {
          try { await idbSave(blobs[0], { name: label, architecture: loadedInfo && loadedInfo.architecture }); }
          catch (cacheErr) { console.warn('GGUF IDB cache failed', cacheErr); }
        }
        return st;
      } catch (e) {
        lastError = String(e && e.message || e);
        status = 'error';
        modelReady = false;
        try { await destroyWllama(); } catch (_) {}
        emit();
        return getStatus();
      } finally {
        if (loadPromise === work) loadPromise = null;
      }
    })();
    if (!opts.nested) loadPromise = work;
    return work;
  }

  async function loadFromIdb() {
    var rec = await idbLoad();
    if (!rec || !rec.blob) return null;
    var name = rec.name || 'cached.gguf';
    var info = await inspectBlob(rec.blob, name);
    if (!info.ok) {
      try { await idbClear(); } catch (_) {}
      return null;
    }
    modelLabel = info.name || name;
    status = 'loading';
    progress = 0.15;
    emit();
    return loadModelBlobs([rec.blob], modelLabel, info);
  }

  /**
   * Boot / explicit load.
   *   1. opts.file
   *   2. opts.url
   *   3. IndexedDB cache
   *   4. models/*Q4_K_M.gguf via GET when opts.autoloadModels or opts.force on http
   * Never throws.
   */
  async function load(opts) {
    opts = opts || {};
    if (modelReady && !opts.force) return getStatus();
    if (opts.force && modelReady) {
      try { await destroyWllama(); } catch (_) {}
    }
    if (opts.file) {
      try { return await loadFromFile(opts.file); }
      catch (_) { return getStatus(); }
    }
    if (opts.url) return loadFromUrl(opts.url, opts);
    if (loadPromise) {
      try { await loadPromise; } catch (_) {}
      if (modelReady) return getStatus();
    }

    loadPromise = (async function () {
      try {
        var fromCache = await loadFromIdb();
        if (fromCache && fromCache.hasGgufRuntime) return fromCache;
      } catch (e) {
        lastError = String(e && e.message || e);
        try { await destroyWllama(); } catch (_) {}
      }
      var shouldTryUrl = opts.autoloadModels === true || (opts.force === true && pageIsHttp());
      if (shouldTryUrl && pageIsHttp()) {
        var list = [];
        try { list = await discoverModelUrls(); } catch (_) { list = []; }
        for (var i = 0; i < list.length; i++) {
          var st = await loadFromUrl(list[i], { nested: true });
          if (st && st.hasGgufRuntime) return st;
        }
        if (!modelReady) {
          lastError = lastError || 'No *.Q4_K_M.gguf in models/ or IndexedDB.';
        }
      } else if (!modelReady && !lastError) {
        lastError = 'Load a *.Q4_K_M.gguf from Settings. It is kept in IndexedDB for the next open.';
      }
      status = modelReady ? 'ready' : (opts.force ? 'error' : 'unavailable');
      if (!modelReady) modelLabel = 'none';
      emit();
      return getStatus();
    })();
    try {
      return await loadPromise;
    } finally {
      loadPromise = null;
    }
  }

  function bootAutoLoad() {
    if (bootStarted) return;
    bootStarted = true;
    status = 'unavailable';
    modelLabel = 'none';
    emit();
    setTimeout(function () {
      var p = load({ force: false, autoloadModels: pageIsHttp() });
      if (p && typeof p.then === 'function') {
        p.then(function (st) {
          emit();
          try {
            document.dispatchEvent(new CustomEvent('athuex:local-status', { detail: st }));
          } catch (_) {}
        }).catch(function () {
          status = 'error';
          emit();
        });
      }
    }, 400);
  }

  function initStatus() {
    if (!modelReady && status !== 'loading') {
      status = lastError ? 'error' : 'unavailable';
      if (!modelLabel || modelLabel === 'offline-agent') modelLabel = 'none';
    }
    emit();
    return getStatus();
  }

  function buildLocalSystem(extra) {
    var label = modelLabel && modelLabel !== 'none' ? modelLabel : 'Q4_K_M';
    var arch = loadedInfo && loadedInfo.architecture ? (' / ' + loadedInfo.architecture) : '';
    var sys = 'You are Athuex Local, running the GGUF model ' + label + arch +
      '. Answer directly and concisely. Local mode has no live tool execution; describe what tools would do if needed. For tool actions, switch to HYB/EXT (cloud) mode.';
    try {
      if (window.SG && SG.tools && typeof SG.tools.list === 'function') {
        var names = SG.tools.list().filter(function (t) { return t && t.enabled !== false; }).map(function (t) { return t.name; }).sort();
        if (names.length) sys += '\n\n## Available tools (cloud/HYB only)\n' + names.slice(0, 40).join(', ');
      }
    } catch (_) {}
    try {
      if (window.SG && SG.programs && typeof SG.programs.list === 'function') {
        var pids = SG.programs.list().map(function (p) { return p.id; }).filter(Boolean).sort();
        if (pids.length) sys += '\n\n## Active programs\n' + pids.join(', ');
      }
    } catch (_) {}
    if (window.SG && SG.memory && typeof SG.memory.getContext === 'function') {
      try {
        var ctx = SG.memory.getContext();
        if (ctx) sys += '\n\n## Memory\n' + ctx;
      } catch (_) {}
    }
    if (extra) sys += '\n\n' + extra;
    return sys;
  }

  function manualPrompt(messages) {
    var out = '';
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var role = m.role === 'assistant' ? 'Assistant' : (m.role === 'system' ? 'System' : 'User');
      out += role + ':\n' + String(m.content || '') + '\n\n';
    }
    out += 'Assistant:\n';
    return out;
  }

  function trimMessages(msgs, ctx) {
    var maxChars = Math.max(800, ((ctx || 2048) - 384) * 3);
    var out = msgs.slice();
    function size() {
      var n = 0;
      for (var i = 0; i < out.length; i++) n += String(out[i].content || '').length + 16;
      return n;
    }
    while (out.length > 2 && size() > maxChars) {
      var idx = (out[0] && out[0].role === 'system') ? 1 : 0;
      if (idx >= out.length - 1) break;
      out.splice(idx, 1);
    }
    return out;
  }

  function isAbortError(e) {
    if (!e) return false;
    var name = e.name || '';
    if (name === 'AbortError' || name === 'WllamaAbortError') return true;
    return /operation aborted|abort/i.test(String(e.message || ''));
  }

  async function completeWithGguf(messages, opts) {
    if (!wllama || !modelReady) throw new Error('GGUF not ready');
    opts = opts || {};
    if (opts.signal && opts.signal.aborted) {
      throw Object.assign(new Error('Stopped'), { name: 'AbortError' });
    }
    var chatMsgs = [];
    var hasSystem = false;
    (messages || []).forEach(function (m) {
      if (!m) return;
      var role = m.role === 'assistant' ? 'assistant' : (m.role === 'system' ? 'system' : 'user');
      if (role === 'system') {
        if (hasSystem) return;
        hasSystem = true;
      }
      var content = String(m.content || '').trim();
      if (!content) return;
      chatMsgs.push({ role: role, content: content });
    });
    if (!hasSystem) chatMsgs.unshift({ role: 'system', content: buildLocalSystem() });
    var ctx = (loadedInfo && loadedInfo.nCtx) || 2048;
    chatMsgs = trimMessages(chatMsgs, ctx);

    var prompt = null;
    if (typeof wllama.formatChat === 'function') {
      try { prompt = await wllama.formatChat(chatMsgs, true); } catch (_) { prompt = null; }
    }
    if (!prompt || !String(prompt).trim()) prompt = manualPrompt(chatMsgs);

    var acc = '';
    var raw = await wllama.createCompletion(prompt, {
      nPredict: opts.maxTokens || 384,
      sampling: { temp: 0.6, top_k: 40, top_p: 0.9, penalty_repeat: 1.1, penalty_last_n: 64 },
      abortSignal: opts.signal,
      onNewToken: function (_token, _piece, currentText) {
        acc = currentText || acc;
        if (typeof opts.onDelta === 'function') {
          try { opts.onDelta(acc); } catch (_) {}
        }
      }
    });
    var out = typeof raw === 'string' ? raw : (raw && (raw.text || raw.content)) || acc;
    out = String(out || acc || '').trim();
    if (!out) throw new Error('Empty GGUF completion');
    return { message: { role: 'assistant', content: out }, backend: 'wllama-gguf' };
  }

  async function complete(messages, opts) {
    opts = opts || {};
    if (loadPromise) {
      try { await loadPromise; } catch (_) {}
    }
    if (!(modelReady && wllama)) {
      return {
        message: null,
        backend: 'unavailable',
        error: lastError || 'Q4_K_M GGUF is not loaded'
      };
    }
    try {
      return await completeWithGguf(messages, opts);
    } catch (e) {
      if (isAbortError(e) || (opts.signal && opts.signal.aborted)) throw e;
      var msg = String(e && e.message || e);
      lastError = msg;
      var still = false;
      try { still = !!(wllama && typeof wllama.isModelLoaded === 'function' && wllama.isModelLoaded()); } catch (_) {}
      if (!still) {
        modelReady = false;
        status = 'error';
        emit();
      }
      return {
        message: {
          role: 'assistant',
          content: 'Local GGUF error: ' + msg +
            (still ? ' Model is still loaded — try a shorter prompt.' : ' Reload the GGUF from Settings.')
        },
        backend: 'error',
        error: msg
      };
    }
  }

  function isReady() {
    return !!modelReady;
  }

  initStatus();

  SG.localAI = {
    VERSION: VERSION,
    load: load,
    loadFromFile: loadFromFile,
    loadFromUrl: loadFromUrl,
    bootAutoLoad: bootAutoLoad,
    initStatus: initStatus,
    complete: complete,
    getStatus: getStatus,
    onStatus: onStatus,
    buildLocalSystem: buildLocalSystem,
    isReady: isReady,
    toAbsoluteUrl: toAbsoluteUrl,
    clearCache: idbClear,
    inspectGguf: inspectGguf
  };
})(window.SG = window.SG || {});
