/* read_preview_console — v1.3.2 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;
  R.register({
    name: 'read_preview_console', source: 'core:preview', version: '1.3.2',
    description: 'Read recent console output from the live Preview pane.',
    parameters: { type: 'object', properties: { limit: { type: 'integer' } } },
    handler: function (args) {
      if (!window.SG || !SG.preview) return { ok: false, result: 'Preview module unavailable', notify: true };
      const limit = Math.min(100, Math.max(1, Number(args && args.limit) || 40));
      const lines = SG.preview.getLogs(limit);
      return { ok: true, result: lines.length ? lines.join('\n') : '(preview console empty)', notify: true };
    }
  });
})(window.SG = window.SG || {});
