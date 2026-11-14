/* Athuex adapter: thermodynamic — thermal-aware bias for Galaxy A06 / Helio G85 */
(function (SG) {
  'use strict';
  if (!SG || !SG.harness || typeof SG.harness.registerPlugin !== 'function') return;

  SG.harness.registerPlugin({
    id: 'thermodynamic',
    version: '1.0.0',
    source: 'adapter',
    enabled: false,
    description: 'Thermal-aware sampling: prefer shorter, cooler generations under long context to reduce throttling risk.',
    beforeRequest: function (req) {
      if (!req || !req.sampling) return req;
      const n = Array.isArray(req.messages) ? req.messages.length : 0;
      const maxTok = req.sampling.max_tokens || 1024;
      if (n > 10) {
        req.sampling = Object.assign({}, req.sampling, {
          temperature: Math.max(0.2, (req.sampling.temperature || 0.4) * 0.9),
          max_tokens: Math.min(maxTok, 768)
        });
      }
      return req;
    }
  });
})(window.SG = window.SG || {});
