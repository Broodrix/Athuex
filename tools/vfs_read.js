/* read_file — workspace main memory — dynamic token window — v1.3.2 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;
  const U = SG.contextUtils;
  R.register({
    name: 'read_file', source: 'core:vfs', version: '1.3.2',
    description: 'Read a workspace file (main memory). Uses model context window (not a fixed 20KB). Optional start_line/end_line or cursor.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        start_line: { type: 'integer' },
        end_line: { type: 'integer' },
        cursor: { type: 'integer' },
        modelIdentifier: { type: 'string' }
      },
      required: ['path']
    },
    handler: function (args, ctx) {
      const files = (ctx && ctx.files) || {};
      const path = U.cleanName(args.path || args.filename || '');
      if (!path || files[path] === undefined) {
        return { ok: false, result: 'file not found: ' + (args.path || ''), notify: true };
      }
      let content = String(files[path]);
      const lines = content.split('\n');
      if (args.start_line != null || args.end_line != null) {
        const start = Math.max(1, Number(args.start_line) || 1);
        const end = Math.max(start, Number(args.end_line) || lines.length);
        content = lines.slice(start - 1, end).join('\n');
      }
      const modelId = args.modelIdentifier || (ctx && ctx.modelId) || '';
      const budgetChars = U.usableTokens(modelId, 0) * 4;
      const cursor = Math.max(0, Number(args.cursor) || 0);
      if (content.length > budgetChars) {
        const end = U.pageEnd(content, cursor, budgetChars);
        const slice = content.slice(cursor, end);
        const next = end < content.length ? end : null;
        return {
          ok: true,
          result: slice + (next != null ? '\n…[truncated; next cursor=' + next + ' of ' + content.length + ']' : ''),
          notify: false
        };
      }
      return { ok: true, result: content, notify: false };
    }
  });
})(window.SG = window.SG || {});
