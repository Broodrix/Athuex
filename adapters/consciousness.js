/* Athuex adapter: consciousness — structured reflection for local models */
(function (SG) {
  'use strict';
  if (!SG || !SG.harness || typeof SG.harness.registerPlugin !== 'function') return;

  const MARKER = '[consciousness] Prefer explicit intermediate reasoning when the task is multi-step. State assumptions, then act. Prefer tools over speculation when workspace state is required.';

  SG.harness.registerPlugin({
    id: 'consciousness',
    version: '1.0.0',
    source: 'adapter',
    enabled: false,
    description: 'Structured reflection guidance for deeper local reasoning on multi-step tasks.',
    beforeRequest: function (req) {
      if (!req || !Array.isArray(req.messages) || !req.messages.length) return req;
      const msgs = req.messages.slice();
      if (msgs[0].role === 'system') {
        const c = String(msgs[0].content || '');
        if (c.indexOf('[consciousness]') === -1) {
          msgs[0] = { role: 'system', content: c + '\n\n' + MARKER };
        }
      } else {
        msgs.unshift({ role: 'system', content: MARKER });
      }
      req.messages = msgs;
      return req;
    }
  });
})(window.SG = window.SG || {});
