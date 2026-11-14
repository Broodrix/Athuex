/* list_programs — shared AI/user program catalog — v1.3.4 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;
  R.register({
    name: 'list_programs',
    source: 'core:programs', version: '1.3.4',
    description: 'List available UI programs/panels the user can open: id, title, enabled, kind. Use open_program(id) to switch to one (edit=IDE, files, preview, calculator, debug, …).',
    parameters: { type: 'object', properties: {} },
    handler: function () {
      const list = (SG.programs && SG.programs.list) ? SG.programs.list() : (SG.programsRegistry ? SG.programsRegistry.list() : []);
      if (!list.length) return { ok: true, result: '(no programs)', notify: true };
      const rows = list.map(function (p) {
        return p.id + ' | ' + p.title + ' | ' + (p.enabled ? 'on' : 'off') + ' | ' + p.kind + ' | ' + (p.source || '');
      });
      return { ok: true, result: rows.join('\n'), notify: true };
    }
  });
})(window.SG = window.SG || {});
