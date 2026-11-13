/* open_program — activate a navbar program for user/AI — v1.0.8 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;
  R.register({
    name: 'open_program',
    source: 'core:programs',
    version: '1.0.8',
    description: 'Open/activate a UI program by id (chat, files, edit, preview, browser, calculator, debug, test, tools, about). Use after list_programs.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Program id, e.g. edit, files, calculator, debug' }
      },
      required: ['id']
    },
    handler: function (args) {
      const id = String((args && args.id) || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!id) return { ok: false, result: 'id required', notify: true };
      const list = (SG.programs && SG.programs.list) ? SG.programs.list()
        : (SG.programsRegistry ? SG.programsRegistry.list() : []);
      const hit = list.filter(function (p) { return p.id === id || p.view === id; })[0];
      if (!hit) {
        const ids = list.map(function (p) { return p.id; }).join(', ');
        return { ok: false, result: 'Unknown program "' + id + '". Available: ' + ids, notify: true };
      }
      try {
        if (SG.programs && typeof SG.programs.activate === 'function') {
          SG.programs.activate(hit.id);
        } else if (SG.programsRegistry && typeof SG.programsRegistry.activate === 'function') {
          SG.programsRegistry.activate(hit.id);
        } else {
          // Fallback: dispatch custom event app listens for
          window.dispatchEvent(new CustomEvent('athuex:open-program', { detail: { id: hit.id, view: hit.view || hit.id } }));
        }
      } catch (e) {
        return { ok: false, result: String(e.message || e), notify: true };
      }
      return { ok: true, result: 'Opened program: ' + hit.title + ' (' + hit.id + ')', notify: true };
    }
  });
})(window.SG = window.SG || {});
