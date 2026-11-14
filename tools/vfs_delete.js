/* delete_file — workspace main memory — Athuex v1.0.7 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;
  const U = SG.contextUtils;
  R.register({
    name: 'delete_file',
    source: 'core:vfs',
    version: '1.0.7',
    description: 'Delete a file from the MAIN workspace (not SMFS). Use for removing workspace files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' }
      },
      required: ['path']
    },
    handler: function (args, ctx) {
      const files = (ctx && ctx.files) || {};
      const path = U && U.cleanName ? U.cleanName(args.path) : String(args.path || '').replace(/^\/+/, '').replace(/\.\./g, '');
      if (!path) return { ok: false, result: 'Invalid path', notify: true };
      if (!Object.prototype.hasOwnProperty.call(files, path)) {
        // also allow deleting "directory" prefix keys
        const keys = Object.keys(files).filter(function (k) {
          return k === path || k.indexOf(path + '/') === 0;
        });
        if (!keys.length) return { ok: false, result: 'not found: ' + path, notify: true };
        keys.forEach(function (k) {
          if (typeof ctx.checkpoint === 'function') ctx.checkpoint(k, files[k]);
          delete files[k];
          if (typeof ctx.onChange === 'function') ctx.onChange(k);
        });
        return { ok: true, result: 'deleted ' + keys.length + ' path(s) under ' + path, notify: true };
      }
      if (typeof ctx.checkpoint === 'function') ctx.checkpoint(path, files[path]);
      delete files[path];
      if (typeof ctx.onChange === 'function') ctx.onChange(path);
      return { ok: true, result: 'deleted ' + path, notify: true };
    }
  });
})(window.SG = window.SG || {});
