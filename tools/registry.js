/* Athuex Tools Registry — hot-swap, modular — v2.5.2 (P1 broker) */
(function (SG) {
  'use strict';
  const VERSION = (typeof window !== 'undefined' && window.ATHUEX_VERSION) || '2.7.7';
  const registry = new Map();
  const listeners = new Set();
  const loadedSources = new Set();
  /** Simple allowlist; null = allow all registered */
  let capabilityAllowlist = null;
  /** Bounded audit trail */
  const auditLog = [];
  const AUDIT_MAX = 200;

  function emit(event, detail) {
    listeners.forEach((fn) => { try { fn(event, detail); } catch (_) {} });
  }

  function register(def) {
    if (!def || !def.name || typeof def.handler !== 'function') {
      console.warn('[SG.tools] invalid register', def);
      return false;
    }
    const name = String(def.name);
    const schema = def.schema || {
      type: 'function',
      function: {
        name,
        description: def.description || name,
        parameters: def.parameters || { type: 'object', properties: {} }
      }
    };
    if (schema.function) schema.function.name = name;
    registry.set(name, {
      name, schema, handler: def.handler,
      source: def.source || 'core',
      version: def.version || '',
      author: def.author || '',
      enabled: def.enabled !== false
    });
    emit('register', { name });
    return true;
  }

  function unregister(name) {
    const ok = registry.delete(String(name));
    if (ok) emit('unregister', { name });
    return ok;
  }

  function enable(name, on) {
    const t = registry.get(String(name));
    if (!t) return false;
    t.enabled = on !== false;
    emit('enable', { name, enabled: t.enabled });
    return true;
  }

  function list() {
    return Array.from(registry.values()).map((t) => ({
      name: t.name, source: t.source, version: t.version || '', author: t.author || '',
      enabled: t.enabled,
      description: (t.schema.function && t.schema.function.description) || ''
    }));
  }

  /** NVIDIA / OpenAI-compat: strip unsupported JSON-schema keywords, normalize types. */
  function sanitizeSchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    const fn = schema.function || schema;
    const name = (fn.name || schema.name || 'tool').slice(0, 64);
    let desc = String(fn.description || name).slice(0, 512);
    const params = fn.parameters || schema.parameters || { type: 'object', properties: {} };
    const props = {};
    const srcProps = (params && params.properties) || {};
    Object.keys(srcProps).forEach(function (k) {
      const p = srcProps[k] || {};
      const out = {};
      let t = p.type || 'string';
      if (t === 'integer') t = 'number';
      if (Array.isArray(t)) t = t[0] || 'string';
      out.type = t;
      if (p.description) out.description = String(p.description).slice(0, 200);
      if (Array.isArray(p.enum) && p.enum.length && p.enum.length <= 20) {
        out.enum = p.enum.map(String);
      }
      props[k] = out;
    });
    const required = Array.isArray(params.required)
      ? params.required.filter(function (k) { return Object.prototype.hasOwnProperty.call(props, k); })
      : [];
    return {
      type: 'function',
      function: {
        name: name,
        description: desc,
        parameters: {
          type: 'object',
          properties: props,
          required: required
        }
      }
    };
  }

  function schemas() {
    const out = [];
    registry.forEach((t) => { if (t.enabled) out.push(sanitizeSchema(t.schema)); });
    return out;
  }

  /** Select a smaller tool set based on user text to save context tokens. */
  function schemasForQuery(query, opts) {
    opts = opts || {};
    const max = opts.max || 12;
    const q = String(query || '').toLowerCase();
    const all = [];
    registry.forEach((t) => { if (t.enabled) all.push(t); });

    const groups = {
      // MUST match tools/*.js register() names exactly
      core: ['list_files', 'read_file', 'write_file', 'str_replace', 'delete_file', 'list_tools', 'list_programs', 'open_program'],
      files: ['read_file_context_optimized', 'write_file_context_optimized', 'index_file', 'locate_in_file', 'sm_list', 'sm_read', 'sm_write', 'sm_delete', 'sm_to_workspace', 'sm_from_workspace'],
      code: ['run_code', 'analyze_code', 'read_preview_console'],
      search: ['web_search', 'fetch_url', 'search_status'],
      memory: ['memory_get', 'memory_set_state', 'memory_add_rule', 'memory_remove_rule', 'memory_step', 'context_memory'],
      mcp: ['mcp_list_tools', 'mcp_call_tool'],
      meta: ['list_tools', 'list_programs', 'open_program']
    };

    const wanted = new Set(groups.core);
    if (/file|read|write|edit|save|folder|dir|path|workspace|ssf|volume|smfs|delete|remove|clear|index|locate|find in/.test(q)) {
      groups.files.forEach(function (n) { wanted.add(n); });
    }
    if (/code|run|exec|preview|console|bug|error|function|html|css|js|script|fix|verify/.test(q)) {
      groups.code.forEach(function (n) { wanted.add(n); });
    }
    if (/program|calculator|debug|about|panel|tab|open ide|open files/.test(q)) {
      groups.meta.forEach(function (n) { wanted.add(n); });
    }
    if (/search|web|google|fetch|url|http|wiki|news|look up/.test(q)) {
      groups.search.forEach(function (n) { wanted.add(n); });
    }
    if (/memory|remember|prefer|rule|forget|convention/.test(q)) {
      groups.memory.forEach(function (n) { wanted.add(n); });
    }
    if (/mcp|server tool|remote tool/.test(q)) {
      groups.mcp.forEach(function (n) { wanted.add(n); });
    }
    // Always include memory_get lightly
    wanted.add('memory_get');

    let selected = all.filter(function (t) { return wanted.has(t.name); });
    if (selected.length < 4) {
      selected = all.slice(0, max);
    } else if (selected.length > max) {
      selected = selected.slice(0, max);
    }
    return selected.map(function (t) { return sanitizeSchema(t.schema); });
  }

  /** Minimal tool set for recovery after 404 (search + core files only). */
  function schemasMinimal(kind) {
    const names = kind === 'search'
      ? ['web_search', 'fetch_url', 'list_files', 'read_file']
      : ['list_files', 'read_file', 'write_file', 'str_replace', 'delete_file', 'list_programs', 'open_program'];
    const out = [];
    names.forEach(function (n) {
      const t = registry.get(n);
      if (t && t.enabled) out.push(sanitizeSchema(t.schema));
    });
    return out;
  }

  const DESTRUCTIVE = {
    delete_file: true,
    write_file: true,
    str_replace: true,
    sm_delete: true,
    sm_write: true,
    run_code: true
  };

  function pushAudit(entry) {
    auditLog.push(entry);
    if (auditLog.length > AUDIT_MAX) auditLog.splice(0, auditLog.length - AUDIT_MAX);
  }

  async function call(name, args, ctx) {
    const t = registry.get(String(name));
    if (!t) return { ok: false, result: 'tool unavailable: ' + name, notify: true };
    if (!t.enabled) return { ok: false, result: 'tool disabled: ' + name, notify: true };
    if (capabilityAllowlist && !capabilityAllowlist[name]) {
      pushAudit({ ts: Date.now(), name: name, ok: false, reason: 'not-allowlisted' });
      return { ok: false, result: 'tool not allowlisted: ' + name, notify: true };
    }
    // P0/P1: permission prompt for destructive tools
    if (DESTRUCTIVE[name] && name !== 'run_code') {
      const confirmFn = ctx && (ctx.confirmDestructive || ctx.confirmFn);
      if (typeof confirmFn === 'function') {
        const ok = await confirmFn(name, args);
        if (!ok) {
          pushAudit({ ts: Date.now(), name: name, ok: false, reason: 'user-declined' });
          return { ok: false, result: 'User declined ' + name, notify: true };
        }
      }
    }
    // Cancellation support
    if (ctx && ctx.signal && ctx.signal.aborted) {
      pushAudit({ ts: Date.now(), name: name, ok: false, reason: 'aborted' });
      return { ok: false, result: 'tool aborted: ' + name, notify: true };
    }
    const started = Date.now();
    try {
      const r = await t.handler(args || {}, ctx || {});
      const out = (r && typeof r === 'object' && 'ok' in r) ? r : { ok: true, result: r, notify: true };
      pushAudit({ ts: started, name: name, ok: !!out.ok, ms: Date.now() - started });
      return out;
    } catch (e) {
      pushAudit({ ts: started, name: name, ok: false, ms: Date.now() - started, error: String((e && e.message) || e) });
      return { ok: false, result: String((e && e.message) || e), notify: true };
    }
  }

  /** Text-injection loader — works on file:// and content:// WebViews (Blob URLs often fail). */
  function loadFromSource(id, source) {
    return new Promise((resolve, reject) => {
      try {
        const src = String(source || '');
        if (!src.trim()) return reject(new Error('empty source'));
        const s = document.createElement('script');
        s.type = 'text/javascript';
        s.setAttribute('data-sg-tool', String(id));
        s.text = src + '\n//# sourceURL=tool:' + String(id).replace(/[^\w./:#-]/g, '_');
        document.head.appendChild(s);
        setTimeout(function () { try { s.remove(); } catch (_) {} }, 0);
        loadedSources.add(id);
        emit('load', { id });
        resolve(true);
      } catch (e) { reject(e); }
    });
  }

  function loadFromUrl(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url; s.async = false;
      s.onload = () => { emit('load', { url }); resolve(true); };
      s.onerror = () => reject(new Error('failed to load ' + url));
      document.head.appendChild(s);
    });
  }

  async function scanWorkspace(filesMap) {
    if (!filesMap || typeof filesMap !== 'object') return [];
    const loaded = [];
    const paths = Object.keys(filesMap).filter((p) => {
      const n = p.replace(/\\/g, '/').toLowerCase();
      return (n.startsWith('tools/') && n.endsWith('.js')) || n.endsWith('.tool.js');
    });
    for (const p of paths) {
      const content = filesMap[p];
      if (typeof content !== 'string' || content.length < 20) continue;
      if (!/toolsRegistry\.register|SG_REGISTER_TOOL|\.register\s*\(/.test(content)) continue;
      const id = 'vfs:' + p;
      if (loadedSources.has(id)) continue;
      try {
        await loadFromSource(id, content);
        loadedSources.add(id);
        loaded.push(p);
      } catch (e) { console.warn('[SG.tools] scan skip', p, e); }
    }
    return loaded;
  }

  function on(fn) {
    if (typeof fn === 'function') listeners.add(fn);
    return () => listeners.delete(fn);
  }

  window.SG_REGISTER_TOOL = function (def) {
    if (def && !def.source) def.source = 'user';
    return register(def);
  };

  function setAllowlist(names) {
    if (names == null) { capabilityAllowlist = null; return true; }
    if (!Array.isArray(names)) return false;
    capabilityAllowlist = Object.create(null);
    names.forEach(function (n) { capabilityAllowlist[String(n)] = true; });
    return true;
  }
  function getAllowlist() {
    if (!capabilityAllowlist) return null;
    return Object.keys(capabilityAllowlist);
  }
  function isAllowlisted(name) {
    if (!capabilityAllowlist) return true;
    return !!capabilityAllowlist[String(name)];
  }
  function getAudit(limit) {
    const n = Math.max(1, Math.min(AUDIT_MAX, Number(limit) || 50));
    return auditLog.slice(-n);
  }
  function clearAudit() { auditLog.length = 0; }

  SG.toolsRegistry = {
    version: VERSION, register, unregister, enable, list, schemas, schemasForQuery, schemasMinimal, sanitizeSchema, call,
    loadFromSource, loadFromUrl, scanWorkspace, on,
    setAllowlist: setAllowlist,
    getAllowlist: getAllowlist,
    isAllowlisted: isAllowlisted,
    getAudit: getAudit,
    clearAudit: clearAudit,
    _map: registry
  };
})(window.SG = window.SG || {});
