/* AI code helpers — v1.3.2 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;
  function cleanName(n) {
    let s = String(n || '').replace(/\\/g, '/');
    if (s.startsWith('/')) s = s.slice(1);
    if (!s || /[\0-\x1f\\]/.test(s) || s.includes('..')) return null;
    return s.slice(0, 200);
  }
  R.register({
    name: 'analyze_code', source: 'core:code', version: '1.3.2',
    description: 'Static analysis of a workspace file or inline code.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, code: { type: 'string' } } },
    handler: function (args, ctx) {
      let content = args && args.code; let path = args && args.path;
      if (!content && path) {
        const p = cleanName(path);
        const files = (ctx && ctx.files) || {};
        if (!p || files[p] === undefined) return { ok: false, result: 'file not found', notify: true };
        content = files[p]; path = p;
      }
      if (content == null) return { ok: false, result: 'path or code required', notify: true };
      const issues = [];
      const s = String(content);
      if (/\bvar\s+/.test(s)) issues.push('[info] uses var');
      if (/innerHTML\s*=/.test(s)) issues.push('[warn] innerHTML assignment');
      if (/eval\s*\(/.test(s)) issues.push('[warn] eval()');
      [['(', ')'], ['{', '}'], ['[', ']']].forEach(([a, b]) => {
        let bal = 0;
        for (const ch of s) { if (ch === a) bal++; else if (ch === b) bal--; if (bal < 0) break; }
        if (bal !== 0) issues.push('[error] unbalanced ' + a + b + ' (delta ' + bal + ')');
      });
      return { ok: true, result: 'File: ' + (path || 'snippet') + '\nLines: ' + s.split('\n').length + '\n' + (issues.length ? issues.join('\n') : 'No issues found.'), notify: true };
    }
  });
  R.register({
    name: 'list_tools', source: 'core:code', version: '1.3.2',
    description: 'List registered AI tools.',
    parameters: { type: 'object', properties: {} },
    handler: function () {
      const rows = R.list().map((t) => t.name + ' [' + (t.enabled ? 'on' : 'off') + '] (' + t.source + ')');
      return { ok: true, result: rows.join('\n') || '(no tools)', notify: true };
    }
  });
})(window.SG = window.SG || {});
