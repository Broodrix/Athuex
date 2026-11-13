/* run_code sandbox — v1.3.2 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;
  let runCodeAllowed = false;
  function cleanName(n) {
    let s = String(n || '').replace(/\\/g, '/');
    if (s.startsWith('/')) s = s.slice(1);
    if (!s || /[\0-\x1f\\]/.test(s) || s.includes('..')) return null;
    return s.slice(0, 200);
  }
  R.register({
    name: 'run_code', source: 'core:run', version: '1.3.2',
    description: 'Run JS in sandboxed iframe (8s limit). Requires user confirmation once per session.',
    parameters: { type: 'object', properties: { code: { type: 'string' }, filename: { type: 'string' } } },
    handler: async function (args, ctx) {
      let code = args && args.code;
      if (!code && args && args.filename) {
        const p = cleanName(args.filename);
        const files = (ctx && ctx.files) || {};
        if (p && files[p] != null) code = files[p];
      }
      if (!code) return { ok: false, result: 'code or filename required', notify: true };
      if (!runCodeAllowed) {
        const confirmFn = ctx && (ctx.confirmFn || ctx.confirmRunCode);
        if (typeof confirmFn === 'function') {
          if (!(await confirmFn())) return { ok: false, result: 'User declined run_code', notify: true };
          runCodeAllowed = true;
        } else if (typeof confirm === 'function') {
          if (!confirm('Allow this chat to run JavaScript in a sandbox? (once per session)')) {
            return { ok: false, result: 'User declined run_code', notify: true };
          }
          runCodeAllowed = true;
        }
      }
      if (!window.SG || !SG.runner) return { ok: false, result: 'Runner unavailable', notify: true };
      const r = await SG.runner.runJS(String(code), 8000);
      return { ok: r.ok, result: r.text, notify: true };
    }
  });
  SG._runCodeReset = function () { runCodeAllowed = false; };
})(window.SG = window.SG || {});
