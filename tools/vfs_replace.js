/* str_replace — workspace main memory — v1.3.2 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;
  const U = SG.contextUtils;
  R.register({
    name: 'str_replace', source: 'core:vfs', version: '1.3.2',
    description: 'Replace exact string in a workspace file (first match).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_str: { type: 'string' },
        new_str: { type: 'string' }
      },
      required: ['path', 'old_str', 'new_str']
    },
    handler: function (args, ctx) {
      const files = (ctx && ctx.files) || {};
      const path = U.cleanName(args.path);
      if (!path || files[path] === undefined) {
        return { ok: false, result: 'file not found: ' + (args.path || ''), notify: true };
      }
      const old = String(args.old_str == null ? '' : args.old_str);
      const neu = String(args.new_str == null ? '' : args.new_str);
      const src = String(files[path]);
      const idx = src.indexOf(old);
      if (idx < 0) return { ok: false, result: 'old_str not found in ' + path, notify: true };
      if (typeof ctx.checkpoint === 'function') ctx.checkpoint(path, files[path]);
      files[path] = src.slice(0, idx) + neu + src.slice(idx + old.length);
      if (typeof ctx.onChange === 'function') ctx.onChange(path);
      return { ok: true, result: 'replaced in ' + path, notify: true };
    }
  });
})(window.SG = window.SG || {});
