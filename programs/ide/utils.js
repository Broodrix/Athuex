/* IDE module: pure utilities. See programsRegistry.register() in programs/ide.js */
(function (SG) {
  'use strict';
  SG.ide = SG.ide || {};

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function normalizePath(p) {
    p = String(p == null ? '' : p).replace(/\\/g, '/').replace(/\/+/g, '/').trim();
    p = p.replace(/^\/+|\/+$/g, '');
    var parts = p.split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part || part === '.' || part === '..') continue;
      part = part.replace(/[<>:"|?*\x00-\x1f]/g, '_');
      if (part === '__proto__' || part === 'prototype' || part === 'constructor') part = '_' + part;
      if (part.length > 120) part = part.slice(0, 120);
      out.push(part);
    }
    return out.join('/');
  }

  function basename(p) {
    p = String(p || '');
    var i = p.lastIndexOf('/');
    return i >= 0 ? p.slice(i + 1) : p;
  }

  function dirname(p) {
    p = String(p || '');
    var i = p.lastIndexOf('/');
    return i >= 0 ? p.slice(0, i) : '';
  }

  function extname(p) {
    var b = basename(p);
    var i = b.lastIndexOf('.');
    return i > 0 ? b.slice(i + 1).toLowerCase() : '';
  }

  function clamp(n, a, b) {
    n = Number(n);
    if (isNaN(n)) n = a;
    return Math.max(a, Math.min(b, n));
  }

  function span(cls, inner) {
    return '<span class="' + cls + '">' + inner + '</span>';
  }

  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {}, fallback);
    } else {
      fallback();
    }
  }

  function downloadFile(path, content) {
    var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = basename(path) || 'file.txt';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 800);
  }

  SG.ide.utils = {
    escapeHtml: escapeHtml,
    escapeRegExp: escapeRegExp,
    uid: uid,
    normalizePath: normalizePath,
    basename: basename,
    dirname: dirname,
    extname: extname,
    clamp: clamp,
    span: span,
    copyText: copyText,
    downloadFile: downloadFile
  };
})(window.SG = window.SG || {});