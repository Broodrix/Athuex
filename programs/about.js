/* Program: About — v1.0.0 */
(function (SG) {
  'use strict';
  const R = SG.programsRegistry;
  if (!R) return;
  R.register({
    id: 'about',
    title: 'About',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/>',
    order: 90,
    kind: 'dialog',
    view: 'about',
    panel: null,
    dialog: 'about-dialog',
    core: true,
    source: 'core:programs',
    version: '1.0.0',
    description: 'Built-in About program'
  });
})(window.SG = window.SG || {});
