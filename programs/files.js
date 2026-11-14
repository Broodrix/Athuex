/* ============================================================================
 * Program: Files — main memory browser
 * Path:    programs/files.js
 * Version: 1.3.6
 *
 * Owns the Files panel (panel-files). Edit this module to change
 * how the Files chip behaves when activated.
 *
 * Hot-swap: copy into workspace as programs/files.js → Programs → Scan.
 */
(function (SG) {
  'use strict';
  const R = SG.programsRegistry;
  if (!R) return;

  var META = {
    id: 'files',
    title: 'Files',
    icon: '<path d="M2.5 6.6c0-1.05.85-1.9 1.9-1.9h4.1c.5 0 .98.2 1.34.55l1.2 1.2h7.96c1.05 0 1.9.85 1.9 1.9v8.9c0 1.05-.85 1.9-1.9 1.9H4.4a1.9 1.9 0 0 1-1.9-1.9V6.6Z"/>',
    order: 20,
    kind: 'panel',
    view: 'files',
    panel: 'panel-files',
    core: true,
    source: 'core:programs',
    version: '1.3.6',
    description: 'Browse main workspace and external SMFS / imported volumes'
  };

  function onActivate(prog) {
    try {
      document.dispatchEvent(new CustomEvent('sg:program', {
        detail: { id: 'files', action: 'activate', program: prog }
      }));
    } catch (_) {}
    if (SG.hooks && typeof SG.hooks.onFilesActivate === 'function') {
      try { SG.hooks.onFilesActivate(prog); } catch (e) { console.warn('[files]', e); }
    }
  }

  R.register(Object.assign({}, META, { onActivate: onActivate }));
})(window.SG = window.SG || {});
