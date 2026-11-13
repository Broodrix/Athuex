/* IDE module: HTML shell + DOM cache. See programsRegistry.register() in programs/ide.js */
(function (SG) {
  'use strict';
  SG.ide = SG.ide || {};

  var SHELL_HTML = [
    '<aside class="ide-sidebar" id="ide-sidebar">',
      '<div class="ide-sidebar-head">',
        '<span class="ide-sidebar-title">Explorer</span>',
        '<div class="ide-sidebar-actions">',
          '<button class="ide-btn" data-action="new-file" title="New file" aria-label="New file"><span data-icon="filePlus"></span></button>',
          '<button class="ide-btn" data-action="new-folder" title="New folder" aria-label="New folder"><span data-icon="folderPlus"></span></button>',
          '<button class="ide-btn" data-action="import-file" title="Import file" aria-label="Import file"><span data-icon="upload"></span></button>',
        '</div>',
      '</div>',
      '<div class="ide-tree" id="ide-tree" role="tree" aria-label="Workspace files"></div>',
      '<div class="ide-sidebar-foot">',
        '<button class="ide-btn wide" data-action="collapse-all" title="Collapse folders"><span data-icon="chevronsDown"></span><span>Collapse</span></button>',
      '</div>',
    '</aside>',
    '<main class="ide-main">',
      '<div class="ide-tabs-strip">',
        '<div class="ide-tabs-list" id="ide-tabs-list" role="tablist" aria-label="Open editors"></div>',
        '<button class="ide-tab-add" data-action="new-tab" title="New tab" aria-label="New tab">+</button>',
        '<button class="ide-btn ide-tabs-more" data-action="tab-menu" title="Tab actions" aria-label="Tab actions"><span data-icon="more"></span></button>',
      '</div>',
      '<div class="ide-toolbar" role="toolbar" aria-label="Editor toolbar">',
        '<button class="ide-btn" data-action="toggle-sidebar" title="Toggle explorer" aria-label="Toggle explorer"><span data-icon="panelLeft"></span></button>',
        '<div class="ide-sep"></div>',
        '<button class="ide-btn" data-action="new-file" title="New file" aria-label="New file"><span data-icon="filePlus"></span></button>',
        '<button class="ide-btn" data-action="save" title="Save (Ctrl+S)" aria-label="Save"><span data-icon="save"></span></button>',
        '<button class="ide-btn" data-action="undo" title="Undo (Ctrl+Z)" aria-label="Undo"><span data-icon="undo"></span></button>',
        '<button class="ide-btn" data-action="redo" title="Redo (Ctrl+Y)" aria-label="Redo"><span data-icon="redo"></span></button>',
        '<div class="ide-sep"></div>',
        '<button class="ide-btn" data-action="find" title="Find (Ctrl+F)" aria-label="Find"><span data-icon="search"></span></button>',
        '<button class="ide-btn" data-action="replace" title="Replace (Ctrl+H)" aria-label="Replace"><span data-icon="replace"></span></button>',
        '<button class="ide-btn" data-action="palette" title="Command palette (Ctrl+Shift+P)" aria-label="Command palette"><span data-icon="command"></span></button>',
        '<div class="ide-sep"></div>',
        '<button class="ide-btn" data-action="preview" title="Preview (HTML/Markdown/CSS/JS)" aria-label="Preview"><span data-icon="play"></span></button>',
        '<button class="ide-btn" data-action="completion" title="Suggestions (Ctrl+Space)" aria-label="Suggestions"><span data-icon="zap"></span></button>',
        '<button class="ide-btn" data-action="wrap" title="Toggle word wrap" aria-label="Toggle word wrap"><span data-icon="wrap"></span></button>',
        '<button class="ide-btn" data-action="theme" title="Toggle theme" aria-label="Toggle theme"><span data-icon="moon"></span></button>',
        '<button class="ide-btn" data-action="more" title="More actions" aria-label="More actions"><span data-icon="more"></span></button>',
      '</div>',
      '<div class="ide-breadcrumb" id="ide-breadcrumb" aria-label="File path"></div>',
      '<div class="ide-editor-wrap" id="ide-editor-wrap">',
        '<div class="ide-gutter" id="ide-gutter" aria-hidden="true"><div class="ide-gutter-inner" id="ide-gutter-inner"></div></div>',
        '<div class="ide-editor-stack">',
          '<pre class="ide-highlight" id="ide-highlight" aria-hidden="true"><code id="ide-highlight-code"></code></pre>',
          '<textarea id="code-editor" class="ide-textarea" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="Code editor"></textarea>',
        '</div>',
        '<div class="ide-findbar" id="ide-findbar" hidden>',
          '<div class="ide-findrow">',
            '<input id="ide-find-input" class="ide-input" placeholder="Find" aria-label="Find" autocomplete="off" spellcheck="false">',
            '<span id="ide-find-count" class="ide-find-count">0/0</span>',
            '<button class="ide-btn" data-action="find-prev" title="Previous match" aria-label="Previous match"><span data-icon="arrowUp"></span></button>',
            '<button class="ide-btn" data-action="find-next" title="Next match" aria-label="Next match"><span data-icon="arrowDown"></span></button>',
            '<button class="ide-btn" data-action="toggle-case" title="Match case" aria-label="Match case">Aa</button>',
            '<button class="ide-btn" data-action="toggle-regex" title="Use regular expression" aria-label="Use regular expression">.*</button>',
            '<button class="ide-btn" data-action="close-find" title="Close find" aria-label="Close find"><span data-icon="x"></span></button>',
          '</div>',
          '<div class="ide-findrow">',
            '<input id="ide-replace-input" class="ide-input" placeholder="Replace" aria-label="Replace" autocomplete="off" spellcheck="false">',
            '<button class="ide-btn" data-action="replace-one" title="Replace" aria-label="Replace">Replace</button>',
            '<button class="ide-btn" data-action="replace-all" title="Replace all" aria-label="Replace all">All</button>',
          '</div>',
        '</div>',
      '</div>',
      '<div class="ide-statusbar">',
        '<div class="ide-status-left">',
          '<button class="ide-status-item" data-action="language" id="ide-status-language" title="Change language">Plain Text</button>',
          '<span class="ide-status-item" id="ide-status-path"></span>',
        '</div>',
        '<div class="ide-status-right">',
          '<span class="ide-status-item" id="ide-status-pos">Ln 1, Col 1</span>',
          '<span class="ide-status-item" id="ide-status-indent">Spaces: 2</span>',
          '<span class="ide-status-item">UTF-8</span>',
          '<span class="ide-status-item" id="ide-status-save">Saved</span>',
        '</div>',
      '</div>',
    '</main>',
    '<div class="ide-completions" id="ide-completions" hidden role="listbox" aria-label="Suggestions"></div>'
  ].join('');

  function cacheDom(shell) {
    SG.ide.state.dom = {
      shell: shell,
      ta: shell.querySelector('#code-editor'),
      tabsList: shell.querySelector('#ide-tabs-list'),
      tree: shell.querySelector('#ide-tree'),
      sidebar: shell.querySelector('#ide-sidebar'),
      gutter: shell.querySelector('#ide-gutter'),
      gutterInner: shell.querySelector('#ide-gutter-inner'),
      hl: shell.querySelector('#ide-highlight'),
      codeEl: shell.querySelector('#ide-highlight-code'),
      breadcrumb: shell.querySelector('#ide-breadcrumb'),
      statusLanguage: shell.querySelector('#ide-status-language'),
      statusPath: shell.querySelector('#ide-status-path'),
      statusPos: shell.querySelector('#ide-status-pos'),
      statusIndent: shell.querySelector('#ide-status-indent'),
      statusSave: shell.querySelector('#ide-status-save'),
      findBar: shell.querySelector('#ide-findbar'),
      findInput: shell.querySelector('#ide-find-input'),
      replaceInput: shell.querySelector('#ide-replace-input'),
      findCount: shell.querySelector('#ide-find-count'),
      completions: shell.querySelector('#ide-completions')
    };
  }

  function ensureShell() {
    var state = SG.ide.state;
    var panel = document.getElementById('panel-edit') || document.getElementById('panel-ide');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'panel-edit';
      document.body.appendChild(panel);
    }
    panel.classList.add('ide-panel-host');
    try { if (window.getComputedStyle(panel).position === 'static') panel.style.position = 'relative'; } catch (_) {}

    var shell = panel.querySelector('.ide-shell');
    if (!shell) {
      shell = document.createElement('div');
      shell.className = 'ide-shell';
      shell.setAttribute('data-theme', (state.prefs && state.prefs.theme) || 'dark');
      shell.innerHTML = SHELL_HTML;
      panel.appendChild(shell);

      var placeholder = shell.querySelector('#code-editor');
      var all = panel.querySelectorAll('#code-editor');
      var existing = null;
      for (var i = 0; i < all.length; i++) {
        if (all[i] !== placeholder) { existing = all[i]; break; }
      }

      if (existing) {
        state.hostInitialContent = existing.value || '';
        if (existing.tagName === 'TEXTAREA') {
          existing.classList.add('ide-textarea');
          ['position', 'top', 'left', 'right', 'bottom', 'width', 'height', 'padding', 'margin', 'border', 'outline', 'background', 'color', 'font', 'lineHeight', 'whiteSpace', 'resize', 'overflow', 'zIndex'].forEach(function (p) {
            try { existing.style.removeProperty(p); } catch (_) {}
          });
          existing.setAttribute('spellcheck', 'false');
          existing.setAttribute('autocapitalize', 'off');
          existing.setAttribute('autocomplete', 'off');
          existing.setAttribute('autocorrect', 'off');
          existing.setAttribute('wrap', 'off');
          existing.setAttribute('aria-label', 'Code editor');
          placeholder.parentNode.replaceChild(existing, placeholder);
        } else {
          existing.id = 'code-editor-host';
          existing.style.display = 'none';
        }
      }
    } else {
      shell.hidden = false;
    }

    state.shell = shell;
    cacheDom(shell);
    SG.ide.icons.paintIcons(shell);
    applyPrefs();
  }

  function ensureGlobalUI() {
    var state = SG.ide.state;
    if (state.global) return;
    var shell = state.shell;
    if (!shell) return;

    var palette = document.createElement('div');
    palette.id = 'ide-palette';
    palette.className = 'ide-palette';
    palette.hidden = true;
    palette.innerHTML =
      '<div class="ide-palette-box" role="dialog" aria-modal="true" aria-label="Command palette">' +
        '<input id="ide-palette-input" class="ide-palette-input" placeholder="Type a command or file name..." autocomplete="off" spellcheck="false">' +
        '<div id="ide-palette-list" class="ide-palette-list" role="listbox"></div>' +
        '<div class="ide-palette-foot">Up/Down navigate &middot; Enter run &middot; Esc close</div>' +
      '</div>';
    shell.appendChild(palette);

    var preview = document.createElement('div');
    preview.id = 'ide-preview';
    preview.className = 'ide-preview';
    preview.hidden = true;
    preview.innerHTML =
      '<div class="ide-preview-box" role="dialog" aria-modal="true" aria-label="Preview">' +
        '<div class="ide-preview-head">' +
          '<span class="ide-preview-title" id="ide-preview-title">Preview</span>' +
          '<div class="ide-preview-actions">' +
            '<button class="ide-btn" data-preview-action="refresh" title="Refresh preview" aria-label="Refresh preview"><span data-icon="refresh"></span></button>' +
            '<button class="ide-btn" data-preview-action="clear" title="Clear console" aria-label="Clear console"><span data-icon="trash"></span></button>' +
            '<button class="ide-btn" data-preview-action="close" title="Close preview" aria-label="Close preview"><span data-icon="x"></span></button>' +
          '</div>' +
        '</div>' +
        '<div class="ide-preview-body">' +
          '<iframe id="ide-preview-frame" sandbox="allow-scripts allow-forms allow-modals" title="Preview"></iframe>' +
          '<div class="ide-console" id="ide-console" aria-live="polite"></div>' +
        '</div>' +
      '</div>';
    shell.appendChild(preview);

    var toastEl = document.createElement('div');
    toastEl.id = 'ide-toast';
    toastEl.className = 'ide-toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    shell.appendChild(toastEl);

    SG.ide.icons.paintIcons(preview);

    state.global = {
      palette: palette,
      paletteInput: palette.querySelector('#ide-palette-input'),
      paletteList: palette.querySelector('#ide-palette-list'),
      preview: preview,
      previewTitle: preview.querySelector('#ide-preview-title'),
      previewFrame: preview.querySelector('#ide-preview-frame'),
      consoleEl: preview.querySelector('#ide-console'),
      toast: toastEl
    };
  }

  function applyPrefs() {
    var state = SG.ide.state;
    if (!state.shell || !state.prefs) return;
    state.shell.setAttribute('data-theme', state.prefs.theme);
    state.shell.style.setProperty('--ide-font-size', state.prefs.fontSize + 'px');
    state.shell.classList.toggle('wrap', !!state.prefs.wrap);
    state.shell.classList.toggle('hide-gutter', !state.prefs.lineNumbers || !!state.prefs.wrap);
    state.shell.classList.toggle('sidebar-collapsed', !state.prefs.sidebar);
    var dom = state.dom;
    if (dom && dom.ta) dom.ta.setAttribute('wrap', state.prefs.wrap ? 'soft' : 'off');
    if (dom && dom.gutter) dom.gutter.hidden = !state.prefs.lineNumbers || !!state.prefs.wrap;
  }

  SG.ide.shell = {
    SHELL_HTML: SHELL_HTML,
    ensureShell: ensureShell,
    cacheDom: cacheDom,
    ensureGlobalUI: ensureGlobalUI,
    applyPrefs: applyPrefs
  };
})(window.SG = window.SG || {});