/* IDE module: shared state + session persistence. See programsRegistry.register() in programs/ide.js */
(function (SG) {
  'use strict';
  SG.ide = SG.ide || {};

  var state = {
    tabs: [],
    activeTabId: null,
    prefs: null,
    expanded: {},
    hostInitialContent: null,
    dom: null,
    global: null,
    session: null,
    restored: false,
    bound: false,
    cleanup: [],
    suppressInput: false,
    lastTokens: null,
    lastCode: '',
    paletteCommands: [],
    paletteCommandsAll: [],
    paletteIndex: 0,
    paletteMode: 'command',
    find: { query: '', replace: '', caseSensitive: false, regex: false, matches: [], index: -1 },
    completion: { items: [], index: 0, prefix: '', start: 0 }
  };

  var sessionTimer = null;
  var autoSaveTimer = null;

  function cfg() { return SG.ide.config; }

  function emit(name, detail) {
    try {
      document.dispatchEvent(new CustomEvent('sg:ide:' + name, { detail: detail }));
    } catch (_) {}
  }

  function loadPrefs() {
    var parsed = {};
    try { parsed = JSON.parse(localStorage.getItem(cfg().PREFS_KEY) || '{}') || {}; } catch (_) {}
    var defaults = cfg().DEFAULT_PREFS;
    var out = {};
    Object.keys(defaults).forEach(function (k) {
      out[k] = parsed[k] !== undefined ? parsed[k] : defaults[k];
    });
    if (parsed.languageOverrides && typeof parsed.languageOverrides === 'object') {
      out.languageOverrides = parsed.languageOverrides;
    }
    out.theme = out.theme === 'light' ? 'light' : 'dark';
    out.fontSize = SG.ide.utils.clamp(out.fontSize, 10, 24);
    out.wrap = !!out.wrap;
    out.lineNumbers = out.lineNumbers !== false;
    out.autoSave = out.autoSave !== false;
    out.sidebar = out.sidebar !== false;
    return out;
  }

  function savePrefs() {
    try { localStorage.setItem(cfg().PREFS_KEY, JSON.stringify(state.prefs)); } catch (_) {}
  }

  function readSession() {
    try {
      var raw = localStorage.getItem(cfg().SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) { return null; }
  }

  function saveSession() {
    if (!state.dom) return;
    var tabs = state.tabs.map(function (t) {
      return {
        id: t.id, path: t.path, name: t.name, language: t.language,
        dirty: !!t.dirty, pinned: !!t.pinned,
        cursor: t.cursor || null,
        scrollTop: t.scrollTop || 0,
        content: t.dirty && t.content.length < 100000 ? t.content : ''
      };
    });
    try {
      localStorage.setItem(cfg().SESSION_KEY, JSON.stringify({
        version: cfg().VERSION,
        tabs: tabs,
        activeTabId: state.activeTabId,
        prefs: state.prefs,
        expanded: state.expanded
      }));
    } catch (_) {}
  }

  function saveSessionDebounced() {
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(saveSession, 350);
  }

  function flush() {
    try {
      if (state.dom && state.dom.ta && state.activeTabId) {
        var tab = state.tabs.filter(function (t) { return t.id === state.activeTabId; })[0];
        if (tab) {
          tab.content = state.dom.ta.value;
          SG.ide.vfs.write(tab.path, tab.content, { silent: true });
        }
      }
      SG.ide.vfs.save();
      saveSession();
    } catch (_) {}
  }

  function importHostFiles() {
    var host = SG.workspace || {};
    var src = host.files || host.vfs || null;
    if (!src || typeof src !== 'object') return;
    var vfs = SG.ide.vfs;
    Object.keys(src).forEach(function (p) {
      var v = src[p];
      var content = typeof v === 'string' ? v : (v && typeof v.content === 'string' ? v.content : null);
      if (content != null && !vfs.exists(p)) vfs.write(p, content, { silent: true });
    });
    vfs.save();
  }

  function loadState() {
    SG.ide.vfs.load();
    state.prefs = loadPrefs();
    state.session = readSession();
    if (state.session && state.session.expanded) state.expanded = state.session.expanded;
    importHostFiles();
  }

  function restoreTabs() {
    var cfgv = cfg();
    var vfs = SG.ide.vfs;
    var tabs = SG.ide.tabs;
    var restored = [];

    if (state.session && Array.isArray(state.session.tabs) && state.session.tabs.length) {
      state.session.tabs.forEach(function (t) {
        var path = SG.ide.utils.normalizePath(t.path || t.name || 'untitled.txt');
        var content = null;
        if (t.dirty && typeof t.content === 'string') content = t.content;
        if (content == null) content = vfs.read(path);
        if (content == null) content = typeof t.content === 'string' ? t.content : '';
        var tab = tabs.makeTab(path, content, {
          id: t.id, language: t.language, dirty: !!t.dirty, pinned: !!t.pinned,
          cursor: t.cursor, scrollTop: t.scrollTop
        });
        restored.push(tab);
        if (!vfs.exists(path)) vfs.write(path, content, { silent: true });
      });
    }

    if (!restored.length) {
      if (state.hostInitialContent) {
        var hp = 'untitled-1.txt';
        vfs.write(hp, state.hostInitialContent);
        restored.push(tabs.makeTab(hp, state.hostInitialContent, { dirty: true }));
      } else {
        var wp = 'welcome.md';
        if (!vfs.exists(wp)) vfs.write(wp, cfgv.WELCOME_MD, { silent: true });
        restored.push(tabs.makeTab(wp, vfs.read(wp) || ''));
      }
    }

    state.tabs = restored;
    var wanted = state.session && state.session.activeTabId;
    state.activeTabId = (wanted && restored.some(function (t) { return t.id === wanted; })) ? wanted : restored[0].id;

    if (state.session && state.session.prefs) {
      Object.keys(cfg().DEFAULT_PREFS).forEach(function (k) {
        if (state.session.prefs[k] !== undefined) state.prefs[k] = state.session.prefs[k];
      });
      if (state.session.prefs.languageOverrides && typeof state.session.prefs.languageOverrides === 'object') {
        state.prefs.languageOverrides = state.session.prefs.languageOverrides;
      }
    }

    if (!localStorage.getItem(cfg().PREFS_KEY) && window.innerWidth <= 720) state.prefs.sidebar = false;

    state.restored = true;
    vfs.save();
  }

  state.emit = emit;
  state.loadPrefs = loadPrefs;
  state.savePrefs = savePrefs;
  state.readSession = readSession;
  state.saveSession = saveSession;
  state.saveSessionDebounced = saveSessionDebounced;
  state.flush = flush;
  state.loadState = loadState;
  state.restoreTabs = restoreTabs;
  state.importHostFiles = importHostFiles;

  SG.ide.state = state;
})(window.SG = window.SG || {});