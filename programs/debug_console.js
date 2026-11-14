/* ============================================================================
 * Program: Debug Console — industry-standard in-app logger
 * Path:    programs/debug_console.js
 * Version: 1.0.0
 *
 * Captures console.*, window errors, unhandled rejections, and optional fetch.
 * kind: 'custom' — hot-swap: copy to workspace programs/debug_console.js → + → Scan.
 * ========================================================================== */
(function (SG) {
  'use strict';
  var R = SG.programsRegistry;
  if (!R) return;

  var MAX_ENTRIES = 500;
  var SS_KEY = 'sg.debug_console.v1';

  /* ---- Shared ring buffer (survives panel close; survives hot-swap) -------- */
  var store = window.__SG_DEBUG_CONSOLE;
  if (!store || !store.entries) {
    store = window.__SG_DEBUG_CONSOLE = {
      entries: [],
      seq: 0,
      hooked: false,
      captureFetch: false,
      filters: { log: true, info: true, warn: true, error: true, debug: true, net: true, system: true },
      originals: null,
      fetchOriginal: null
    };
  }

  function nowIso() {
    try { return new Date().toISOString().replace('T', ' ').replace('Z', ''); }
    catch (_) { return String(Date.now()); }
  }

  function safeStringify(v, depth) {
    depth = depth == null ? 0 : depth;
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    var t = typeof v;
    if (t === 'string') return v;
    if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
    if (t === 'function') return '[Function' + (v.name ? ' ' + v.name : '') + ']';
    if (v instanceof Error) {
      return v.name + ': ' + v.message + (v.stack ? '\n' + v.stack : '');
    }
    if (depth > 3) return Object.prototype.toString.call(v);
    try {
      var seen = [];
      return JSON.stringify(v, function (k, val) {
        if (typeof val === 'object' && val !== null) {
          if (seen.indexOf(val) >= 0) return '[Circular]';
          seen.push(val);
        }
        if (typeof val === 'function') return '[Function]';
        if (val instanceof Error) return val.name + ': ' + val.message;
        return val;
      }, 0);
    } catch (e) {
      try { return String(v); } catch (_) { return '[Unstringifiable]'; }
    }
  }

  function argsToText(args) {
    var out = [];
    for (var i = 0; i < args.length; i++) out.push(safeStringify(args[i]));
    return out.join(' ');
  }

  function pushEntry(level, text, meta) {
    var e = {
      id: ++store.seq,
      t: Date.now(),
      iso: nowIso(),
      level: level,
      text: String(text == null ? '' : text).slice(0, 8000),
      meta: meta || null
    };
    store.entries.push(e);
    while (store.entries.length > MAX_ENTRIES) store.entries.shift();
    if (typeof store._onPush === 'function') {
      try { store._onPush(e); } catch (_) {}
    }
    return e;
  }

  /* ---- Hook console / errors / fetch (once per page lifetime) ------------- */
  function installHooks() {
    if (store.hooked) return;
    store.hooked = true;

    var levels = ['log', 'info', 'warn', 'error', 'debug'];
    store.originals = {};
    levels.forEach(function (lvl) {
      var orig = console[lvl] ? console[lvl].bind(console) : console.log.bind(console);
      store.originals[lvl] = orig;
      console[lvl] = function () {
        var args = Array.prototype.slice.call(arguments);
        try { pushEntry(lvl, argsToText(args)); } catch (_) {}
        return orig.apply(console, args);
      };
    });

    store._onError = function (msg, src, line, col, err) {
      var text = String(msg || 'Error');
      if (src) text += ' @ ' + src + ':' + (line || '?') + ':' + (col || '?');
      if (err && err.stack) text += '\n' + err.stack;
      pushEntry('error', text, { source: src, line: line, col: col });
      return false;
    };
    store._prevOnError = window.onerror;
    window.onerror = function (msg, src, line, col, err) {
      store._onError(msg, src, line, col, err);
      if (typeof store._prevOnError === 'function') {
        try { return store._prevOnError.apply(this, arguments); } catch (_) {}
      }
      return false;
    };

    store._onRejection = function (ev) {
      var reason = ev && ev.reason;
      pushEntry('error', 'UnhandledRejection: ' + safeStringify(reason));
    };
    window.addEventListener('unhandledrejection', store._onRejection);

    pushEntry('system', 'Debug Console hooks installed · Athuex ' +
      ((typeof window.ATHUEX_VERSION !== 'undefined' && window.ATHUEX_VERSION) || ''));
  }

  function setFetchCapture(on) {
    store.captureFetch = !!on;
    if (on && !store.fetchOriginal) {
      store.fetchOriginal = window.fetch.bind(window);
      window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || String(input);
        var method = (init && init.method) || (input && input.method) || 'GET';
        var t0 = Date.now();
        pushEntry('net', '→ ' + method + ' ' + url);
        return store.fetchOriginal(input, init).then(function (res) {
          pushEntry('net', '← ' + res.status + ' ' + method + ' ' + url + ' · ' + (Date.now() - t0) + 'ms');
          return res;
        }, function (err) {
          pushEntry('error', '✕ ' + method + ' ' + url + ' · ' + safeStringify(err));
          throw err;
        });
      };
    } else if (!on && store.fetchOriginal) {
      window.fetch = store.fetchOriginal;
      store.fetchOriginal = null;
    }
  }

  installHooks();

  /* ---- UI ---------------------------------------------------------------- */
  var CONTENT =
    '<div class="prog-dbg" id="dbg-app">' +
      '<style>' +
        '.prog-dbg{display:flex;flex-direction:column;height:100%;min-height:360px;max-width:720px;' +
          'margin:0 auto;padding:10px;box-sizing:border-box;gap:8px;' +
          'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:#e6edf3;}' +
        '.prog-dbg .dbg-toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}' +
        '.prog-dbg .dbg-toolbar button,.prog-dbg .dbg-toolbar label{' +
          'border:1px solid #30363d;background:#21262d;color:#e6edf3;border-radius:8px;' +
          'padding:6px 10px;font-size:11px;cursor:pointer;-webkit-tap-highlight-color:transparent;}' +
        '.prog-dbg .dbg-toolbar button:active{filter:brightness(1.2);}' +
        '.prog-dbg .dbg-toolbar label{display:inline-flex;align-items:center;gap:4px;user-select:none;}' +
        '.prog-dbg .dbg-toolbar input[type=checkbox]{margin:0;}' +
        '.prog-dbg .dbg-search{flex:1;min-width:120px;background:#0d1117;border:1px solid #30363d;' +
          'border-radius:8px;color:#e6edf3;padding:6px 8px;font:inherit;}' +
        '.prog-dbg .dbg-meta{color:#8b949e;font-size:10px;}' +
        '.prog-dbg .dbg-list{flex:1;overflow:auto;background:#0d1117;border:1px solid #30363d;' +
          'border-radius:10px;padding:6px;min-height:200px;-webkit-overflow-scrolling:touch;}' +
        '.prog-dbg .dbg-row{padding:5px 6px;border-bottom:1px solid #21262d;white-space:pre-wrap;' +
          'word-break:break-word;line-height:1.35;}' +
        '.prog-dbg .dbg-row:last-child{border-bottom:0;}' +
        '.prog-dbg .dbg-time{color:#6e7681;margin-right:6px;}' +
        '.prog-dbg .lvl-log{color:#e6edf3;} .lvl-info{color:#58a6ff;} .lvl-warn{color:#d29922;}' +
        '.prog-dbg .lvl-error{color:#ff7b72;} .lvl-debug{color:#a371f7;} .lvl-net{color:#3fb950;}' +
        '.prog-dbg .lvl-system{color:#8b949e;}' +
        '.prog-dbg .dbg-eval{display:flex;gap:6px;}' +
        '.prog-dbg .dbg-eval input{flex:1;background:#0d1117;border:1px solid #30363d;border-radius:8px;' +
          'color:#e6edf3;padding:8px;font:inherit;}' +
        '.prog-dbg .dbg-eval button{border:0;border-radius:8px;background:#238636;color:#fff;' +
          'padding:8px 12px;font:inherit;font-weight:600;cursor:pointer;}' +
      '</style>' +
      '<div class="dbg-toolbar">' +
        '<button type="button" data-act="clear">Clear</button>' +
        '<button type="button" data-act="copy">Copy</button>' +
        '<button type="button" data-act="export">Export</button>' +
        '<button type="button" data-act="pause" id="dbg-pause-btn">Pause</button>' +
        '<label><input type="checkbox" id="dbg-fetch"> Fetch</label>' +
        '<input type="search" class="dbg-search" id="dbg-filter" placeholder="Filter…" autocomplete="off">' +
      '</div>' +
      '<div class="dbg-toolbar" id="dbg-levels">' +
        '<label><input type="checkbox" data-lvl="log" checked> log</label>' +
        '<label><input type="checkbox" data-lvl="info" checked> info</label>' +
        '<label><input type="checkbox" data-lvl="warn" checked> warn</label>' +
        '<label><input type="checkbox" data-lvl="error" checked> error</label>' +
        '<label><input type="checkbox" data-lvl="debug" checked> debug</label>' +
        '<label><input type="checkbox" data-lvl="net" checked> net</label>' +
        '<label><input type="checkbox" data-lvl="system" checked> sys</label>' +
      '</div>' +
      '<div class="dbg-meta" id="dbg-count">0 entries</div>' +
      '<div class="dbg-list" id="dbg-list" role="log" aria-live="polite"></div>' +
      '<div class="dbg-eval">' +
        '<input id="dbg-expr" placeholder="Evaluate expression…" autocomplete="off" spellcheck="false">' +
        '<button type="button" data-act="eval">Run</button>' +
      '</div>' +
    '</div>';

  var ui = {
    paused: false,
    filterText: '',
    bound: false
  };

  function levelEnabled(lvl) {
    return store.filters[lvl] !== false;
  }

  function matchesFilter(entry) {
    if (!levelEnabled(entry.level)) return false;
    if (!ui.filterText) return true;
    return (entry.text + ' ' + entry.level).toLowerCase().indexOf(ui.filterText) >= 0;
  }

  function rowHtml(entry) {
    var div = document.createElement('div');
    div.className = 'dbg-row lvl-' + entry.level;
    div.setAttribute('data-id', String(entry.id));
    var time = document.createElement('span');
    time.className = 'dbg-time';
    time.textContent = entry.iso.slice(11, 23);
    div.appendChild(time);
    div.appendChild(document.createTextNode('[' + entry.level + '] ' + entry.text));
    return div;
  }

  function refreshList() {
    var list = document.getElementById('dbg-list');
    var count = document.getElementById('dbg-count');
    if (!list) return;
    var frag = document.createDocumentFragment();
    var n = 0;
    for (var i = 0; i < store.entries.length; i++) {
      var e = store.entries[i];
      if (!matchesFilter(e)) continue;
      frag.appendChild(rowHtml(e));
      n++;
    }
    list.innerHTML = '';
    list.appendChild(frag);
    list.scrollTop = list.scrollHeight;
    if (count) count.textContent = n + ' shown · ' + store.entries.length + ' total · max ' + MAX_ENTRIES;
  }

  function appendLive(entry) {
    if (ui.paused) return;
    if (!matchesFilter(entry)) return;
    var list = document.getElementById('dbg-list');
    if (!list) return;
    list.appendChild(rowHtml(entry));
    list.scrollTop = list.scrollHeight;
    var count = document.getElementById('dbg-count');
    if (count) {
      var shown = list.children.length;
      count.textContent = shown + ' shown · ' + store.entries.length + ' total · max ' + MAX_ENTRIES;
    }
  }

  function exportLogs() {
    var lines = store.entries.map(function (e) {
      return e.iso + '\t' + e.level + '\t' + e.text.replace(/\t/g, ' ');
    }).join('\n');
    try {
      var blob = new Blob([lines], { type: 'text/plain' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'athuex-debug-' + Date.now() + '.log';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    } catch (e) {
      pushEntry('error', 'Export failed: ' + safeStringify(e));
    }
  }

  function runEval() {
    var input = document.getElementById('dbg-expr');
    if (!input) return;
    var expr = String(input.value || '').trim();
    if (!expr) return;
    pushEntry('log', '> ' + expr);
    try {
      // Indirect eval in global scope (standard console pattern)
      var result = (0, eval)(expr);
      pushEntry('info', safeStringify(result));
    } catch (e) {
      pushEntry('error', safeStringify(e));
    }
  }

  function bind() {
    var root = document.getElementById('dbg-app');
    if (!root) return;

    if (root.__sgDbgHandler) {
      root.removeEventListener('click', root.__sgDbgHandler);
    }
    root.__sgDbgHandler = function (e) {
      var t = e.target;
      if (!t) return;
      var act = t.getAttribute && t.getAttribute('data-act');
      if (!act && t.closest) {
        var b = t.closest('[data-act]');
        if (b) act = b.getAttribute('data-act');
      }
      if (act === 'clear') {
        store.entries = [];
        refreshList();
        pushEntry('system', 'Log cleared');
      } else if (act === 'copy') {
        var lines = store.entries.map(function (e) {
          return e.iso + '\t' + e.level + '\t' + e.text.replace(/\t/g, ' ');
        }).join('\n');
        function done(ok) {
          pushEntry('system', ok ? 'Copied ' + store.entries.length + ' lines' : 'Copy failed');
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(lines).then(function () { done(true); }).catch(function () {
            try {
              var ta = document.createElement('textarea');
              ta.value = lines; document.body.appendChild(ta); ta.select();
              done(document.execCommand('copy')); document.body.removeChild(ta);
            } catch (e) { done(false); }
          });
        } else {
          try {
            var ta = document.createElement('textarea');
            ta.value = lines; document.body.appendChild(ta); ta.select();
            done(document.execCommand('copy')); document.body.removeChild(ta);
          } catch (e) { done(false); }
        }
      } else if (act === 'export') {
        exportLogs();
      } else if (act === 'pause') {
        ui.paused = !ui.paused;
        var pb = document.getElementById('dbg-pause-btn');
        if (pb) pb.textContent = ui.paused ? 'Resume' : 'Pause';
        pushEntry('system', ui.paused ? 'Paused (buffer still records)' : 'Resumed');
        if (!ui.paused) refreshList();
      } else if (act === 'eval') {
        runEval();
      }
    };
    root.addEventListener('click', root.__sgDbgHandler);

    var filter = document.getElementById('dbg-filter');
    if (filter && !filter.__sgBound) {
      filter.__sgBound = true;
      filter.addEventListener('input', function () {
        ui.filterText = String(filter.value || '').toLowerCase().trim();
        refreshList();
      });
    }

    var fetchCb = document.getElementById('dbg-fetch');
    if (fetchCb && !fetchCb.__sgBound) {
      fetchCb.__sgBound = true;
      fetchCb.checked = !!store.captureFetch;
      fetchCb.addEventListener('change', function () {
        setFetchCapture(!!fetchCb.checked);
        pushEntry('system', store.captureFetch ? 'Fetch capture ON' : 'Fetch capture OFF');
      });
    }

    var levels = document.getElementById('dbg-levels');
    if (levels && !levels.__sgBound) {
      levels.__sgBound = true;
      levels.addEventListener('change', function (e) {
        var t = e.target;
        if (!t || t.type !== 'checkbox') return;
        var lvl = t.getAttribute('data-lvl');
        if (!lvl) return;
        store.filters[lvl] = !!t.checked;
        refreshList();
      });
    }

    var expr = document.getElementById('dbg-expr');
    if (expr && !expr.__sgBound) {
      expr.__sgBound = true;
      expr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); runEval(); }
      });
    }

    store._onPush = function (entry) {
      appendLive(entry);
    };

    refreshList();
  }

  function onActivate(prog) {
    try {
      document.dispatchEvent(new CustomEvent('sg:program', {
        detail: { id: 'debug_console', action: 'activate', program: prog }
      }));
    } catch (_) {}
    setTimeout(bind, 0);
    pushEntry('system', 'Debug Console open');
  }

  R.register({
    id: 'debug_console',
    title: 'Debug',
    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/>' +
          '<path d="M7 9h10M7 12h7M7 15h8"/>',
    order: 85,
    kind: 'custom',
    view: 'debug_console',
    core: false,
    source: 'user:programs',
    version: '1.0.0',
    description: 'In-app debug console: console.*, errors, rejections, optional fetch, eval, export',
    content: CONTENT,
    onActivate: onActivate
  });
})(window.SG = window.SG || {});
