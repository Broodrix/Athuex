/* IDE module: command palette. See programsRegistry.register() in programs/ide.js */
(function (SG) {
  'use strict';
  SG.ide = SG.ide || {};

  function S() { return SG.ide.state; }

  function buildCommands() {
    var commands = [];
    SG.ide.vfs.list().forEach(function (p) {
      commands.push({ label: 'Open: ' + p, hint: 'file', run: function () { SG.ide.tabs.openFile(p); } });
    });
    commands.push(
      { label: 'New file', hint: 'Ctrl+N', run: SG.ide.tabs.newFile },
      { label: 'New folder', hint: '', run: SG.ide.tabs.newFolder },
      { label: 'Save', hint: 'Ctrl+S', run: function () { SG.ide.tabs.saveActive(); } },
      { label: 'Save as...', hint: '', run: SG.ide.tabs.saveAs },
      { label: 'Save all', hint: '', run: SG.ide.tabs.saveAll },
      { label: 'Close tab', hint: '', run: function () { if (S().activeTabId) SG.ide.tabs.closeTab(S().activeTabId); } },
      { label: 'Close all tabs', hint: '', run: SG.ide.tabs.closeAllTabs },
      { label: 'Next tab', hint: '', run: function () { SG.ide.tabs.cycleTab(1); } },
      { label: 'Previous tab', hint: '', run: function () { SG.ide.tabs.cycleTab(-1); } },
      { label: 'Toggle explorer', hint: '', run: SG.ide.toolbar.toggleSidebar },
      { label: 'Toggle word wrap', hint: '', run: SG.ide.toolbar.toggleWrap },
      { label: 'Toggle theme', hint: '', run: SG.ide.toolbar.toggleTheme },
      { label: 'Toggle line numbers', hint: '', run: SG.ide.toolbar.toggleLineNumbers },
      { label: 'Toggle auto save', hint: '', run: SG.ide.toolbar.toggleAutoSave },
      { label: 'Find', hint: 'Ctrl+F', run: function () { SG.ide.editor.openFind(false); } },
      { label: 'Replace', hint: 'Ctrl+H', run: function () { SG.ide.editor.openFind(true); } },
      { label: 'Go to line', hint: 'Ctrl+G', run: SG.ide.editor.gotoLine },
      { label: 'Toggle comment', hint: 'Ctrl+/', run: SG.ide.editor.toggleComment },
      { label: 'Duplicate line', hint: 'Ctrl+D', run: SG.ide.editor.duplicateLine },
      { label: 'Move line up', hint: 'Alt+Up', run: function () { SG.ide.editor.moveLine(-1); } },
      { label: 'Move line down', hint: 'Alt+Down', run: function () { SG.ide.editor.moveLine(1); } },
      { label: 'Format JSON', hint: '', run: SG.ide.editor.formatJSON },
      { label: 'Preview', hint: '', run: SG.ide.preview.openPreview },
      { label: 'Download active file', hint: '', run: function () {
        var tab = SG.ide.tabs.getActiveTab();
        if (!tab) return;
        var content = SG.ide.state.dom ? SG.ide.state.dom.ta.value : (SG.ide.vfs.read(tab.path) || '');
        SG.ide.utils.downloadFile(tab.path, content);
        SG.ide.dialogs.toast('Downloading ' + tab.name);
      } },
      { label: 'Import files', hint: '', run: SG.ide.tree.importFiles },
      { label: 'Change language...', hint: '', run: function () { showPalette('language'); } },
      { label: 'Increase font size', hint: '', run: function () { SG.ide.toolbar.changeFont(1); } },
      { label: 'Decrease font size', hint: '', run: function () { SG.ide.toolbar.changeFont(-1); } },
      { label: 'About IDE', hint: 'v' + SG.ide.config.VERSION, run: function () {
        SG.ide.dialogs.toast('IDE v' + SG.ide.config.VERSION + ' - VFS, tabs, highlight, preview');
      } }
    );
    return commands;
  }

  function buildLanguageCommands() {
    return Object.keys(SG.ide.config.LANGS).map(function (id) {
      return { label: SG.ide.config.LANGS[id].name, hint: id, run: function () { SG.ide.tabs.setLanguage(id); } };
    });
  }

  function buildTabCommands() {
    return S().tabs.map(function (t) {
      return { label: t.name, hint: t.path, run: function () { SG.ide.tabs.activateTab(t.id); } };
    });
  }

  function showPalette(mode) {
    var state = S();
    if (!state.global) return;
    state.paletteMode = mode || 'command';
    state.paletteIndex = 0;
    state.global.palette.hidden = false;
    state.global.paletteInput.value = '';
    if (state.paletteMode === 'language') state.paletteCommandsAll = buildLanguageCommands();
    else if (state.paletteMode === 'tabs') state.paletteCommandsAll = buildTabCommands();
    else state.paletteCommandsAll = buildCommands();
    renderPalette('');
    setTimeout(function () { try { state.global.paletteInput.focus(); } catch (_) {} }, 20);
  }

  function closePalette() {
    var state = S();
    if (!state.global) return;
    state.global.palette.hidden = true;
    if (state.dom && state.dom.ta) { try { state.dom.ta.focus(); } catch (_) {} }
  }

  function renderPalette(query) {
    var state = S();
    if (!state.global) return;
    var list = state.global.paletteList;
    list.innerHTML = '';
    var q = String(query || '').toLowerCase();
    // Bug fix: filter from paletteCommandsAll (source of truth), not the filtered subset
    var items = state.paletteCommandsAll.filter(function (c) {
      return !q || c.label.toLowerCase().indexOf(q) >= 0 || (c.hint && c.hint.toLowerCase().indexOf(q) >= 0);
    }).slice(0, 80);

    state.paletteCommands = items;
    if (state.paletteIndex >= items.length) state.paletteIndex = Math.max(0, items.length - 1);

    items.forEach(function (cmd, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ide-palette-item' + (i === state.paletteIndex ? ' active' : '');
      btn.setAttribute('role', 'option');
      var label = document.createElement('span');
      label.textContent = cmd.label;
      btn.appendChild(label);
      if (cmd.hint) {
        var hint = document.createElement('span');
        hint.className = 'ide-palette-hint';
        hint.textContent = cmd.hint;
        btn.appendChild(hint);
      }
      btn.addEventListener('click', function () {
        closePalette();
        try { cmd.run(); } catch (e) { SG.ide.dialogs.toast(String(e.message || e), 'error'); }
      });
      list.appendChild(btn);
    });

    if (!items.length) {
      var empty = document.createElement('div');
      empty.className = 'ide-palette-foot';
      empty.textContent = 'No results';
      list.appendChild(empty);
    }
  }

  SG.ide.palette = {
    showPalette: showPalette,
    closePalette: closePalette,
    renderPalette: renderPalette
  };
})(window.SG = window.SG || {});