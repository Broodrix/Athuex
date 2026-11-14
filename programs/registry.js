/* Athuex Programs Registry — modular navbar chips — v2.5.2 (P1 lifecycle) */
(function (SG) {
  'use strict';
  const VERSION = (typeof window !== 'undefined' && window.ATHUEX_VERSION) || '2.5.2';
  const STORE_KEY = 'sg.programs_v134';
  const MANIFEST_VERSION = 1;
  const registry = new Map();
  const listeners = new Set();
  const loadedSources = new Set();
  /** sourcePath -> { id, version, hash } for reconcile */
  const sourceIndex = new Map();

  function emit(event, detail) {
    listeners.forEach(function (fn) { try { fn(event, detail); } catch (_) {} });
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { order: [], disabled: {}, custom: [], pinned: ['chat'] };
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.pinned)) parsed.pinned = ['chat'];
      // P4: About is not a default pin (migrate prior default chat+about → chat only)
      if (parsed.pinned.length === 2 && parsed.pinned[0] === 'chat' && parsed.pinned[1] === 'about') {
        parsed.pinned = ['chat'];
      }

      if (!Array.isArray(parsed.order)) parsed.order = [];
      if (!parsed.disabled || typeof parsed.disabled !== 'object') parsed.disabled = {};
      if (!Array.isArray(parsed.custom)) parsed.custom = [];
      return parsed;
    } catch (_) {
      return { order: [], disabled: {}, custom: [] };
    }
  }

  function savePrefs(p) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (_) {}
  }

  function normalize(def) {
    if (!def || !def.id) return null;
    const id = String(def.id).replace(/[^a-z0-9_-]/gi, '').toLowerCase().slice(0, 40);
    if (!id) return null;
    return {
      id: id,
      title: String(def.title || id).slice(0, 32),
      icon: def.icon || '<circle cx="12" cy="12" r="8"/>',
      order: Number(def.order) || 100,
      kind: def.kind || 'panel', // panel | dialog | custom
      view: def.view || id,
      panel: def.panel || null,
      dialog: def.dialog || null,
      core: !!def.core,
      source: def.source || 'user',
      sourcePath: def.sourcePath || def.path || '',
      version: def.version || '',
      description: def.description || '',
      content: def.content || '',
      capabilities: Array.isArray(def.capabilities) ? def.capabilities.slice(0, 32) : [],
      onActivate: typeof def.onActivate === 'function' ? def.onActivate : null,
      onTeardown: typeof def.onTeardown === 'function' ? def.onTeardown : null,
      enabled: def.enabled !== false,
      installed: def.installed !== false
    };
  }

  function register(def) {
    const p = normalize(def);
    if (!p) {
      console.warn('[SG.programs] invalid register', def);
      return false;
    }
    const prefs = loadPrefs();
    if (prefs.disabled && prefs.disabled[p.id] === true) p.enabled = false;
    if (prefs.disabled && prefs.disabled[p.id] === false) p.enabled = true;
    registry.set(p.id, p);
    emit('register', { id: p.id });
    return true;
  }

  function unregister(id) {
    id = String(id || '');
    const p = registry.get(id);
    if (!p) return false;
    if (p.core) return false;
    if (typeof p.onTeardown === 'function') {
      try { p.onTeardown(p); } catch (e) { console.warn('[SG.programs] teardown', id, e); }
    }
    if (p.sourcePath) sourceIndex.delete(p.sourcePath);
    registry.delete(id);
    const prefs = loadPrefs();
    prefs.custom = (prefs.custom || []).filter(function (c) { return c.id !== id; });
    if (prefs.order) prefs.order = prefs.order.filter(function (x) { return x !== id; });
    if (Array.isArray(prefs.pinned)) prefs.pinned = prefs.pinned.filter(function (x) { return x !== id; });
    savePrefs(prefs);
    emit('unregister', { id: id });
    return true;
  }

  function activate(id) {
    id = String(id || '');
    const p = registry.get(id);
    if (!p) return false;
    if (typeof p.onActivate === 'function') {
      try { p.onActivate(p); } catch (_) {}
    }
    try {
      window.dispatchEvent(new CustomEvent('athuex:open-program', { detail: { id: p.id, view: p.view || p.id } }));
    } catch (_) {}
    emit('activate', { id: p.id });
    return true;
  }

  function enable(id, on) {
    const p = registry.get(String(id));
    if (!p) return false;
    p.enabled = on !== false;
    const prefs = loadPrefs();
    if (!prefs.disabled) prefs.disabled = {};
    prefs.disabled[p.id] = !p.enabled;
    savePrefs(prefs);
    emit('enable', { id: p.id, enabled: p.enabled });
    return true;
  }

  function setOrder(ids) {
    const prefs = loadPrefs();
    prefs.order = (ids || []).map(String);
    savePrefs(prefs);
    emit('order', { order: prefs.order });
  }

  function isPinned(id) {
    const prefs = loadPrefs();
    return (prefs.pinned || []).indexOf(String(id)) >= 0;
  }

  function pin(id) {
    id = String(id || '');
    if (!registry.has(id)) return false;
    const prefs = loadPrefs();
    if (!Array.isArray(prefs.pinned)) prefs.pinned = ['chat'];
    if (prefs.pinned.indexOf(id) < 0) prefs.pinned.push(id);
    savePrefs(prefs);
    emit('pin', { id: id, pinned: true });
    return true;
  }

  function unpin(id) {
    id = String(id || '');
    const prefs = loadPrefs();
    if (!Array.isArray(prefs.pinned)) prefs.pinned = ['chat'];
    if (id === 'chat') return false;
    const before = prefs.pinned.length;
    prefs.pinned = prefs.pinned.filter(function (x) { return x !== id; });
    savePrefs(prefs);
    if (prefs.pinned.length !== before) emit('pin', { id: id, pinned: false });
    return prefs.pinned.length !== before;
  }

  function pinnedList() {
    const prefs = loadPrefs();
    const ids = Array.isArray(prefs.pinned) ? prefs.pinned : ['chat'];
    return ids.map(function (id) { return registry.get(id); }).filter(function (p) { return !!p && p.enabled; });
  }

  function list() {
    const prefs = loadPrefs();
    const order = prefs.order || [];
    const items = Array.from(registry.values());
    items.sort(function (a, b) {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      const oa = ia >= 0 ? ia : 1000 + (a.order || 100);
      const ob = ib >= 0 ? ib : 1000 + (b.order || 100);
      return oa - ob || a.title.localeCompare(b.title);
    });
    return items;
  }

  function get(id) {
    return registry.get(String(id)) || null;
  }

  /** Enabled panel programs in display order (for swipe). */
  function panelViews() {
    // Only fixed panels belong in swipe VIEWS — custom programs use the host overlay
    return list().filter(function (p) {
      return p.enabled && p.kind === 'panel';
    });
  }

  function loadFromSource(id, source) {
    return new Promise(function (resolve, reject) {
      try {
        var src = String(source || '');
        if (!src.trim()) return reject(new Error('empty source'));
        // Prefer synchronous text script injection — works on mobile file:// and QuickEdit WebViews
        // where blob: URLs often fail silently.
        var s = document.createElement('script');
        s.type = 'text/javascript';
        s.setAttribute('data-sg-program', String(id));
        s.text = src + '\n//# sourceURL=program:' + String(id).replace(/[^\w./:#-]/g, '_');
        document.head.appendChild(s);
        // Keep node briefly for debugging; remove to avoid DOM bloat
        setTimeout(function () { try { s.remove(); } catch (_) {} }, 0);
        loadedSources.add(String(id).split('#')[0]);
        emit('load', { id: id });
        resolve(true);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function scanWorkspace(filesMap, opts) {
    if (!filesMap || typeof filesMap !== 'object') return [];
    opts = opts || {};
    var force = opts.force !== false;
    var loaded = [];
    var seenPaths = {};
    var paths = Object.keys(filesMap).filter(function (p) {
      var n = p.replace(/\\/g, '/');
      var low = n.toLowerCase();
      if (!low.endsWith('.js')) return false;
      if (low.indexOf('programs/') >= 0) return true;
      if (low.endsWith('.program.js')) return true;
      var body = filesMap[p];
      if (typeof body !== 'string') return false;
      return /programsRegistry\s*\.|SG_REGISTER_PROGRAM|SG\.programsRegistry/.test(body);
    });
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      var content = filesMap[p];
      if (typeof content !== 'string' || content.length < 20) continue;
      if (!/programsRegistry\.register|SG_REGISTER_PROGRAM|\.register\s*\(/.test(content)) continue;
      var normPath = p.replace(/\\/g, '/');
      seenPaths[normPath] = true;
      var id = 'vfs:' + normPath;
      if (!force && loadedSources.has(id)) {
        sourceIndex.set(normPath, { id: id, version: '', path: normPath });
        continue;
      }
      try {
        if (force) loadedSources.delete(id);
        var loadId = force ? (id + '#' + Date.now()) : id;
        await loadFromSource(loadId, content);
        loadedSources.add(id);
        sourceIndex.set(normPath, { id: id, version: '', path: normPath });
        // Tag last registered non-core with sourcePath when possible
        var items = Array.from(registry.values());
        for (var j = items.length - 1; j >= 0; j--) {
          if (!items[j].core && !items[j].sourcePath) {
            items[j].sourcePath = normPath;
            items[j].installed = true;
            break;
          }
        }
        loaded.push(p);
      } catch (e) {
        console.warn('[SG.programs] scan skip', p, e);
      }
    }
    // Reconcile deletions: user programs whose sourcePath vanished
    if (opts.reconcile !== false) {
      Array.from(registry.values()).forEach(function (prog) {
        if (prog.core || !prog.sourcePath) return;
        if (!seenPaths[prog.sourcePath] && !Object.prototype.hasOwnProperty.call(filesMap, prog.sourcePath)) {
          try { unregister(prog.id); } catch (_) {}
        }
      });
    }
    emit('scan', { loaded: loaded.slice(), count: loaded.length });
    return loaded;
  }

  function saveCustom(def) {
    const p = normalize(Object.assign({}, def, { core: false, source: 'user', kind: def.kind || 'custom' }));
    if (!p) return null;
    register(p);
    const prefs = loadPrefs();
    prefs.custom = (prefs.custom || []).filter(function (c) { return c.id !== p.id; });
    prefs.custom.push({
      id: p.id, title: p.title, icon: p.icon, order: p.order,
      kind: p.kind, view: p.view, content: p.content, description: p.description
    });
    if (!prefs.order) prefs.order = [];
    if (prefs.order.indexOf(p.id) < 0) prefs.order.push(p.id);
    savePrefs(prefs);
    return p;
  }

  function restoreCustoms() {
    const prefs = loadPrefs();
    (prefs.custom || []).forEach(function (c) {
      register(Object.assign({}, c, { source: 'user', core: false }));
    });
  }

  function on(fn) {
    if (typeof fn === 'function') listeners.add(fn);
    return function () { listeners.delete(fn); };
  }

  window.SG_REGISTER_PROGRAM = function (def) {
    if (def && !def.source) def.source = 'user';
    return register(def);
  };

  /** P1 states: available (in registry), installed, enabled, pinned */
  function states() {
    const prefs = loadPrefs();
    const pinned = Array.isArray(prefs.pinned) ? prefs.pinned : ['chat'];
    return list().map(function (p) {
      return {
        id: p.id,
        title: p.title,
        available: true,
        installed: p.installed !== false || !!p.core,
        enabled: !!p.enabled,
        pinned: pinned.indexOf(p.id) >= 0,
        core: !!p.core,
        sourcePath: p.sourcePath || '',
        version: p.version || '',
        capabilities: p.capabilities || []
      };
    });
  }

  function extensionManifest(def) {
    const p = normalize(def || {});
    if (!p) return null;
    return {
      manifestVersion: MANIFEST_VERSION,
      id: p.id,
      title: p.title,
      version: p.version || '0.0.0',
      kind: p.kind,
      capabilities: p.capabilities || [],
      sourcePath: p.sourcePath || '',
      description: p.description || ''
    };
  }

  function validateManifest(m) {
    if (!m || typeof m !== 'object') return { ok: false, error: 'not an object' };
    if (Number(m.manifestVersion) > MANIFEST_VERSION) return { ok: false, error: 'unsupported manifestVersion' };
    if (!m.id || !/^[a-z0-9_-]{1,40}$/i.test(String(m.id))) return { ok: false, error: 'invalid id' };
    return { ok: true, error: null };
  }

  SG.programsRegistry = {
    version: VERSION,
    manifestVersion: MANIFEST_VERSION,
    register: register,
    unregister: unregister,
    pin: pin,
    unpin: unpin,
    isPinned: isPinned,
    pinnedList: pinnedList,
    enable: enable, activate: activate,
    setOrder: setOrder,
    list: list,
    get: get,
    panelViews: panelViews,
    states: states,
    extensionManifest: extensionManifest,
    validateManifest: validateManifest,
    loadFromSource: loadFromSource,
    scanWorkspace: scanWorkspace,
    clearLoadedSources: function () { loadedSources.clear(); },
    saveCustom: saveCustom,
    restoreCustoms: restoreCustoms,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    on: on,
    _map: registry
  };
})(window.SG = window.SG || {});
