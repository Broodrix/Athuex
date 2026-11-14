/* Athuex settings — single source of truth + legacy migration — v1.0.2 */
(function (SG) {
  'use strict';
  const KEY = 'athuex.settings';
  const LEGACY = [
    'sg.settings_v137', 'sg.settings_v136', 'sg.settings_v135', 'sg.settings_v134',
    'sg.settings_v133', 'sg.settings_v132', 'sg.settings_v130', 'sg.settings_v129',
    'sg.settings_v128', 'sg.settings_v127', 'sg.settings_v126', 'sg.settings_v125',
    'sg.settings_v123', 'sg.settings_v122', 'sg.settings_v121', 'sg.settings_v120', 'sg.settings_v115'
  ];

  function load() {
    try {
      let raw = localStorage.getItem(KEY);
      if (!raw) {
        for (let i = 0; i < LEGACY.length; i++) {
          raw = localStorage.getItem(LEGACY[i]);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              parsed.schema = 1;
              localStorage.setItem(KEY, JSON.stringify(parsed));
            } catch (_) {}
            break;
          }
        }
      }
      const s = raw ? JSON.parse(raw) : {};
      if (s.schema == null) s.schema = 1;
      if (s.schema < 2) {
        s.planMode = false;
        s.schema = 2;
        try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {}
      }
      return s;
    } catch (_) {
      return { schema: 1 };
    }
  }

  /**
   * Merge with existing settings so partial saves (Settings form) do not
   * wipe keys written by other modules (searchKeys, mcpUrl, serperKey, etc.).
   */
  function save(s) {
    try {
      let prev = {};
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) prev = JSON.parse(raw) || {};
      } catch (_) {}
      const merged = Object.assign({ schema: 1 }, prev, s || {});
      localStorage.setItem(KEY, JSON.stringify(merged));
      return true;
    } catch (_) {
      return false;
    }
  }

  function get(key, fallback) {
    const s = load();
    return s[key] != null ? s[key] : fallback;
  }

  function set(key, value) {
    const s = load();
    s[key] = value;
    save(s);
    return s;
  }

  SG.settings = { KEY: KEY, load: load, save: save, get: get, set: set };
})(window.SG = window.SG || {});