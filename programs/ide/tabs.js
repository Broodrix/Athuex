/* IDE module: multi-tab lifecycle, persistence and file operations. */
(function (SG) {
  'use strict';
  SG.ide = SG.ide || {};

  function S() { return SG.ide.state; }
  function D() { return S().dom || {}; }
  function U() { return SG.ide.utils; }
  function V() { return SG.ide.vfs; }
  function C() { return SG.ide.config; }

  function getTab(id) {
    id = id || S().activeTabId;
    return S().tabs.find(function (tab) { return tab.id === id; }) || null;
  }

  function findTabByPath(path) {
    path = U().normalizePath(path);
    return S().tabs.find(function (tab) { return tab.path === path; }) || null;
  }

  function makeTab(path, content, opts) {
    opts = opts || {};
    path = U().normalizePath(path) || 'untitled.txt';
    var tab = {
      id: String(opts.id || U().uid('tab')),
      path: path,
      name: U().basename(path),
      language: opts.language || C().languageForPath(path),
      content: String(content == null ? '' : content),
      dirty: !!opts.dirty,
      pinned: !!opts.pinned,
      cursor: opts.cursor || null,
      scrollTop: Number(opts.scrollTop) || 0,
      history: { stack: [String(content == null ? '' : content)], index: 0 }
    };
    return tab;
  }

  function syncActiveFromEditor() {
    var tab = getTab();
    var ta = D().ta;
    if (!tab || !ta) return;
    tab.content = ta.value;
    tab.cursor = { start: ta.selectionStart, end: ta.selectionEnd };
    tab.scrollTop = ta.scrollTop;
  }

  function updateBreadcrumb() {
    var tab = getTab();
    if (D().breadcrumb) D().breadcrumb.textContent = tab ? tab.path : '';
  }

  function updateLanguageUI() {
    var tab = getTab();
    var el = D().statusLanguage;
    if (el) el.textContent = tab ? C().langConfig(tab.language).name : 'Plain Text';
  }

  function updateSaveStatus() {
    var tab = getTab();
    var el = D().statusSave;
    if (el) {
      el.textContent = tab ? (tab.dirty ? 'Modified' : 'Saved') : '';
      el.classList.toggle('dirty', !!(tab && tab.dirty));
    }
    updateBreadcrumb();
    updateLanguageUI();
  }

  function renderTabs() {
    var host = D().tabsList;
    if (!host) return;
    host.textContent = '';
    S().tabs.forEach(function (tab) {
      var item = document.createElement('div');
      item.className = 'ide-tab' + (tab.id === S().activeTabId ? ' active' : '') +
        (tab.dirty ? ' dirty' : '') + (tab.pinned ? ' pinned' : '');
      item.setAttribute('role', 'presentation');

      var activate = document.createElement('button');
      activate.type = 'button';
      activate.className = 'ide-tab-name';
      activate.setAttribute('role', 'tab');
      activate.setAttribute('aria-selected', tab.id === S().activeTabId ? 'true' : 'false');
      activate.textContent = tab.name;
      activate.title = tab.path;
      activate.addEventListener('click', function () { activateTab(tab.id); });
      item.appendChild(activate);

      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'ide-tab-close';
      close.setAttribute('aria-label', 'Close ' + tab.name);
      close.title = 'Close tab';
      close.textContent = '×';
      close.addEventListener('click', function (event) {
        event.stopPropagation();
        closeTab(tab.id);
      });
      item.appendChild(close);
      host.appendChild(item);
    });
  }

  function activateTab(id) {
    var target = getTab(id);
    if (!target) return false;
    if (S().activeTabId === target.id) {
      updateSaveStatus();
      return true;
    }
    syncActiveFromEditor();
    S().activeTabId = target.id;
    var ta = D().ta;
    if (ta) {
      S().suppressInput = true;
      ta.value = target.content;
      S().suppressInput = false;
      ta.scrollTop = target.scrollTop || 0;
      if (target.cursor) {
        try {
          ta.setSelectionRange(
            Math.min(target.cursor.start || 0, ta.value.length),
            Math.min(target.cursor.end || target.cursor.start || 0, ta.value.length)
          );
        } catch (_) {}
      } else {
        try { ta.setSelectionRange(0, 0); } catch (_) {}
      }
    }
    renderTabs();
    updateBreadcrumb();
    updateLanguageUI();
    updateSaveStatus();
    if (SG.ide.editor) {
      SG.ide.editor.updateGutter();
      SG.ide.editor.renderHighlight();
      SG.ide.editor.updateStatus();
    }
    S().saveSessionDebounced();
    return true;
  }

  function saveActive(silent) {
    var tab = getTab();
    if (!tab) return false;
    syncActiveFromEditor();
    if (!V().write(tab.path, tab.content, { silent: !!silent })) return false;
    tab.dirty = false;
    V().save();
    if (!silent) SG.ide.dialogs.toast('Saved ' + tab.name);
    renderTabs();
    updateSaveStatus();
    if (SG.ide.tree) SG.ide.tree.refreshTree();
    S().saveSessionDebounced();
    return true;
  }

  function saveAll() {
    syncActiveFromEditor();
    var ok = true;
    S().tabs.forEach(function (tab) {
      if (!V().write(tab.path, tab.content, { silent: true })) ok = false;
      else tab.dirty = false;
    });
    V().save();
    renderTabs();
    updateSaveStatus();
    S().saveSessionDebounced();
    if (SG.ide.tree) SG.ide.tree.refreshTree();
    return ok;
  }

  function saveAs(id) {
    var tab = getTab(id);
    if (!tab) return Promise.resolve(false);
    syncActiveFromEditor();
    return SG.ide.dialogs.showPrompt('Save file as', tab.path, 'folder/file.ext').then(function (value) {
      if (!value) return false;
      var path = U().normalizePath(value);
      if (!path) { SG.ide.dialogs.toast('Invalid file path', 'error'); return false; }
      if (path !== tab.path && V().exists(path)) {
        return SG.ide.dialogs.showConfirm('Replace existing file "' + path + '"?', 'Replace').then(function (yes) {
          if (!yes) return false;
          V().write(path, tab.content, { silent: true });
          if (V().exists(tab.path)) V().remove(tab.path);
          tab.path = path;
          tab.name = U().basename(path);
          tab.language = C().languageForPath(path);
          tab.dirty = false;
          V().save();
          renderTabs(); updateSaveStatus();
          if (SG.ide.tree) SG.ide.tree.refreshTree();
          S().saveSession();
          return true;
        });
      }
      if (path !== tab.path) {
        V().write(path, tab.content, { silent: true });
        if (V().exists(tab.path)) V().remove(tab.path);
      } else {
        V().write(path, tab.content, { silent: true });
      }
      tab.path = path;
      tab.name = U().basename(path);
      tab.language = C().languageForPath(path);
      tab.dirty = false;
      V().save();
      renderTabs(); updateSaveStatus();
      if (SG.ide.tree) SG.ide.tree.refreshTree();
      S().saveSession();
      return true;
    });
  }

  function openFile(path) {
    path = U().normalizePath(path);
    if (!path || !V().exists(path)) return false;
    var existing = findTabByPath(path);
    if (existing) return activateTab(existing.id);
    syncActiveFromEditor();
    var content = V().read(path);
    if (content == null) return false;
    var tab = makeTab(path, content);
    S().tabs.push(tab);
    activateTab(tab.id);
    renderTabs();
    S().saveSessionDebounced();
    return true;
  }

  function uniqueUntitled() {
    var i = 1;
    var path;
    do { path = 'untitled-' + i + '.txt'; i++; } while (V().exists(path) || findTabByPath(path));
    return path;
  }

  function createScratchTab() {
    syncActiveFromEditor();
    var tab = makeTab(uniqueUntitled(), '');
    S().tabs.push(tab);
    activateTab(tab.id);
    renderTabs();
    return tab;
  }

  function newFile() {
    return SG.ide.dialogs.showPrompt('New file', '', 'filename.ext').then(function (value) {
      if (!value) return false;
      var path = U().normalizePath(value);
      if (!path) return false;
      if (V().exists(path)) {
        SG.ide.dialogs.toast('That path already exists', 'error');
        return false;
      }
      V().write(path, '');
      if (SG.ide.tree) SG.ide.tree.refreshTree();
      return openFile(path);
    });
  }

  function newFolder() {
    return SG.ide.dialogs.showPrompt('New folder', '', 'folder/name').then(function (value) {
      if (!value) return false;
      var path = U().normalizePath(value);
      if (!path || V().exists(path)) {
        SG.ide.dialogs.toast('Invalid or existing folder', 'error');
        return false;
      }
      V().addFolder(path);
      if (SG.ide.tree) SG.ide.tree.refreshTree();
      SG.ide.dialogs.toast('Folder created');
      return true;
    });
  }

  function closeTab(id) {
    var tab = getTab(id);
    if (!tab) return Promise.resolve(false);
    function remove() {
      var index = S().tabs.indexOf(tab);
      if (index < 0) return false;
      if (tab.id === S().activeTabId) syncActiveFromEditor();
      S().tabs.splice(index, 1);
      if (tab.id === S().activeTabId) {
        var next = S().tabs[Math.min(index, S().tabs.length - 1)] || S().tabs[index - 1];
        S().activeTabId = null;
        if (next) activateTab(next.id);
        else createScratchTab();
      }
      renderTabs();
      updateSaveStatus();
      S().saveSession();
      return true;
    }
    if (!tab.dirty) return Promise.resolve(remove());
    return SG.ide.dialogs.showConfirm('Save changes to "' + tab.name + '" before closing?', 'Save').then(function (yes) {
      if (yes) {
        if (tab.id === S().activeTabId) {
          if (!saveActive()) return false;
        } else {
          V().write(tab.path, tab.content);
          tab.dirty = false;
        }
      }
      return remove();
    });
  }

  function closeAllTabs() {
    var ids = S().tabs.map(function (tab) { return tab.id; });
    return ids.reduce(function (promise, id) {
      return promise.then(function (ok) {
        if (!ok) return false;
        return closeTab(id);
      });
    }, Promise.resolve(true)).then(function () {
      if (!S().tabs.length) createScratchTab();
      return true;
    });
  }

  function cycleTab(direction) {
    if (!S().tabs.length) return;
    var index = S().tabs.findIndex(function (tab) { return tab.id === S().activeTabId; });
    var next = (index + (direction < 0 ? -1 : 1) + S().tabs.length) % S().tabs.length;
    activateTab(S().tabs[next].id);
  }

  function setLanguage(language) {
    if (!C().LANGS[language]) return false;
    var tab = getTab();
    if (!tab) return false;
    tab.language = language;
    if (!S().prefs.languageOverrides) S().prefs.languageOverrides = {};
    S().prefs.languageOverrides[tab.path] = language;
    S().savePrefs();
    updateLanguageUI();
    if (SG.ide.editor) SG.ide.editor.renderHighlight();
    S().saveSessionDebounced();
    return true;
  }

  function showTabMenu(target) {
    var rect = target && target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 16, bottom: 48 };
    SG.ide.dialogs.showContextMenu(rect.left, rect.bottom, [
      { label: 'New scratch tab', run: createScratchTab },
      { label: 'Save all', run: saveAll },
      { label: 'Close active tab', run: function () { if (S().activeTabId) closeTab(S().activeTabId); } },
      { label: 'Close all tabs', run: closeAllTabs },
      { label: 'Next tab', run: function () { cycleTab(1); } },
      { label: 'Previous tab', run: function () { cycleTab(-1); } }
    ]);
  }

  SG.ide.tabs = {
    makeTab: makeTab, getTab: getTab, getActiveTab: function () { return getTab(); },
    findTabByPath: findTabByPath, renderTabs: renderTabs, activateTab: activateTab,
    updateBreadcrumb: updateBreadcrumb, updateLanguageUI: updateLanguageUI,
    updateSaveStatus: updateSaveStatus, saveActive: saveActive, saveAll: saveAll,
    saveAs: saveAs, openFile: openFile, createScratchTab: createScratchTab,
    newFile: newFile, newFolder: newFolder, closeTab: closeTab,
    closeAllTabs: closeAllTabs, cycleTab: cycleTab, setLanguage: setLanguage,
    showTabMenu: showTabMenu
  };
})(window.SG = window.SG || {});
