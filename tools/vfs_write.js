/* write_file — workspace main memory — v1.3.2 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;
  const U = SG.contextUtils;
  R.register({
    name: 'write_file', source: 'core:vfs', version: '1.3.2',
    description: 'Create or overwrite a file in workspace (main memory). Max 2MB.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    },
    handler: function (args, ctx) {
      const files = (ctx && ctx.files) || {};
      const path = U.cleanName(args.path);
      if (!path) return { ok: false, result: 'Invalid path: ' + (args.path || ''), notify: true };
      const content = String(args.content == null ? '' : args.content);
      if (U.utf8Bytes(content).length > 2 * 1024 * 1024) {
        return { ok: false, result: 'payload exceeds 2MB limit', notify: true };
      }
      if (typeof ctx.checkpoint === 'function') ctx.checkpoint(path, files[path]);
      files[path] = content;
      if (typeof ctx.onChange === 'function') ctx.onChange(path);
      return { ok: true, result: 'wrote ' + path + ' (' + content.length + ' bytes)', notify: true };
    }
  });
})(window.SG = window.SG || {});
