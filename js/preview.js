/* Preview iframe + console bridge (postMessage) */
(function (SG) {
  'use strict';

  const MAX_LOG = 200;
  let logs = [];
  let frame = null;
  let listeners = [];

  const BRIDGE = `(function(){
    function send(type, args) {
      try {
        parent.postMessage({ source: 'sg-preview', type: type, args: args.map(function(a){
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch(e) { return String(a); }
        }) }, '*');
      } catch(e) {}
    }
    var c = { log: function(){ send('log', [].slice.call(arguments)); },
      info: function(){ send('info', [].slice.call(arguments)); },
      warn: function(){ send('warn', [].slice.call(arguments)); },
      error: function(){ send('error', [].slice.call(arguments)); },
      debug: function(){ send('debug', [].slice.call(arguments)); } };
    try { window.console = c; } catch(e) {}
    window.onerror = function(msg, src, line, col, err) {
      send('error', [String(msg) + (line ? ' @' + line + ':' + (col||0) : '')]);
      return false;
    };
    window.onunhandledrejection = function(ev) {
      var r = ev && ev.reason;
      send('error', ['UnhandledRejection: ' + (r && (r.message || r) || r)]);
    };
  })();`;

  function onMessage(e) {
    const d = e.data;
    if (!d || d.source !== 'sg-preview') return;
    const entry = {
      t: Date.now(),
      type: d.type || 'log',
      text: Array.isArray(d.args) ? d.args.join(' ') : String(d.args || '')
    };
    logs.push(entry);
    if (logs.length > MAX_LOG) logs = logs.slice(-MAX_LOG);
    listeners.forEach((fn) => { try { fn(entry); } catch (_) {} });
  }

  function bind(iframe) {
    frame = iframe;
    window.removeEventListener('message', onMessage);
    window.addEventListener('message', onMessage);
  }

  function clearLogs() { logs = []; }

  function getLogs(limit) {
    const n = limit || 50;
    return logs.slice(-n).map((e) =>
      '[' + e.type + '] ' + e.text
    );
  }

  function buildSrcdoc(files, entry) {
    entry = entry || 'index.html';
    let html = files[entry] || files['index.html'] || '';
    // Non-HTML workspace files: render as readable document instead of "No index.html"
    if (!html && entry && files[entry] != null) {
      html = files[entry];
    }
    if (html && entry && !/\.(html?|svg)$/i.test(entry) && !/^\s*</.test(String(html).slice(0, 200))) {
      const body = String(html)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<style>body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:16px;white-space:pre-wrap;word-break:break-word}</style>' +
        '</head><body><header style="color:#8b949e;margin-bottom:12px">' + String(entry).replace(/</g,'') + '</header><pre style="margin:0">' + body + '</pre></body></html>';
    }
    if (!html) {
      // minimal shell from CSS/JS if no index
      const css = files['styles.css'] || files['style.css'] || files['css/ide.css'] || '';
      const js = files['app.js'] || files['main.js'] || '';
      const names = Object.keys(files || {}).slice(0, 30).map(function (k) {
        return '<li style="margin:4px 0"><code>' + String(k).replace(/</g,'') + '</code></li>';
      }).join('');
      html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        (css ? '<style>' + css + '</style>' : '') +
        '<style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;padding:20px} code{color:#76b900}</style>' +
        '</head><body><div id="app">' +
        (js ? '' : '<h2 style="margin:0 0 8px">No HTML entry</h2><p style="color:#8b949e">Open an .html file in IDE or create index.html. Workspace files:</p><ul style="padding-left:18px">' + (names || '<li>(empty)</li>') + '</ul>') +
        '</div>' +
        (js ? '<script>' + js + '<\/script>' : '') +
        '</body></html>';
    }
    // inline local link/script refs that exist in VFS
    html = html.replace(/<link[^>]+href=["']([^"']+)["'][^>]*>/gi, (m, href) => {
      const key = href.replace(/^\.\//, '');
      if (files[key] != null) return '<style>/* ' + key + ' */\n' + files[key] + '</style>';
      return m;
    });
    html = html.replace(/<script[^>]+src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (m, src) => {
      const key = src.replace(/^\.\//, '');
      if (files[key] != null) return '<script>/* ' + key + ' */\n' + files[key] + '<\/script>';
      return m;
    });
    // inject bridge first in head
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (h) => h + '<script>' + BRIDGE + '<\/script>');
    } else {
      html = '<script>' + BRIDGE + '<\/script>' + html;
    }
    return html;
  }

  function render(files, entry) {
    if (!frame) return;
    clearLogs();
    const doc = buildSrcdoc(files || {}, entry);
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.srcdoc = doc;
  }

  function onLog(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  SG.preview = { bind, render, getLogs, clearLogs, onLog, buildSrcdoc };
})(window.SG = window.SG || {});
