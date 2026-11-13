/* Athuex adapter: neuromorphic — adaptive sampling for long mobile histories */
(function (SG) {
  'use strict';
  if (!SG || !SG.harness || typeof SG.harness.registerPlugin !== 'function') return;

  SG.harness.registerPlugin({
    id: 'neuromorphic',
    version: '1.0.0',
    source: 'adapter',
    enabled: false,
    description: 'Adaptive sampling: slightly cooler temperature on long histories to reduce drift on 4 GB devices.',
    beforeRequest: function (req) {
      if (!req || !req.sampling) return req;
      const n = Array.isArray(req.messages) ? req.messages.length : 0;
      if (n > 14) {
        req.sampling = Object.assign({}, req.sampling, {
          temperature: Math.max(0.15, (req.sampling.temperature || 0.4) * 0.85),
          top_p: Math.min(0.95, Math.max(0.7, (req.sampling.top_p || 0.9) * 0.95))
        });
      }
      return req;
    }
  });
})(window.SG = window.SG || {});
