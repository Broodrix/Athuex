/* Athuex Harness — P6 adapters v2.5.8
 * Production path for the user's Termux llama.cpp (llama-server).
 * JS plugin lifecycle, sampling profiles, health monitor, workspace plugin scan,
 * modular adapters/ catalog with persistent enable/disable.
 * Native .so logit mutation is NOT enabled in the browser (feature-flagged OFF).
 */
(function (SG) {
  'use strict';
  const VERSION = '2.5.8';
  const FLAG_KEY = 'athuex.harness.experimental_logits';
  const PROFILE_KEY = 'athuex.harness.profile';
  const ADAPTERS_KEY = 'athuex.harness.adapters';

  const plugins = new Map();
  let experimentalLogits = false;
  let healthTimer = null;
  let lastStatus = { ok: false, at: 0, model: '', error: '' };
  let adapterPrefs = {};

  try {
    experimentalLogits = localStorage.getItem(FLAG_KEY) === '1';
  } catch (_) {}

  try {
    const raw = localStorage.getItem(ADAPTERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') adapterPrefs = parsed;
    }
  } catch (_) {}

  function persistAdapterPrefs() {
    try {
      localStorage.setItem(ADAPTERS_KEY, JSON.stringify(adapterPrefs));
    } catch (_) {}
  }

  function setExperimentalLogits(on) {
    experimentalLogits = !!on;
    try { localStorage.setItem(FLAG_KEY, experimentalLogits ? '1' : '0'); } catch (_) {}
    return experimentalLogits;
  }

  function registerPlugin(def) {
    if (!def || !def.id || typeof def.id !== 'string') return false;
    const id = String(def.id).replace(/[^a-z0-9_-]/gi, '').toLowerCase().slice(0, 40);
    if (!id) return false;

    // Adapters default to disabled unless user previously enabled them.
    // Core plugins (source === 'core') default to enabled.
    let enabled;
    if (Object.prototype.hasOwnProperty.call(adapterPrefs, id)) {
      enabled = !!adapterPrefs[id];
    } else if (def.source === 'adapter') {
      enabled = false;
    } else {
      enabled = def.enabled !== false;
    }

    plugins.set(id, {
      id: id,
      version: String(def.version || '0.0.0'),
      description: String(def.description || '').slice(0, 240),
      beforeRequest: typeof def.beforeRequest === 'function' ? def.beforeRequest : null,
      afterResponse: typeof def.afterResponse === 'function' ? def.afterResponse : null,
      onLogits: typeof def.onLogits === 'function' ? def.onLogits : null,
      enabled: enabled,
      source: def.source || 'runtime'
    });
    return true;
  }

  function unregisterPlugin(id) {
    return plugins.delete(String(id || ''));
  }

  function listPlugins() {
    return Array.from(plugins.values()).map(function (p) {
      return {
        id: p.id,
        version: p.version,
        description: p.description,
        enabled: !!p.enabled,
        source: p.source || '',
        hasBefore: !!p.beforeRequest,
        hasAfter: !!p.afterResponse,
        hasLogits: !!p.onLogits
      };
    });
  }

  function listAdapters() {
    return listPlugins().filter(function (p) {
      return p.source === 'adapter' || p.source === 'user';
    });
  }

  function enablePlugin(id, on) {
    const p = plugins.get(String(id));
    if (!p) return false;
    p.enabled = on !== false;
    adapterPrefs[p.id] = p.enabled;
    persistAdapterPrefs();
    try {
      document.dispatchEvent(new CustomEvent('athuex:harness-adapters', {
        detail: { id: p.id, enabled: p.enabled }
      }));
    } catch (_) {}
    return true;
  }

  async function runBefore(req) {
    let out = req || {};
    const list = Array.from(plugins.values()).filter(function (p) { return p.enabled && p.beforeRequest; });
    for (let i = 0; i < list.length; i++) {
      try {
        const r = await list[i].beforeRequest(out);
        if (r && typeof r === 'object') out = r;
      } catch (e) {
        console.warn('[harness] beforeRequest', list[i].id, e);
      }
    }
    return out;
  }

  async function runAfter(res) {
    let out = res || {};
    const list = Array.from(plugins.values()).filter(function (p) { return p.enabled && p.afterResponse; });
    for (let i = 0; i < list.length; i++) {
      try {
        const r = await list[i].afterResponse(out);
        if (r && typeof r === 'object') out = r;
      } catch (e) {
        console.warn('[harness] afterResponse', list[i].id, e);
      }
    }
    return out;
  }

  function applyLogitsExperimental(logits, meta) {
    if (!experimentalLogits || !logits) return logits;
    const arr = logits instanceof Float32Array ? new Float32Array(logits) : Float32Array.from(logits);
    const list = Array.from(plugins.values()).filter(function (p) { return p.enabled && p.onLogits; });
    for (let i = 0; i < list.length; i++) {
      try { list[i].onLogits(arr, meta || {}); } catch (e) {
        console.warn('[harness] onLogits blocked', list[i].id, e);
      }
    }
    for (let i = 0; i < arr.length; i++) {
      if (!isFinite(arr[i])) arr[i] = -Infinity;
    }
    return arr;
  }

  function loadProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object') return p;
      }
    } catch (_) {}
    return {};
  }

  function saveProfile(profile) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile || {})); } catch (_) {}
  }

  function defaultSampling(settings) {
    settings = settings || {};
    const saved = loadProfile();
    function num(key, fallback) {
      if (typeof settings[key] === 'number' && isFinite(settings[key])) return settings[key];
      if (typeof saved[key] === 'number' && isFinite(saved[key])) return saved[key];
      return fallback;
    }
    return {
      temperature: num('temperature', 0.4),
      top_p: num('top_p', 0.9),
      top_k: num('top_k', 40),
      repeat_penalty: num('repeat_penalty', 1.1),
      max_tokens: num('max_tokens', 1024),
      stop: Array.isArray(settings.stop) ? settings.stop : (Array.isArray(saved.stop) ? saved.stop : [])
    };
  }

  async function scanWorkspace(filesMap) {
    if (!filesMap || typeof filesMap !== 'object') return [];
    const loaded = [];
    const paths = Object.keys(filesMap).filter(function (p) {
      const low = p.replace(/\\/g, '/').toLowerCase();
      if (!low.endsWith('.js')) return false;
      if (low.indexOf('harness/') >= 0) return true;
      if (low.indexOf('adapters/') >= 0) return true;
      if (low.endsWith('.harness.js')) return true;
      const body = filesMap[p];
      return typeof body === 'string' && /SG_REGISTER_HARNESS_PLUGIN|SG\.harness\.registerPlugin/.test(body);
    });
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const src = filesMap[path];
      if (typeof src !== 'string' || src.length < 20) continue;
      try {
        const s = document.createElement('script');
        s.type = 'text/javascript';
        s.setAttribute('data-sg-harness', path);
        s.text = src + '\n//# sourceURL=harness:' + path.replace(/[^\w./:#-]/g, '_');
        document.head.appendChild(s);
        setTimeout(function () { try { s.remove(); } catch (_) {} }, 0);
        loaded.push(path);
      } catch (e) {
        console.warn('[harness] scan skip', path, e);
      }
    }
    return loaded;
  }

  async function complete(messages, opts) {
    opts = opts || {};
    if (!SG.llamaServer || typeof SG.llamaServer.complete !== 'function') {
      throw new Error('llama-server bridge missing — load js/ai/llama_server.js');
    }
    const settings = opts.settings || {};
    if (typeof SG.llamaServer.probe === 'function') {
      const h = await SG.llamaServer.probe(settings, !!opts.forceProbe);
      lastStatus = { ok: !!h.ok, at: Date.now(), model: h.model || '', error: h.error || '' };
      if (!h.ok) {
        throw new Error('llama-server offline: ' + (h.error || 'unreachable') +
          '. Start Termux llama-server for offline local inference.');
      }
    }

    let sampling = defaultSampling(Object.assign({}, settings, opts));
    if (opts.sampling && typeof opts.sampling === 'object') {
      sampling = Object.assign(sampling, opts.sampling);
    }

    let req = {
      messages: messages,
      sampling: sampling,
      model: opts.model || settings.llamaServerModel || 'local',
      stream: !!opts.stream,
      meta: { source: 'harness', version: VERSION }
    };
    req = await runBefore(req);

    const result = await SG.llamaServer.complete(req.messages, {
      settings: settings,
      model: req.model,
      temperature: req.sampling.temperature,
      top_p: req.sampling.top_p,
      top_k: req.sampling.top_k,
      repeat_penalty: req.sampling.repeat_penalty,
      max_tokens: req.sampling.max_tokens,
      stop: req.sampling.stop,
      stream: req.stream,
      signal: opts.signal,
      onDelta: opts.onDelta
    });

    let out = {
      message: result.message,
      backend: 'llama-server+harness',
      sampling: req.sampling,
      experimentalLogits: experimentalLogits
    };
    out = await runAfter(out);

    try {
      if (SG.memory && typeof SG.memory.recordTrace === 'function') {
        SG.memory.recordTrace({
          kind: 'harness-complete',
          backend: out.backend,
          summary: String((out.message && out.message.content) || '').slice(0, 200),
          ok: !!(out.message && out.message.content),
          provenance: 'harness'
        });
      }
    } catch (_) {}

    return out;
  }

  function status(settings) {
    const server = SG.llamaServer && SG.llamaServer.getLastHealth
      ? SG.llamaServer.getLastHealth()
      : lastStatus;
    return {
      version: VERSION,
      experimentalLogits: experimentalLogits,
      plugins: listPlugins(),
      adapters: listAdapters(),
      sampling: defaultSampling(settings || {}),
      llamaServer: server,
      offlineCapable: !!(server && server.ok),
      monitoring: !!healthTimer
    };
  }

  function startHealthMonitor(settings, intervalMs) {
    stopHealthMonitor();
    // Only probe when the user has explicitly configured a local llama-server URL.
    // Avoids Failed-to-fetch spam on file:// / content:// / QuickEdit origins.
    const s = settings || {};
    const url = String(s.llamaServerUrl || s.llamaUrl || '').trim();
    if (!url) return false;
    const ms = Math.max(5000, Math.min(60000, Number(intervalMs) || 15000));
    healthTimer = setInterval(function () {
      if (!SG.llamaServer || typeof SG.llamaServer.probe !== 'function') return;
      SG.llamaServer.probe(s, true).then(function (h) {
        lastStatus = { ok: !!h.ok, at: Date.now(), model: h.model || '', error: h.error || '' };
        try {
          document.dispatchEvent(new CustomEvent('athuex:harness-health', { detail: lastStatus }));
        } catch (_) {}
      }).catch(function () {});
    }, ms);
    return true;
  }

  function stopHealthMonitor() {
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
  }

  // Core safety plugins — always present, enabled by default
  registerPlugin({
    id: 'trim_system',
    version: '1.0.1',
    source: 'core',
    description: 'Trim oversized system messages for small-context local models',
    beforeRequest: function (req) {
      if (!req.messages || !req.messages.length) return req;
      const msgs = req.messages.slice();
      if (msgs[0].role === 'system' && String(msgs[0].content || '').length > 6000) {
        msgs[0] = { role: 'system', content: String(msgs[0].content).slice(0, 6000) + '\n[system truncated for local context]' };
      }
      req.messages = msgs;
      return req;
    }
  });

  registerPlugin({
    id: 'strip_empty',
    version: '1.0.1',
    source: 'core',
    description: 'Drop empty user/assistant turns before local completion',
    beforeRequest: function (req) {
      if (!req.messages) return req;
      req.messages = req.messages.filter(function (m) {
        return m && String(m.content || '').trim().length > 0;
      });
      return req;
    }
  });

  registerPlugin({
    id: 'mobile_context_cap',
    version: '1.0.0',
    source: 'core',
    description: 'Cap history length for 4GB devices when using local llama-server',
    beforeRequest: function (req) {
      if (!req.messages || req.messages.length <= 12) return req;
      const sys = req.messages[0] && req.messages[0].role === 'system' ? [req.messages[0]] : [];
      const rest = req.messages.slice(sys.length);
      req.messages = sys.concat(rest.slice(-10));
      return req;
    }
  });

  window.SG_REGISTER_HARNESS_PLUGIN = function (def) {
    if (def && !def.source) def.source = 'user';
    return registerPlugin(def);
  };

  SG.harness = {
    version: VERSION,
    registerPlugin: registerPlugin,
    unregisterPlugin: unregisterPlugin,
    listPlugins: listPlugins,
    listAdapters: listAdapters,
    enablePlugin: enablePlugin,
    setExperimentalLogits: setExperimentalLogits,
    experimentalLogitsEnabled: function () { return experimentalLogits; },
    applyLogitsExperimental: applyLogitsExperimental,
    defaultSampling: defaultSampling,
    loadProfile: loadProfile,
    saveProfile: saveProfile,
    scanWorkspace: scanWorkspace,
    complete: complete,
    status: status,
    startHealthMonitor: startHealthMonitor,
    stopHealthMonitor: stopHealthMonitor,
    runBefore: runBefore,
    runAfter: runAfter
  };
})(window.SG = window.SG || {});
