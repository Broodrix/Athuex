/* IDE module: file explorer. See programsRegistry.register() in programs/ide.js */
(function (SG) {
  'use strict';
  SG.ide = SG.ide || {};

  var treeTimer = null;
  var longPressTimer = null;

  function S() { return SG.ide.state; }
  function D() { return SG.ide.state.dom; }
  function U() { return SG.ide.utils; }

  function refreshTree() {
    var dom = D();
    if (!dom.tree) return;
    dom.tree.innerHTML = '';
    var root = { folders: new Map(), files: [] };
    var vfs = SG.ide.vfs;

    vfs.folders().forEach(function (f) { addFolderToTree(root, f); });
    vfs.list().forEach(function (f) { addFileToTree(root, f); });

    renderTree(root, 0, dom.tree);
    SG.ide.icons.paintIcons(dom.tree);
  }

  function scheduleTreeRefresh() {
    clearTimeout(treeTimer);
    treeTimer = setTimeout(refreshTree, 250);
  }

  function ensureFolderNode(root, path) {
    var node = root;
    var cur = '';
    var parts = path.split('/').filter(Boolean);
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      cur = cur ? cur + '/' + part : part;
      if (!node.folders.has(part)) {
        node.folders.set(part, { name: part, path: cur, folders: new Map(), files: [] });
      }
      node = node.folders.get(part);
    }
    return node;
  }

  function addFolderToTree(root, path) { ensureFolderNode(root, path); }

  function addFileToTree(root, path) {
    var dir = U().dirname(path);
    var parent = dir ? ensureFolderNode(root, dir) : root;
    parent.files.push({ name: U().basename(path), path: path, language: SG.ide.config.languageForPath(path) });
  }

  function renderTree(node, depth, container) {
    var folderNames = Array.from(node.folders.keys()).sort(function (a, b) { return a.localeCompare(b); });

    folderNames.forEach(function (name) {
      var folder = node.folders.get(name);
      var expanded = S().expanded[folder.path] !== false;
      var row = document.createElement('div');
      row.className = 'ide-tree-row folder';
      row.setAttribute('data-folder', folder.path);
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      row.tabIndex = 0;
      row.style.paddingLeft = (8 + depth * 12) + 'px';
      row.innerHTML =
        '<span class="ide-tree-chevron">' + (expanded ? '▾' : '▸') + '</span>' +
        '<span class="ide-tree-icon" data-icon="folder"></span>' +
        '<span class="ide-tree-label"></span>';
      row.querySelector('.ide-tree-label').textContent = folder.name;
      container.appendChild(row);

      if (expanded) {
        var children = document.createElement('div');
        children.className = 'ide-tree-children';
        children.setAttribute('role', 'group');
        container.appendChild(children);
        renderTree(folder, depth + 1, children);
      }
    });

    node.files.sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (file) {
      var tab = SG.ide.tabs.findTabByPath(file.path);
      var row = document.createElement('div');
      row.className = 'ide-tree-row file';
      row.setAttribute('data-path', file.path);
      row.setAttribute('role', 'treeitem');
      row.tabIndex = 0;
      row.style.paddingLeft = (8 + depth * 12) + 'px';
      row.innerHTML =
        '<span class="ide-tree-chevron"></span>' +
        '<span class="ide-tree-icon" data-icon="file"></span>' +
        '<span class="ide-tree-label"></span>' +
        '<span class="ide-tree-dirty"></span>';
      row.querySelector('.ide-tree-label').textContent = file.name;
      if (tab) {
        if (tab.dirty) row.querySelector('.ide-tree-dirty').textContent = '●';
        if (tab.id === S().activeTabId) row.classList.add('active');
      }
      container.appendChild(row);
    });
  }

  function toggleFolder(path) {
    S().expanded[path] = S().expanded[path] === false ? true : false;
    refreshTree();
    S().saveSessionDebounced();
  }

  function collapseAll() {
    SG.ide.vfs.folders().forEach(function (f) { S().expanded[f] = false; });
    refreshTree();
    S().saveSessionDebounced();
  }

  function renamePath(path) {
    SG.ide.dialogs.showPrompt('Rename', path, 'new/path.ext').then(function (value) {
      if (!value) return;
      var newPath = U().normalizePath(value);
      if (!newPath || newPath === path) return;
      if (!SG.ide.vfs.rename(path, newPath)) {
        SG.ide.dialogs.toast('Rename failed: target exists or invalid', 'error');
        return;
      }
      // Migrate expanded state
      var prefix = path + '/';
      Object.keys(S().expanded).forEach(function (k) {
        if (k === path) { S().expanded[newPath] = S().expanded[k]; delete S().expanded[k]; }
        else if (k.indexOf(prefix) === 0) {
          var nk = newPath + k.slice(path.length);
          S().expanded[nk] = S().expanded[k];
          delete S().expanded[k];
        }
      });
      // Migrate open tabs
      S().tabs.forEach(function (t) {
        if (t.path === path) {
          t.path = newPath;
          t.name = U().basename(newPath);
          t.language = SG.ide.config.languageForPath(newPath);
        } else if (t.path.indexOf(prefix) === 0) {
          t.path = newPath + t.path.slice(path.length);
          t.name = U().basename(t.path);
          t.language = SG.ide.config.languageForPath(t.path);
        }
      });
      refreshTree();
      SG.ide.tabs.renderTabs();
      SG.ide.tabs.updateBreadcrumb();
      SG.ide.tabs.updateLanguageUI();
      S().saveSession();
      SG.ide.dialogs.toast('Renamed');
    });
  }

  function deletePath(path) {
    SG.ide.dialogs.showConfirm('Delete "' + path + '"? This cannot be undone.', 'Delete').then(function (ok) {
      if (!ok) return;
      S().tabs = S().tabs.filter(function (t) {
        return t.path !== path && t.path.indexOf(path + '/') !== 0;
      });
      if (!SG.ide.tabs.getTab(S().activeTabId)) {
        S().activeTabId = S().tabs.length ? S().tabs[0].id : null;
      }
      SG.ide.vfs.remove(path);
      if (!S().tabs.length) SG.ide.tabs.createScratchTab();
      else SG.ide.tabs.activateTab(S().activeTabId);
      refreshTree();
      SG.ide.tabs.renderTabs();
      S().saveSession();
      SG.ide.dialogs.toast('Deleted');
    });
  }

  function duplicatePath(path) {
    var content = SG.ide.vfs.read(path);
    if (content == null) return;
    var n = 1;
    var base = U().basename(path);
    var dir = U().dirname(path);
    var dot = base.lastIndexOf('.');
    var stem = dot > 0 ? base.slice(0, dot) : base;
    var ext = dot > 0 ? base.slice(dot) : '';
    var target;
    do {
      target = (dir ? dir + '/' : '') + stem + '-copy' + (n > 1 ? n : '') + ext;
      n++;
    } while (SG.ide.vfs.exists(target));
    SG.ide.vfs.write(target, content);
    SG.ide.tabs.openFile(target);
    refreshTree();
  }

  function importFiles() {
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.c,.h,.cpp,.cc,.cxx,.hpp,.java,.js,.mjs,.ts,.json,.html,.htm,.css,.md,.markdown,.sh,.bash,.sql,.csv,.txt,.log,.xml,.svg';
    input.style.display = 'none';
    document.body.appendChild(input);

    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (input.parentNode) input.parentNode.removeChild(input);
    }

    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      if (!files.length) { cleanup(); return; }
      var remaining = files.length;
      var firstPath = null;
      files.forEach(function (file) {
        var reader = new FileReader();
        reader.onload = function () {
          var name = U().normalizePath(file.name || 'imported.txt');
          if (!name) name = 'imported.txt';
          if (SG.ide.vfs.exists(name)) {
            var n = 1;
            var base = U().basename(name);
            var dir = U().dirname(name);
            var dot = base.lastIndexOf('.');
            var stem = dot > 0 ? base.slice(0, dot) : base;
            var ext = dot > 0 ? base.slice(dot) : '';
            do { name = (dir ? dir + '/' : '') + stem + '-' + n + ext; n++; } while (SG.ide.vfs.exists(name));
          }
          SG.ide.vfs.write(name, String(reader.result || ''));
          if (!firstPath) firstPath = name;
          remaining--;
          if (remaining === 0) { refreshTree(); if (firstPath) SG.ide.tabs.openFile(firstPath); cleanup(); }
        };
        reader.onerror = function () {
          remaining--;
          if (remaining === 0) { refreshTree(); cleanup(); }
        };
        reader.readAsText(file);
      });
    });

    // Cancellation cleanup (modern browsers)
    input.addEventListener('cancel', cleanup);
    // Fallback: cleanup after window regains focus
    function onFocus() { setTimeout(cleanup, 300); window.removeEventListener('focus', onFocus); }
    window.addEventListener('focus', onFocus);
    setTimeout(function () { window.removeEventListener('focus', onFocus); }, 120000);

    input.click();
  }

  function newFileIn(folder) {
    SG.ide.dialogs.showPrompt('New file in ' + folder, folder + '/untitled.txt', 'file.ext').then(function (name) {
      if (!name) return;
      var path = U().normalizePath(name);
      if (!path) return;
      if (SG.ide.vfs.exists(path)) { SG.ide.dialogs.toast('Already exists'); SG.ide.tabs.openFile(path); return; }
      SG.ide.vfs.write(path, '');
      S().expanded[folder] = true;
      refreshTree();
      SG.ide.tabs.openFile(path);
    });
  }

  function attachEvents() {
    var dom = D();
    if (!dom.tree) return;
    var state = S();
    if (state.cleanup.indexOf(attachEvents._treeClick) < 0) {
      // marker to avoid double-bind (bindEvents handles this via state.bound)
    }

    // Handled in toolbar.bindEvents — this function is a stub for future tree-local handlers.
  }

  SG.ide.tree = {
    refreshTree: refreshTree,
    scheduleTreeRefresh: scheduleTreeRefresh,
    toggleFolder: toggleFolder,
    collapseAll: collapseAll,
    renamePath: renamePath,
    deletePath: deletePath,
    duplicatePath: duplicatePath,
    importFiles: importFiles,
    newFileIn: newFileIn
  };
})(window.SG = window.SG || {});