/* Program: Tools — v1.3.6 */
(function (SG) {
  'use strict';
  const R = SG.programsRegistry;
  if (!R) return;
  R.register({
    id: 'tools',
    title: 'Tools',
    icon: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    order: 60,
    kind: 'panel',
    view: 'tools',
    panel: 'panel-tools',
    dialog: null,
    core: true,
    source: 'core:programs',
    version: '1.3.6',
    description: 'Built-in Tools program'
  });
})(window.SG = window.SG || {});
