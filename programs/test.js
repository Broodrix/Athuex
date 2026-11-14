/* ============================================================================
 * Program: Test — smoke checks for modular Athuex (P6)
 * Path:    programs/test.js
 * Version: 2.5.8
 * ========================================================================== */
(function (SG) {
  'use strict';
  const R = SG.programsRegistry;
  if (!R) return;

  function runSmoke() {
    var lines = [];
    function ok(label, pass, detail) {
      lines.push((pass ? '✓ ' : '✗ ') + label + (detail ? ' — ' + detail : ''));
    }
    ok('SG.tools', !!(SG.tools && SG.tools.list), SG.tools ? SG.tools.list().length + ' tools' : '');
    ok('SG.programsRegistry', !!(SG.programsRegistry && SG.programsRegistry.list), '');
    ok('SG.harness', !!(SG.harness && SG.harness.status), SG.harness ? SG.harness.version : '');
    try {
      var plugs = SG.harness && SG.harness.listPlugins ? SG.harness.listPlugins() : [];
      var adapters = plugs.filter(function (x) { return x.source === 'adapter'; });
      ok('harness adapters', adapters.length >= 1, adapters.length + ' adapter(s)');
    } catch (e) {
      ok('harness adapters', false, String(e.message || e));
    }
    ok('SG.llamaServer', !!(SG.llamaServer && SG.llamaServer.probe), '');
    ok('SG.attachments', !!(SG.attachments && SG.attachments.processFiles), '');
    ok('SG.appOffline', !!(SG.appOffline && SG.appOffline.localCapable),
      SG.appOffline ? ('localCapable=' + SG.appOffline.localCapable()) : '');
    try {
      var h = SG.llamaServer && SG.llamaServer.getLastHealth ? SG.llamaServer.getLastHealth() : null;
      ok('llama-server health', !!(h && h.ok), h ? (h.ok ? (h.model || 'ok') : (h.error || 'down')) : 'not probed');
    } catch (e) {
      ok('llama-server health', false, String(e.message || e));
    }
    return lines.join('\n');
  }

  R.register({
    id: 'test',
    title: 'Test',
    icon: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 12h6M12 9v6"/>',
    order: 180,
    kind: 'custom',
    view: 'test',
    core: false,
    source: 'core:programs',
    version: '2.5.8',
    description: 'Smoke-test modular programs, harness, and offline readiness',
    capabilities: ['ui', 'diagnostics'],
    content:
      '<div class="prog-test" style="padding:12px;max-width:480px">' +
      '<h2 style="margin:0 0 8px;font-size:1.1rem">Athuex smoke test</h2>' +
      '<p class="muted">Verifies modules used on Galaxy A06 / Termux offline path.</p>' +
      '<pre id="prog-test-out" style="margin:10px 0;padding:10px;border-radius:8px;background:#16161a;font-size:12px;white-space:pre-wrap;min-height:120px">Tap Run checks</pre>' +
      '<p style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="btn-primary" id="prog-test-run">Run checks</button>' +
      '<button type="button" class="btn-secondary" id="prog-test-ping">Ping</button>' +
      '</p></div>',
    onActivate: function (prog) {
      setTimeout(function () {
        var out = document.getElementById('prog-test-out');
        var run = document.getElementById('prog-test-run');
        var ping = document.getElementById('prog-test-ping');
        if (run && !run.getAttribute('data-bound')) {
          run.setAttribute('data-bound', '1');
          run.addEventListener('click', function () {
            var report = runSmoke();
            if (out) out.textContent = report;
            if (typeof SG.toast === 'function') SG.toast('Smoke test finished');
          });
        }
        if (ping && !ping.getAttribute('data-bound')) {
          ping.setAttribute('data-bound', '1');
          ping.addEventListener('click', function () {
            if (typeof SG.toast === 'function') SG.toast('Test program OK · ' + ((prog && prog.version) || ''));
            else alert('Test program OK');
          });
        }
      }, 0);
    }
  });
})(window.SG = window.SG || {});
