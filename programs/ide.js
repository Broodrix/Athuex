/* ============================================================================
 * IDE - main entry (registers with programsRegistry)
 * Path:    programs/ide.js
 * Version: 2.0.0
 *
 * Loading model:
 *   - This file registers the "ide" program.
 *   - Helper files under programs/ide/*.js self-populate SG.ide.<module>
 *     and are loaded by scanWorkspace (each carries a
 *     programsRegistry.register() reference in a comment for scan filter).
 *   - Cross-module calls happen only inside function bodies → load order
 *     does not matter.
 * ========================================================================== */
(function (SG) {
  'use strict';
  var R = SG.programsRegistry;
  if (!R) return;

  var META = {
    id: 'ide',
    title: 'IDE',
    icon: '<path d="M4 4h16v16H4z"/><path d="M8 9l3 3-3 3M13 15h4"/>',
    order: 30,
    kind: 'panel',
    view: 'edit',
    panel: 'panel-edit',
    core: true,
    source: 'core:programs',
    version: '2.0.0',
    description: 'Multi-tab code editor with explorer, syntax highlighting, preview, find/replace and command palette'
  };

  var REQUIRED = [
    'utils', 'config', 'tokenizers', 'vfs', 'state',
    'icons', 'styles', 'shell', 'dialogs',
    'editor', 'tabs', 'tree', 'palette', 'preview', 'toolbar'
  ];

  function missingModules() {
    if (!SG.ide) return REQUIRED.slice();
    return REQUIRED.filter(function (n) { return !SG.ide[n]; });
  }

  function renderLoadError(panel, missing) {
    if (!panel) return;
    panel.innerHTML =
      '<div style="padding:20px;color:#f85149;font:13px ui-monospace,monospace;white-space:pre-wrap">' +
      'IDE failed to load.\n\nMissing modules:\n  ' +
      missing.join('\n  ') +
      '\n\nEnsure all files under programs/ide/ are present and error-free.' +
      '</div>';
  }

  function init(prog) {
    var missing = missingModules();
    if (missing.length) {
      console.error('[ide] missing modules:', missing);
      renderLoadError(document.getElementById('panel-edit'), missing);
      return;
    }

    var state = SG.ide.state;

    state.loadState();

    SG.ide.shell.ensureStyles();
    SG.ide.shell.ensureShell();
    SG.ide.shell.ensureGlobalUI();
    SG.ide.toolbar.bindEvents();

    if (!state.restored) state.restoreTabs();

    SG.ide.tabs.renderTabs();
    SG.ide.tree.refreshTree();
    SG.ide.tabs.activateTab(state.activeTabId);
    SG.ide.shell.applyPrefs();
    SG.ide.tabs.updateBreadcrumb();
    SG.ide.tabs.updateSaveStatus();

    SG.ide.api = SG.ide.api || SG.ide.toolbar.buildApi();
    if (prog) prog.api = SG.ide.api;

    try {
      document.dispatchEvent(new CustomEvent('sg:program', {
        detail: { id: 'ide', action: 'activate', program: prog }
      }));
    } catch (_) {}

    if (SG.hooks && typeof SG.hooks.onEditActivate === 'function') {
      try { SG.hooks.onEditActivate(prog); } catch (e) { console.warn('[ide] hook', e); }
    }

    state.emit('ready', { version: META.version });

    setTimeout(function () {
      var ta = SG.ide.state.dom && SG.ide.state.dom.ta;
      if (ta) { try { ta.focus(); } catch (_) {} }
    }, 60);
  }

  function onActivate(prog) {
    try { init(prog); } catch (e) {
      console.error('[ide] init failed:', e);
      try {
        var panel = document.getElementById('panel-edit');
        if (panel) renderLoadError(panel, ['(runtime: ' + e.message + ')']);
      } catch (_) {}
    }
  }

  function onTeardown() {
    try {
      SG.ide.state.flush();
      var cleanup = SG.ide.state.cleanup;
      for (var i = 0; i < cleanup.length; i++) {
        try { cleanup[i](); } catch (_) {}
      }
      SG.ide.state.cleanup = [];

      var shell = SG.ide.state.shell;
      if (shell && shell.parentNode) shell.parentNode.removeChild(shell);
      SG.ide.state.shell = null;
      SG.ide.state.dom = null;
      SG.ide.state.global = null;
      SG.ide.state.bound = false;
      SG.ide.state.restored = false;
      SG.ide.state.tabs = [];
      SG.ide.state.activeTabId = null;
    } catch (e) {
      console.warn('[ide] teardown', e);
    }
  }

  R.register(Object.assign({}, META, {
    onActivate: onActivate,
    onTeardown: onTeardown
  }));
})(window.SG = window.SG || {});