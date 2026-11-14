/* ============================================================================
 * Program: Live — live view of IDE file
 * Path:    programs/preview.js
 * Version: 1.3.6
 *
 * Owns panel-preview. onActivate refreshes the iframe.
 * Hot-swap: workspace programs/preview.js → Programs → Scan.
 */
(function (SG) {
  'use strict';
  const R = SG.programsRegistry;
  if (!R) return;

  var META = {
    id: 'preview',
    title: 'Live',
    icon: '<circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>',
    order: 40,
    kind: 'panel',
    view: 'preview',
    panel: 'panel-preview',
    core: true,
    source: 'core:programs',
    version: '1.3.7',
    description: 'Always shows the file open in the IDE'
  };

  function onActivate(prog) {
    try {
      document.dispatchEvent(new CustomEvent('sg:program', {
        detail: { id: 'preview', action: 'activate', program: prog }
      }));
    } catch (_) {}
    if (SG.hooks && typeof SG.hooks.onPreviewActivate === 'function') {
      try { SG.hooks.onPreviewActivate(prog); } catch (e) { console.warn('[preview]', e); }
    }
    // Direct refresh if app exposed it
    try {
      if (typeof window.__athuexRefreshPreview === 'function') window.__athuexRefreshPreview();
    } catch (_) {}
  }

  R.register(Object.assign({}, META, { onActivate: onActivate }));
})(window.SG = window.SG || {});
