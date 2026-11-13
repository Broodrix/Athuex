/* IDE module: virtual file system. See programsRegistry.register() in programs/ide.js */
(function (SG) {
  'use strict';
  SG.ide = SG.ide || {};

  var data = { files: {}, folders: [] };

  function U() { return SG.ide.utils; }
  function key() { return SG.ide.config.VFS_KEY; }

  function load() {
    try {
      var raw = localStorage.getItem(key());
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.files && typeof parsed.files === 'object') {
          data.files = parsed.files;
          data.folders = Array.isArray(parsed.folders) ? parsed.folders : [];
        }
      }
    } catch (_) {}
    if (!data.folders) data.folders = [];
  }

  function save() {
    try {
      localStorage.setItem(key(), JSON.stringify(data));
    } catch (_) {
      if (SG.ide.dialogs) SG.ide.dialogs.toast('Storage quota reached. Export your files.', 'error');
    }
  }

  function has(p) {
    return Object.prototype.hasOwnProperty.call(data.files, p);
  }

  function ensureParents(p) {
    var parts = p.split('/');
    parts.pop();
    var cur = '';
    for (var i = 0; i < parts.length; i++) {
      cur = cur ? cur + '/' + parts[i] : parts[i];
      if (data.folders.indexOf(cur) < 0) data.folders.push(cur);
    }
  }

  function read(p) {
    p = U().normalizePath(p);
    return has(p) ? data.files[p] : null;
  }

  function write(p, content, opts) {
    p = U().normalizePath(p);
    if (!p) return false;
    data.files[p] = String(content == null ? '' : content);
    ensureParents(p);
    if (!opts || !opts.silent) save();
    return true;
  }

  function remove(p) {
    p = U().normalizePath(p);
    if (!p) return;
    if (has(p)) delete data.files[p];
    var prefix = p + '/';
    Object.keys(data.files).forEach(function (f) {
      if (f.indexOf(prefix) === 0) delete data.files[f];
    });
    data.folders = data.folders.filter(function (f) {
      return f !== p && f.indexOf(prefix) !== 0;
    });
    save();
  }

  function rename(oldP, newP) {
    oldP = U().normalizePath(oldP);
    newP = U().normalizePath(newP);
    if (!oldP || !newP || oldP === newP) return false;
    if (has(newP) || data.folders.indexOf(newP) >= 0) return false;

    var isFile = has(oldP);
    var prefix = oldP + '/';

    if (isFile) {
      data.files[newP] = data.files[oldP];
      delete data.files[oldP];
      ensureParents(newP);
    } else {
      Object.keys(data.files).forEach(function (f) {
        if (f.indexOf(prefix) === 0) {
          var np = newP + f.slice(oldP.length);
          data.files[np] = data.files[f];
          delete data.files[f];
        }
      });
      data.folders = data.folders.map(function (f) {
        if (f === oldP) return newP;
        if (f.indexOf(prefix) === 0) return newP + f.slice(oldP.length);
        return f;
      });
      ensureParents(newP + '/x');
    }
    save();
    return true;
  }

  function exists(p) {
    p = U().normalizePath(p);
    return has(p) || data.folders.indexOf(p) >= 0;
  }

  function list() { return Object.keys(data.files).sort(); }
  function folders() { return data.folders.slice().sort(); }

  function addFolder(p) {
    p = U().normalizePath(p);
    if (!p) return;
    if (data.folders.indexOf(p) < 0) data.folders.push(p);
    ensureParents(p + '/x');
    save();
  }

  SG.ide.vfs = {
    load: load, save: save, read: read, write: write,
    remove: remove, rename: rename, exists: exists,
    list: list, folders: folders, addFolder: addFolder,
    data: data
  };
})(window.SG = window.SG || {});