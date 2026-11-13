/* Program: Chat — v1.3.6 */
(function (SG) {
  'use strict';
  const R = SG.programsRegistry;
  if (!R) return;
  R.register({
    id: 'chat',
    title: 'Chat',
    icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    order: 10,
    kind: 'panel',
    view: 'chat',
    panel: 'panel-chat',
    dialog: null,
    core: true,
    source: 'core:programs',
    version: '1.3.6',
    description: 'Built-in Chat program'
  });
})(window.SG = window.SG || {});
