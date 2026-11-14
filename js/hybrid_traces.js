/* Athuex hybrid learning — solution traces only (P2). Not weight training. */
(function (SG) {
  'use strict';
  const VERSION = '2.5.3';
  const KEY = 'athuex.hybrid_traces_v1';
  const MAX = 80;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  function save(arr) {
    try { localStorage.setItem(KEY, JSON.stringify(arr.slice(-MAX))); } catch (_) {}
  }

  /**
   * Record a successful or notable solution trace with provenance.
   * Opt-in persistence via localStorage (user device only).
   */
  function recordTrace(entry) {
    entry = entry || {};
    const row = {
      id: 'tr_' + Date.now().toString(36),
      ts: Date.now(),
      kind: String(entry.kind || 'turn').slice(0, 40),
      backend: String(entry.backend || '').slice(0, 40),
      reason: String(entry.reason || '').slice(0, 80),
      summary: String(entry.summary || '').slice(0, 400),
      tools: Array.isArray(entry.tools) ? entry.tools.slice(0, 16).map(String) : [],
      ok: entry.ok !== false,
      provenance: String(entry.provenance || 'session').slice(0, 40)
    };
    const arr = load();
    arr.push(row);
    save(arr);
    return row;
  }

  function listTraces(limit) {
    const n = Math.max(1, Math.min(MAX, Number(limit) || 20));
    return load().slice(-n);
  }

  function retrieveRelevant(query, limit) {
    const q = String(query || '').toLowerCase();
    const arr = load();
    if (!q) return arr.slice(-(limit || 5));
    const scored = arr.map(function (t) {
      let score = 0;
      const blob = (t.summary + ' ' + t.kind + ' ' + (t.tools || []).join(' ')).toLowerCase();
      q.split(/\s+/).forEach(function (w) {
        if (w.length > 2 && blob.indexOf(w) >= 0) score++;
      });
      return { t: t, score: score };
    }).filter(function (x) { return x.score > 0; });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, limit || 5).map(function (x) { return x.t; });
  }

  function clearTraces() { save([]); }

  // Attach to SG.memory if present for a single call site
  function ensureMemoryHook() {
    SG.memory = SG.memory || {};
    if (typeof SG.memory.recordTrace !== 'function') {
      SG.memory.recordTrace = recordTrace;
    }
    if (typeof SG.memory.listTraces !== 'function') {
      SG.memory.listTraces = listTraces;
    }
    if (typeof SG.memory.retrieveTraces !== 'function') {
      SG.memory.retrieveTraces = retrieveRelevant;
    }
  }
  ensureMemoryHook();

  SG.hybridTraces = {
    version: VERSION,
    record: recordTrace,
    list: listTraces,
    retrieve: retrieveRelevant,
    clear: clearTraces
  };
})(window.SG = window.SG || {});
