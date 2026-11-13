/* Athuex app helpers — P4 modular split v2.5.5 */
(function (SG) {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function on(id, event, fn) {
    const el = $(id);
    if (el) el.addEventListener(event, fn);
  }
  function click(id, fn) {
    on(id, 'click', function (e) { e.preventDefault(); fn(e); });
  }
  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KiB';
    return (n / (1024 * 1024)).toFixed(2) + ' MiB';
  }
  function estimateTokens(str) {
    return Math.ceil(String(str || '').length / 4);
  }
  function isAbortError(err) {
    return !!(err && (err.name === 'AbortError' || err.code === 20 || /aborted/i.test(String(err.message || err))));
  }
  function copyTextToClipboard(str) {
    str = String(str == null ? '' : str);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(str).then(function () { return true; }).catch(function () {
        return legacyCopy(str);
      });
    }
    return Promise.resolve(legacyCopy(str));
  }
  function legacyCopy(str) {
    try {
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (_) { return false; }
  }
  function networkHint(err) {
    const m = String((err && err.message) || err || '');
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) {
      return 'Network error (Failed to fetch).\n1) Worker URL = https://….workers.dev\n2) Deploy cloudflare/worker.js\n3) API key nvapi-\n4) Proxy key if Worker has PROXY_KEY\n5) For offline local: start Termux llama-server on :8080';
    }
    return m;
  }
  function httpError(status, data, raw) {
    var msg = 'HTTP ' + status;
    try {
      if (data && data.error) {
        if (typeof data.error === 'string') msg += ': ' + data.error;
        else if (data.error.message) msg += ': ' + data.error.message;
      } else if (raw) msg += ': ' + String(raw).slice(0, 280);
    } catch (_) {}
    var e = new Error(msg);
    e.status = status;
    e.data = data;
    return e;
  }
  SG.appHelpers = {
    $: $,
    on: on,
    click: click,
    formatBytes: formatBytes,
    estimateTokens: estimateTokens,
    isAbortError: isAbortError,
    copyTextToClipboard: copyTextToClipboard,
    networkHint: networkHint,
    httpError: httpError
  };
})(window.SG = window.SG || {});
