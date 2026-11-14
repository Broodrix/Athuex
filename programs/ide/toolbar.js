/* IDE module: toolbar routing, settings, event binding, public API.
 * See programsRegistry.register() in programs/ide.js */
(function (SG) {
  'use strict';
  SG.ide = SG.ide || {};

  function S() { return SG.ide.state; }
  function D() { return SG.ide.state.dom; }

  function on(target, event, handler, opts) {
    target.addEventListener(event, handler, opts);
    S().cleanup.push(function () { target.removeEventListener(event, handler, opts); });
  }

  function toggleSidebar() {
    S().prefs.sidebar = !S().prefs.sidebar;
    SG.ide.shell.applyPrefs(); S().savePrefs(); S().saveSessionDebounced();
  }
  function toggleWrap() {
    S().prefs.wrap = !S().prefs.wrap;
    SG.ide.shell.applyPrefs(); S().savePrefs();
    SG.ide.editor.updateGutter(); SG.ide.editor.syncScroll();
  }
  function toggleTheme() {
    S().prefs.theme = S().prefs.theme === 'dark' ? 'light' : 'dark';
    SG.ide.shell.applyPrefs(); S().savePrefs(); S().saveSessionDebounced();
  }
  function toggleLineNumbers() {
    S().prefs.lineNumbers = !S().prefs.lineNumbers;
    SG.ide.shell.applyPrefs(); S().savePrefs(); SG.ide.editor.updateGutter();
  }
  function toggleAutoSave() {
    S().prefs.autoSave = !S().prefs.autoSave;
    S().savePrefs();
    SG.ide.dialogs.toast('Auto save ' + (S().prefs.autoSave ? 'on' : 'off'));
  }
  function changeFont(delta) {
    S().prefs.fontSize = SG.ide.utils.clamp(S().prefs.fontSize + delta, 10, 24);
    SG.ide.shell.applyPrefs(); S().savePrefs();
    SG.ide.editor.updateGutter(); SG.ide.editor.syncScroll();
  }

  function showSettingsMenu(anchor) {
    var rect = anchor.getBoundingClientRect();
    SG.ide.dialogs.showContextMenu(rect.left, rect.bottom + 4, [
      { label: 'Word wrap: ' + (S().prefs.wrap ? 'on' : 'off'), run: toggleWrap },
      { label: 'Line numbers: ' + (S().prefs.lineNumbers ? 'on' : 'off'), run: toggleLineNumbers },
      { label: 'Auto save: ' + (S().prefs.autoSave ? 'on' : 'off'), run: toggleAutoSave },
      { separator: true },
      { label: 'Increase font', run: function () { changeFont(1); } },
      { label: 'Decrease font', run: function () { changeFont(-1); } },
      { label: 'Format JSON', run: SG.ide.editor.formatJSON },
      { separator: true },
      { label: 'Download active file', run: function () {
        var tab = SG.ide.tabs.getActiveTab();
        if (tab) {
          var content = D().ta.value;
          SG.ide.utils.downloadFile(tab.path, content);
          SG.ide.dialogs.toast('Downloading ' + tab.name);
        }
      } },
      { label: 'Import files', run: SG.ide.tree.importFiles },
      { separator: true },
      { label: 'About IDE', run: function () { SG.ide.dialogs.toast('IDE v' + SG.ide.config.VERSION); } }
    ]);
  }

  function handleAction(action, target) {
    switch (action) {
      case 'toggle-sidebar': toggleSidebar(); break;
      case 'new-file': SG.ide.tabs.newFile(); break;
      case 'new-tab': SG.ide.tabs.createScratchTab(); break;
      case 'new-folder': SG.ide.tabs.newFolder(); break;
      case 'import-file': SG.ide.tree.importFiles(); break;
      case 'collapse-all': SG.ide.tree.collapseAll(); break;
      case 'save': SG.ide.tabs.saveActive(); break;
      case 'undo': SG.ide.editor.undo(); break;
      case 'redo': SG.ide.editor.redo(); break;
      case 'find': SG.ide.editor.openFind(false); break;
      case 'replace': SG.ide.editor.openFind(true); break;
      case 'palette': SG.ide.palette.showPalette('command'); break;
      case 'preview': SG.ide.preview.openPreview(); break;
      case 'completion': SG.ide.editor.showCompletions(); break;
      case 'wrap': toggleWrap(); break;
      case 'theme': toggleTheme(); break;
      case 'more': showSettingsMenu(target); break;
      case 'tab-menu': SG.ide.tabs.showTabMenu(target); break;
      case 'language': SG.ide.palette.showPalette('language'); break;
      case 'find-next': SG.ide.editor.findNext(1); break;
      case 'find-prev': SG.ide.editor.findNext(-1); break;
      case 'toggle-case': SG.ide.editor.toggleFindOption('case'); break;
      case 'toggle-regex': SG.ide.editor.toggleFindOption('regex'); break;
      case 'close-find': SG.ide.editor.closeFind(); break;
      case 'replace-one': SG.ide.editor.replaceOne(); break;
      case 'replace-all': SG.ide.editor.replaceAll(); break;
      default: break;
    }
  }

  function bindEvents() {
    var state = S();
    if (state.bound || !state.shell) return;
    state.bound = true;

    var dom = D();

    on(state.shell, 'click', function (e) {
      var actionEl = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-action');
      if (!action) return;
      e.preventDefault();
      handleAction(action, actionEl);
    });

    on(dom.tree, 'click', function (e) {
      var folderRow = e.target.closest ? e.target.closest('.ide-tree-row.folder') : null;
      if (folderRow) { SG.ide.tree.toggleFolder(folderRow.getAttribute('data-folder')); return; }
      var fileRow = e.target.closest ? e.target.closest('.ide-tree-row.file') : null;
      if (fileRow) SG.ide.tabs.openFile(fileRow.getAttribute('data-path'));
    });

    on(dom.tree, 'contextmenu', function (e) {
      var fileRow = e.target.closest ? e.target.closest('.ide-tree-row.file') : null;
      var folderRow = e.target.closest ? e.target.closest('.ide-tree-row.folder') : null;
      if (fileRow) {
        e.preventDefault();
        var p = fileRow.getAttribute('data-path');
        SG.ide.dialogs.showContextMenu(e.clientX, e.clientY, [
          { label: 'Open', run: function () { SG.ide.tabs.openFile(p); } },
          { label: 'Rename', run: function () { SG.ide.tree.renamePath(p); } },
          { label: 'Duplicate', run: function () { SG.ide.tree.duplicatePath(p); } },
          { label: 'Download', run: function () {
            SG.ide.utils.downloadFile(p, SG.ide.vfs.read(p) || '');
            SG.ide.dialogs.toast('Downloading ' + p);
          } },
          { separator: true },
          { label: 'Delete', danger: true, run: function () { SG.ide.tree.deletePath(p); } }
        ]);
      } else if (folderRow) {
        e.preventDefault();
        var f = folderRow.getAttribute('data-folder');
        SG.ide.dialogs.showContextMenu(e.clientX, e.clientY, [
          { label: 'New file here', run: function () { SG.ide.tree.newFileIn(f); } },
          { label: 'Rename folder', run: function () { SG.ide.tree.renamePath(f); } },
          { separator: true },
          { label: 'Delete folder', danger: true, run: function () { SG.ide.tree.deletePath(f); } }
        ]);
      }
    });

    // Long-press on mobile for context menu
    var longPressTimer = null;
    on(dom.tree, 'pointerdown', function (e) {
      var row = e.target.closest ? e.target.closest('.ide-tree-row') : null;
      if (!row) return;
      clearTimeout(longPressTimer);
      var x = e.clientX, y = e.clientY;
      longPressTimer = setTimeout(function () {
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: x, clientY: y }));
      }, 550);
    });
    on(dom.tree, 'pointerup', function () { clearTimeout(longPressTimer); });
    on(dom.tree, 'pointermove', function () { clearTimeout(longPressTimer); });

    on(dom.tree, 'keydown', function (e) {
      var row = e.target.closest ? e.target.closest('.ide-tree-row') : null;
      if (!row) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (row.classList.contains('file')) SG.ide.tabs.openFile(row.getAttribute('data-path'));
        else SG.ide.tree.toggleFolder(row.getAttribute('data-folder'));
      } else if (e.key === 'ArrowRight' && row.classList.contains('folder')) {
        e.preventDefault();
        S().expanded[row.getAttribute('data-folder')] = true;
        SG.ide.tree.refreshTree();
      } else if (e.key === 'ArrowLeft' && row.classList.contains('folder')) {
        e.preventDefault();
        S().expanded[row.getAttribute('data-folder')] = false;
        SG.ide.tree.refreshTree();
      }
    });

    on(dom.ta, 'input', SG.ide.editor.onInput);
    on(dom.ta, 'keydown', SG.ide.editor.onEditorKeyDown);
    on(dom.ta, 'scroll', SG.ide.editor.syncScroll, { passive: true });
    on(dom.ta, 'click', SG.ide.editor.updateStatus);
    on(dom.ta, 'keyup', SG.ide.editor.updateStatus);
    on(dom.ta, 'compositionstart', function () { if (state.shell) state.shell.classList.add('composing'); });
    on(dom.ta, 'compositionend', function () {
      if (state.shell) state.shell.classList.remove('composing');
      SG.ide.editor.onInput();
    });

    on(document, 'selectionchange', function () {
      if (!dom.ta || document.activeElement !== dom.ta) return;
      SG.ide.editor.updateStatus();
      // Re-render bracket match on selection change
      clearTimeout(bindEvents._selTimer);
      bindEvents._selTimer = setTimeout(function () {
        if (!S().prefs.wrap && dom.ta.value.length <= SG.ide.config.MAX_HIGHLIGHT) {
          SG.ide.editor.renderHighlight();
        }
      }, 160);
    });

    if (dom.findInput) {
      on(dom.findInput, 'input', SG.ide.editor.scheduleFind);
      on(dom.findInput, 'keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); SG.ide.editor.findNext(e.shiftKey ? -1 : 1); }
        if (e.key === 'Escape') { e.preventDefault(); SG.ide.editor.closeFind(); }
      });
    }
    if (dom.replaceInput) {
      on(dom.replaceInput, 'input', function () { S().find.replace = dom.replaceInput.value; });
      on(dom.replaceInput, 'keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); SG.ide.editor.replaceOne(); }
        if (e.key === 'Escape') { e.preventDefault(); SG.ide.editor.closeFind(); }
      });
    }

    if (state.global) {
      on(state.global.paletteInput, 'input', function () {
        state.paletteIndex = 0;
        SG.ide.palette.renderPalette(state.global.paletteInput.value);
      });
      on(state.global.paletteInput, 'keydown', function (e) {
        var items = state.paletteCommands;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          state.paletteIndex = Math.min(items.length - 1, state.paletteIndex + 1);
          SG.ide.palette.renderPalette(state.global.paletteInput.value);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          state.paletteIndex = Math.max(0, state.paletteIndex - 1);
          SG.ide.palette.renderPalette(state.global.paletteInput.value);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          var cmd = items[state.paletteIndex];
          if (cmd) {
            SG.ide.palette.closePalette();
            try { cmd.run(); } catch (err) { SG.ide.dialogs.toast(String(err.message || err), 'error'); }
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          SG.ide.palette.closePalette();
        }
      });
      on(state.global.palette, 'click', function (e) {
        if (e.target === state.global.palette) SG.ide.palette.closePalette();
      });
      on(state.global.preview, 'click', function (e) {
        var act = e.target.getAttribute && e.target.getAttribute('data-preview-action');
        if (act === 'close') SG.ide.preview.closePreview();
        if (act === 'refresh') SG.ide.preview.openPreview();
        if (act === 'clear') SG.ide.preview.clearConsole();
        if (e.target === state.global.preview) SG.ide.preview.closePreview();
      });
    }

    on(window, 'message', SG.ide.preview.onPreviewMessage);
    on(window, 'resize', function () {
      clearTimeout(bindEvents._resizeTimer);
      bindEvents._resizeTimer = setTimeout(function () {
        SG.ide.editor.syncScroll();
        SG.ide.editor.updateGutter();
      }, 120);
    });
    on(window, 'beforeunload', function () { S().flush(); });
    on(document, 'visibilitychange', function () { if (document.hidden) S().flush(); });

    on(window, 'storage', function (e) {
      if (e.key !== SG.ide.config.VFS_KEY) return;
      SG.ide.vfs.load();
      SG.ide.tree.refreshTree();
      var tab = SG.ide.tabs.getActiveTab();
      if (tab && !tab.dirty && dom.ta) {
        var content = SG.ide.vfs.read(tab.path);
        if (content != null && content !== dom.ta.value) {
          state.suppressInput = true;
          dom.ta.value = content;
          state.suppressInput = false;
          tab.content = content;
          SG.ide.editor.updateGutter();
          SG.ide.editor.renderHighlight();
          SG.ide.editor.updateStatus();
        }
      }
    });
  }

  function buildApi() {
    return {
      version: SG.ide.config.VERSION,
      openFile: function (path) { SG.ide.tabs.openFile(path); },
      newFile: SG.ide.tabs.newFile,
      save: function () { return SG.ide.tabs.saveActive(); },
      saveAs: SG.ide.tabs.saveAs,
      getActiveFile: function () {
        var t = SG.ide.tabs.getActiveTab();
        return t ? {
          id: t.id, path: t.path, name: t.name, language: t.language,
          dirty: !!t.dirty, content: D().ta ? D().ta.value : t.content
        } : null;
      },
      getValue: function () { return D().ta ? D().ta.value : ''; },
      setValue: function (value) { SG.ide.editor.setEditorContent(String(value == null ? '' : value)); },
      listFiles: function () { return SG.ide.vfs.list(); },
      readFile: function (p) { return SG.ide.vfs.read(p); },
      writeFile: function (path, content) {
        SG.ide.vfs.write(path, content);
        SG.ide.tree.refreshTree();
        S().saveSessionDebounced();
      },
      deleteFile: function (path) { SG.ide.tree.deletePath(path); },
      refresh: SG.ide.tree.refreshTree,
      showPalette: SG.ide.palette.showPalette,
      showFind: function () { SG.ide.editor.openFind(false); },
      showReplace: function () { SG.ide.editor.openFind(true); },
      toggleSidebar: toggleSidebar,
      openPreview: SG.ide.preview.openPreview,
      get editor() { return D().ta || null; }
    };
  }

  SG.ide.toolbar = {
    bindEvents: bindEvents,
    handleAction: handleAction,
    toggleSidebar: toggleSidebar,
    toggleWrap: toggleWrap,
    toggleTheme: toggleTheme,
    toggleLineNumbers: toggleLineNumbers,
    toggleAutoSave: toggleAutoSave,
    changeFont: changeFont,
    showSettingsMenu: showSettingsMenu,
    buildApi: buildApi
  };
})(window.SG = window.SG || {});