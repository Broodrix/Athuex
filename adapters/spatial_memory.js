/* Athuex adapter: spatial_memory — workspace + memory tool preference */
(function (SG) {
  'use strict';
  if (!SG || !SG.harness || typeof SG.harness.registerPlugin !== 'function') return;

  const HINT = '[spatial_memory] When the user refers to files, prior work, or location in the project, prefer memory_search / vfs_* tools before guessing paths or contents.';

  SG.harness.registerPlugin({
    id: 'spatial_memory',
    version: '1.0.0',
    source: 'adapter',
    enabled: false,
    description: 'Injects a short reminder so the model prefers memory and VFS tools for workspace-aware answers.',
    beforeRequest: function (req) {
      if (!req || !Array.isArray(req.messages) || !req.messages.length) return req;
      const msgs = req.messages.slice();
      if (msgs[0].role === 'system') {
        const c = String(msgs[0].content || '');
        if (c.indexOf('[spatial_memory]') === -1) {
          msgs[0] = { role: 'system', content: c + '\n\n' + HINT };
        }
      } else {
        msgs.unshift({ role: 'system', content: HINT });
      }
      req.messages = msgs;
      return req;
    }
  });
})(window.SG = window.SG || {});
