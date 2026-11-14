/* harness_status / list_harness_plugins / scan_harness_plugins / set_harness_adapter — P6 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;

  R.register({
    name: 'harness_status',
    description: 'Status of the local llama.cpp harness (Termux llama-server, plugins, adapters, sampling, offline readiness).',
    source: 'core:harness',
    version: '2.5.8',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: async function () {
      if (!SG.harness || typeof SG.harness.status !== 'function') {
        return { ok: false, result: 'harness module not loaded', notify: true };
      }
      const st = SG.harness.status();
      return { ok: true, result: JSON.stringify(st, null, 2), notify: true };
    }
  });

  R.register({
    name: 'list_harness_plugins',
    description: 'List registered harness plugins and adapters (pre/post processors for local llama-server).',
    source: 'core:harness',
    version: '2.5.8',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: async function () {
      if (!SG.harness || typeof SG.harness.listPlugins !== 'function') {
        return { ok: false, result: 'harness module not loaded', notify: true };
      }
      return { ok: true, result: JSON.stringify(SG.harness.listPlugins(), null, 2), notify: true };
    }
  });

  R.register({
    name: 'scan_harness_plugins',
    description: 'Scan workspace for harness plugins (harness/*.js, adapters/*.js, or *.harness.js) and load them.',
    source: 'core:harness',
    version: '2.5.8',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: async function (args, ctx) {
      if (!SG.harness || typeof SG.harness.scanWorkspace !== 'function') {
        return { ok: false, result: 'harness module not loaded', notify: true };
      }
      const filesMap = (ctx && ctx.files) || {};
      const loaded = await SG.harness.scanWorkspace(filesMap);
      return { ok: true, result: 'Loaded ' + loaded.length + ' plugin file(s): ' + (loaded.join(', ') || '(none)'), notify: true };
    }
  });

  R.register({
    name: 'set_harness_adapter',
    description: 'Enable or disable a harness adapter by id (e.g. consciousness, thermodynamic).',
    source: 'core:harness',
    version: '2.5.8',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Adapter / plugin id' },
        enabled: { type: 'boolean', description: 'true to enable, false to disable' }
      },
      required: ['id', 'enabled'],
      additionalProperties: false
    },
    handler: async function (args) {
      if (!SG.harness || typeof SG.harness.enablePlugin !== 'function') {
        return { ok: false, result: 'harness module not loaded', notify: true };
      }
      const id = String((args && args.id) || '').trim();
      const on = !!(args && args.enabled);
      if (!id) return { ok: false, result: 'id required', notify: true };
      const ok = SG.harness.enablePlugin(id, on);
      if (!ok) return { ok: false, result: 'Unknown adapter: ' + id, notify: true };
      return { ok: true, result: id + ' ' + (on ? 'enabled' : 'disabled'), notify: true };
    }
  });
})(window.SG = window.SG || {});
