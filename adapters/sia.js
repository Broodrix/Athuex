/* Athuex adapter: sia — Self-Improving AI richer local traces */
(function (SG) {
  'use strict';
  if (!SG || !SG.harness || typeof SG.harness.registerPlugin !== 'function') return;

  SG.harness.registerPlugin({
    id: 'sia',
    version: '1.0.0',
    source: 'adapter',
    enabled: false,
    description: 'Richer post-completion traces into hybrid_traces / memory for future retrieval (no weight training).',
    afterResponse: function (res) {
      try {
        const content = res && res.message && res.message.content
          ? String(res.message.content)
          : '';
        if (!content || content.length < 8) return res;
        if (SG.hybridTraces && typeof SG.hybridTraces.record === 'function') {
          SG.hybridTraces.record({
            kind: 'sia-local',
            summary: content.slice(0, 280),
            backend: (res && res.backend) || 'harness',
            ok: true,
            provenance: 'sia-adapter'
          });
        } else if (SG.memory && typeof SG.memory.recordTrace === 'function') {
          SG.memory.recordTrace({
            kind: 'sia-local',
            summary: content.slice(0, 200),
            ok: true,
            provenance: 'sia-adapter'
          });
        }
      } catch (_) {}
      return res;
    }
  });
})(window.SG = window.SG || {});
