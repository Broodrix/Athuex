/* Tools bootstrap — v1.3.0 */
(function (SG) {
  'use strict';
  const VERSION = (typeof window !== 'undefined' && window.ATHUEX_VERSION) || '1.0.4';
  var _registryWarned = false;
  function ensureRegistry() {
    if (!SG.toolsRegistry) {
      if (!_registryWarned) {
        console.error('[SG.tools] registry missing — ensure tools/registry.js loads before js/tools.js');
        _registryWarned = true;
      }
      return null;
    }
    return SG.toolsRegistry;
  }
  SG.tools = {
    version: VERSION,
    schemas: function () { const R = ensureRegistry(); return R ? R.schemas() : []; },
    schemasForQuery: function (q, opts) { const R = ensureRegistry(); return R && R.schemasForQuery ? R.schemasForQuery(q, opts) : (R ? R.schemas() : []); },
    schemasMinimal: function (kind) { const R = ensureRegistry(); return R && R.schemasMinimal ? R.schemasMinimal(kind) : []; },
    call: async function (name, args, ctx) {
      const R = ensureRegistry();
      if (!R) return { ok: false, result: 'tools registry unavailable', notify: true };
      return R.call(name, args, {
        files: (ctx && ctx.files) || {},
        onChange: ctx && ctx.onChange,
        checkpoint: ctx && ctx.checkpoint,
        confirmFn: (ctx && (ctx.confirmFn || ctx.confirmRunCode)) || null,
        confirmDestructive: (ctx && ctx.confirmDestructive) || null
      });
    },
    prepare: async function () { return []; },
    resetRunCodePermission: function () { if (typeof SG._runCodeReset === 'function') SG._runCodeReset(); },
    loadUserTool: async function (path, filesMap) {
      const R = ensureRegistry();
      if (!R) throw new Error('registry unavailable');
      await R.loadFromSource('vfs:' + path, filesMap[path]);
      return R.list();
    },
    scanUserTools: async function (filesMap) {
      const R = ensureRegistry();
      return R ? R.scanWorkspace(filesMap || {}) : [];
    },
    list: function () { const R = ensureRegistry(); return R ? R.list() : []; },
    enable: function (name, on) { const R = ensureRegistry(); return R ? R.enable(name, on) : false; },
    setAllowlist: function (names) { const R = ensureRegistry(); return R && R.setAllowlist ? R.setAllowlist(names) : false; },
    getAllowlist: function () { const R = ensureRegistry(); return R && R.getAllowlist ? R.getAllowlist() : null; },
    isAllowlisted: function (n) { const R = ensureRegistry(); return R && R.isAllowlisted ? R.isAllowlisted(n) : true; },
    getAudit: function (limit) { const R = ensureRegistry(); return R && R.getAudit ? R.getAudit(limit) : []; },
    clearAudit: function () { const R = ensureRegistry(); if (R && R.clearAudit) R.clearAudit(); }
  };
})(window.SG = window.SG || {});
