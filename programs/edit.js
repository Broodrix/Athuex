/* ============================================================================
 * Program: IDE — code editor
 * Path:    programs/edit.js
 * Version: 1.3.6
 *
 * Owns panel-edit. onActivate focuses the editor.
 * Hot-swap: workspace programs/edit.js → Programs → Scan.
 */
(function (SG) {
  'use strict';
  const R = SG.programsRegistry;
  if (!R) return;

  var META = {
    id: 'edit',
    title: 'IDE',
    icon: '<path d="M6.5 2.5h7l5 5v13a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/><path d="M13.5 2.5V7.5h5"/><path d="M8 13h8M8 17h5"/>',
    order: 30,
    kind: 'panel',
    view: 'edit',
    panel: 'panel-edit',
    core: true,
    source: 'core:programs',
    version: '1.3.6',
    description: 'Edit workspace files (main memory)'
  };

  function onActivate(prog) {
    try {
      document.dispatchEvent(new CustomEvent('sg:program', {
        detail: { id: 'edit', action: 'activate', program: prog }
      }));
    } catch (_) {}
    var ed = document.getElementById('code-editor');
    if (ed) { try { ed.focus(); } catch (_) {} }
    if (SG.hooks && typeof SG.hooks.onEditActivate === 'function') {
      try { SG.hooks.onEditActivate(prog); } catch (e) { console.warn('[edit]', e); }
    }
  }

  R.register(Object.assign({}, META, { onActivate: onActivate }));
})(window.SG = window.SG || {});