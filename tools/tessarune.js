/* Tessarune context_memory only — reader/writer live in file_reader/file_writer — v1.3.2 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;
  const nodes = new Map();
  function nodeId(kind, text, parent) {
    const s = kind + '\0' + (parent || '') + '\0' + text;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8) + '_' + s.length.toString(36);
  }
  function storePut(kind, text, parent) {
    const k = String(kind || 'note').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32) || 'note';
    const t = String(text || '').slice(0, 8000);
    const id = nodeId(k, t, parent || '');
    if (!nodes.has(id)) nodes.set(id, { id: id, kind: k, text: t, parent: parent || null, t: Date.now() });
    return nodes.get(id);
  }
  function storeSearch(query, k) {
    const q = String(query || '').toLowerCase();
    const limit = Math.min(10, Math.max(1, Number(k) || 5));
    if (!q) return [];
    const scored = [];
    nodes.forEach(function (n) {
      const hay = (n.kind + ' ' + n.text).toLowerCase();
      if (hay.indexOf(q) < 0) return;
      let score = 0;
      q.split(/\s+/).forEach(function (w) { if (w && hay.indexOf(w) >= 0) score += 1; });
      scored.push({ id: n.id, kind: n.kind, score: score, snippet: n.text.slice(0, 160) });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, limit);
  }
  const wrap = function (r, notify) {
    return { ok: !!r.ok, result: JSON.stringify(r), notify: !!notify };
  };
  R.register({
    name: 'context_memory',
    source: 'tessarune:store', version: '1.3.2', author: 'tessarune',
    description: 'Session content memory: put / get / search / list. Main-session notes (not durable external volume).',
    parameters: {
      type: 'object',
      required: ['op'],
      properties: {
        op: { type: 'string', enum: ['put', 'get', 'search', 'list'] },
        kind: { type: 'string' },
        text: { type: 'string' },
        id: { type: 'string' },
        query: { type: 'string' },
        k: { type: 'integer' }
      }
    },
    handler: function (args) {
      const op = args.op;
      if (op === 'put') {
        const n = storePut(args.kind, args.text, args.parent);
        return wrap({ ok: true, id: n.id, kind: n.kind }, true);
      }
      if (op === 'get') {
        const n = nodes.get(String(args.id || ''));
        if (!n) return wrap({ ok: false, error: { code: 'NOT_FOUND', message: 'unknown id' } }, true);
        return wrap({ ok: true, node: n }, false);
      }
      if (op === 'search') return wrap({ ok: true, results: storeSearch(args.query, args.k) }, true);
      if (op === 'list') {
        const out = [];
        nodes.forEach(function (n) { out.push({ id: n.id, kind: n.kind, chars: n.text.length }); });
        return wrap({ ok: true, count: out.length, nodes: out.slice(0, 50) }, false);
      }
      return wrap({ ok: false, error: { code: 'BAD_ARGS', message: 'op must be put|get|search|list' } }, true);
    }
  });
  SG.tessarune = { nodes: nodes };
})(window.SG = window.SG || {});
