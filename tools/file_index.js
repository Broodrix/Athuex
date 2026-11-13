/* Local file index for near-constant lookup before context reads — v1.0.8 */
(function (SG) {
  'use strict';

  const VERSION = '1.0.8';
  /** @type {Map<string, { tokens: Map<string, number[]>, lines: string[], updated: number, size: number }>} */
  const index = new Map();
  const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]{2,}|[^\s]{4,}/g;

  function tokenizeLine(line) {
    const out = [];
    let m;
    const re = new RegExp(TOKEN_RE.source, 'g');
    while ((m = re.exec(line)) !== null) {
      out.push(m[0].toLowerCase());
      if (out.length > 80) break;
    }
    return out;
  }

  function build(path, content) {
    path = String(path || '').replace(/^\/+/, '');
    content = String(content == null ? '' : content);
    const lines = content.split('\n');
    const tokens = new Map();
    const maxLines = Math.min(lines.length, 20000);
    for (let i = 0; i < maxLines; i++) {
      const toks = tokenizeLine(lines[i]);
      for (let j = 0; j < toks.length; j++) {
        const t = toks[j];
        let arr = tokens.get(t);
        if (!arr) { arr = []; tokens.set(t, arr); }
        if (arr.length < 30) arr.push(i + 1); // 1-based line numbers
      }
    }
    index.set(path, {
      tokens: tokens,
      lines: lines,
      updated: Date.now(),
      size: content.length
    });
    return { path: path, lines: lines.length, tokens: tokens.size, size: content.length };
  }

  function invalidate(path) {
    index.delete(String(path || '').replace(/^\/+/, ''));
  }

  function ensure(path, content) {
    path = String(path || '').replace(/^\/+/, '');
    const cur = index.get(path);
    if (cur && content != null && cur.size === String(content).length) return cur;
    if (content == null) return cur || null;
    build(path, content);
    return index.get(path);
  }

  function locate(path, needle, content) {
    path = String(path || '').replace(/^\/+/, '');
    needle = String(needle || '').trim();
    if (!needle) return { ok: false, result: 'needle required' };
    const entry = ensure(path, content);
    if (!entry) return { ok: false, result: 'not indexed: ' + path };

    const q = needle.toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);
    const hits = new Map(); // line -> score

    terms.forEach(function (term) {
      // exact token
      const lines = entry.tokens.get(term) || [];
      lines.forEach(function (ln) { hits.set(ln, (hits.get(ln) || 0) + 3); });
      // substring fallback over token keys (bounded)
      if (term.length >= 3) {
        let checked = 0;
        entry.tokens.forEach(function (arr, tok) {
          if (checked++ > 2000) return;
          if (tok.indexOf(term) >= 0) {
            arr.forEach(function (ln) { hits.set(ln, (hits.get(ln) || 0) + 1); });
          }
        });
      }
    });

    // raw line scan limited window if few hits
    if (hits.size < 3) {
      const max = Math.min(entry.lines.length, 5000);
      for (let i = 0; i < max; i++) {
        if (entry.lines[i].toLowerCase().indexOf(q) >= 0) {
          hits.set(i + 1, (hits.get(i + 1) || 0) + 5);
        }
      }
    }

    const ranked = Array.from(hits.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 12);
    const snippets = ranked.map(function (pair) {
      const ln = pair[0];
      const start = Math.max(0, ln - 2);
      const end = Math.min(entry.lines.length, ln + 2);
      const body = entry.lines.slice(start, end).map(function (l, idx) {
        return (start + idx + 1) + '| ' + l.slice(0, 200);
      }).join('\n');
      return { line: ln, score: pair[1], snippet: body };
    });

    return {
      ok: true,
      path: path,
      totalLines: entry.lines.length,
      hits: snippets,
      result: snippets.length
        ? ('Index hits in ' + path + ' (' + entry.totalLines + ' lines):\n' +
           snippets.map(function (h) { return 'L' + h.line + ' score=' + h.score + '\n' + h.snippet; }).join('\n---\n'))
        : ('No index hits for "' + needle + '" in ' + path)
    };
  }

  function stats() {
    const out = [];
    index.forEach(function (v, k) {
      out.push({ path: k, lines: v.lines.length, tokens: v.tokens.size, size: v.size });
    });
    return out;
  }

  // Register AI tools
  const R = SG.toolsRegistry;
  if (R) {
    R.register({
      name: 'index_file',
      source: 'core:index',
      version: VERSION,
      description: 'Build/refresh local inverted index for a workspace file. Call before locate_in_file on large files.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Workspace relative path' } },
        required: ['path']
      },
      handler: function (args, ctx) {
        const path = String(args.path || '').replace(/^\/+/, '');
        const files = (ctx && ctx.files) || {};
        if (!Object.prototype.hasOwnProperty.call(files, path)) {
          return (SG.toolErrors && SG.toolErrors.normalize)
            ? SG.toolErrors.normalize('not found: ' + path)
            : { ok: false, result: 'not found: ' + path, notify: true };
        }
        const meta = build(path, files[path]);
        return { ok: true, result: 'indexed ' + path + ' · ' + meta.lines + ' lines · ' + meta.tokens + ' tokens', notify: true };
      }
    });

    R.register({
      name: 'locate_in_file',
      source: 'core:index',
      version: VERSION,
      description: 'O(1)-ish locate of needle via local index; returns ranked line snippets. Prefer over full read_file for large files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          needle: { type: 'string', description: 'Search terms' }
        },
        required: ['path', 'needle']
      },
      handler: function (args, ctx) {
        const path = String(args.path || '').replace(/^\/+/, '');
        const files = (ctx && ctx.files) || {};
        const content = Object.prototype.hasOwnProperty.call(files, path) ? files[path] : null;
        if (content == null) {
          return (SG.toolErrors && SG.toolErrors.normalize)
            ? SG.toolErrors.normalize('not found: ' + path)
            : { ok: false, result: 'not found: ' + path, notify: true };
        }
        const r = locate(path, args.needle, content);
        return { ok: r.ok !== false, result: r.result || JSON.stringify(r), notify: true };
      }
    });
  }

  SG.fileIndex = { build: build, invalidate: invalidate, ensure: ensure, locate: locate, stats: stats, version: VERSION };
})(window.SG = window.SG || {});
