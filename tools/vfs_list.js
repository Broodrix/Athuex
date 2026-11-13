/* list_files — workspace main memory — v1.3.2 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;
  R.register({
    name: 'list_files', source: 'core:vfs', version: '1.3.2',
    description: 'List files in workspace (main memory). Optional prefix filter.',
    parameters: { type: 'object', properties: { prefix: { type: 'string' } } },
    handler: function (args, ctx) {
      const files = (ctx && ctx.files) || {};
      const prefix = String((args && args.prefix) || '');
      const rows = Object.keys(files).filter(function (n) {
        return !prefix || n.indexOf(prefix) === 0;
      }).sort().map(function (n) {
        return n + ' (' + String(files[n] || '').length + ' bytes)';
      });
      return { ok: true, result: rows.length ? rows.join('\n') : '(empty workspace)', notify: true };
    }
  });
})(window.SG = window.SG || {});
