/* Athuex adapter: continuous_learning — retrieve recent solution traces into context */
(function (SG) {
  'use strict';
  if (!SG || !SG.harness || typeof SG.harness.registerPlugin !== 'function') return;

  SG.harness.registerPlugin({
    id: 'continuous_learning',
    version: '1.0.1',
    source: 'adapter',
    enabled: false,
    description: 'Seeds the prompt with a short retrieval of recent successful solution traces (retrieval only, not fine-tuning).',
    beforeRequest: function (req) {
      if (!req || !Array.isArray(req.messages)) return req;
      let snippet = '';
      try {
        if (SG.hybridTraces && typeof SG.hybridTraces.retrieve === 'function') {
          const hits = SG.hybridTraces.retrieve('', 2) || [];
          if (hits.length) {
            snippet = hits.map(function (h, i) {
              return (i + 1) + '. ' + String(h.summary || h.text || '').slice(0, 160);
            }).join('\n');
          }
        } else if (SG.hybridTraces && typeof SG.hybridTraces.list === 'function') {
          const hits = (SG.hybridTraces.list(2) || []);
          if (hits.length) {
            snippet = hits.map(function (h, i) {
              return (i + 1) + '. ' + String(h.summary || h.text || '').slice(0, 160);
            }).join('\n');
          }
        }
      } catch (_) {}
      if (!snippet) return req;
      const block = '[continuous_learning] Recent successful traces:\n' + snippet;
      const msgs = req.messages.slice();
      if (msgs[0] && msgs[0].role === 'system') {
        const c = String(msgs[0].content || '');
        if (c.indexOf('[continuous_learning]') === -1) {
          msgs[0] = { role: 'system', content: c + '\n\n' + block };
        }
      } else {
        msgs.unshift({ role: 'system', content: block });
      }
      req.messages = msgs;
      return req;
    }
  });
})(window.SG = window.SG || {});
