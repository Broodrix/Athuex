/* IDE module: preview + markdown rendering. See programsRegistry.register() in programs/ide.js */
(function (SG) {
  'use strict';
  SG.ide = SG.ide || {};

  function S() { return SG.ide.state; }
  function D() { return SG.ide.state.dom; }
  function esc(s) { return SG.ide.utils.escapeHtml(s); }

  function previewRuntime() {
    var code = [
      '(function(){',
      'function send(type,args){try{var out=[];for(var i=0;i<args.length;i++){var a=args[i];if(typeof a==="object"){try{out.push(JSON.stringify(a));}catch(e){out.push(String(a));}}else{out.push(String(a));}}parent.postMessage({__idePreview:true,type:type,args:out},"*");}catch(e){}}',
      '["log","info","warn","error"].forEach(function(k){var orig=console[k];console[k]=function(){send(k,Array.prototype.slice.call(arguments));try{orig.apply(console,arguments);}catch(e){}};});',
      'window.addEventListener("error",function(e){send("error",[e.message+" @ "+(e.lineno||0)+":"+(e.colno||0)]);});',
      'window.addEventListener("unhandledrejection",function(e){send("error",["Unhandled rejection: "+String(e.reason)]);});',
      '})();'
    ].join('\n');
    return '<script>' + code + '</scr' + 'ipt>';
  }

  function injectRuntime(html) {
    var runtime = previewRuntime();
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, function (m) { return m + runtime; });
    return runtime + html;
  }

  function renderMarkdown(src) {
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var html = '';
    var inFence = false;

    function inline(text) {
      var s = esc(text);
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      return s;
    }

    lines.forEach(function (line) {
      if (/^```/.test(line)) {
        if (!inFence) { inFence = true; html += '<pre><code>'; }
        else { inFence = false; html += '</code></pre>'; }
        return;
      }
      if (inFence) { html += esc(line) + '\n'; return; }
      if (/^\s*$/.test(line)) { html += '\n'; return; }
      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { var lvl = h[1].length; html += '<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>'; return; }
      if (/^\s*>\s?/.test(line)) { html += '<blockquote>' + inline(line.replace(/^\s*>\s?/, '')) + '</blockquote>'; return; }
      var li = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      if (li) { html += '<div class="md-li">' + inline(li[3]) + '</div>'; return; }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { html += '<hr>'; return; }
      html += '<p>' + inline(line) + '</p>';
    });
    if (inFence) html += '</code></pre>';
    return html;
  }

  function markdownDocument(src) {
    var body = renderMarkdown(src);
    var style = [
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
      'max-width:860px;margin:0 auto;padding:24px;line-height:1.65;color:#1f2328;background:#fff;}',
      'pre{background:#f6f8fa;padding:12px;overflow:auto;border-radius:6px;}',
      'code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#f6f8fa;padding:1px 4px;border-radius:4px;}',
      'pre code{background:transparent;padding:0;}',
      'blockquote{border-left:4px solid #d0d7de;margin:0;padding-left:12px;color:#656d76;}',
      'a{color:#0969da;}',
      'table{border-collapse:collapse;}td,th{border:1px solid #d0d7de;padding:6px 10px;}'
    ].join('');
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + style + '</style>' + previewRuntime() + '</head><body>' + body + '</body></html>';
  }

  function prettyJson(text) {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch (_) { return text; }
  }

  function openPreview() {
    var state = S();
    var tab = SG.ide.tabs.getActiveTab();
    var dom = D();
    if (!tab || !state.global || !dom.ta) return;
    var lang = tab.language;
    var code = dom.ta.value;
    var srcdoc = '';
    var title = tab.name + ' - preview';

    if (lang === 'html') {
      srcdoc = injectRuntime(code);
    } else if (lang === 'markdown') {
      srcdoc = markdownDocument(code);
    } else if (lang === 'css') {
      srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + code + '</style>' + previewRuntime() + '</head><body><h1>Heading</h1><p>Paragraph with <a href="#">a link</a> and <strong>bold</strong> text.</p><button>Button</button><div class="box">Box</div></body></html>';
    } else if (lang === 'javascript') {
      var safeCode = code.replace(/<\/script/gi, '<\\/script');
      srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + previewRuntime() + '</head><body><p style="font-family:sans-serif;color:#555">JavaScript console output:</p><script>' + safeCode + '</scr' + 'ipt></body></html>';
    } else if (lang === 'json') {
      srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:ui-monospace,monospace;padding:16px;white-space:pre-wrap;background:#fff;color:#1f2328}</style></head><body>' + esc(prettyJson(code)) + '</body></html>';
    } else {
      srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:ui-monospace,monospace;padding:16px;white-space:pre-wrap;background:#fff;color:#1f2328}</style></head><body>' + esc(code) + '</body></html>';
    }

    state.global.previewTitle.textContent = title;
    state.global.previewFrame.srcdoc = srcdoc;
    state.global.preview.hidden = false;
    state.global.consoleEl.innerHTML = '';
  }

  function closePreview() {
    var state = S();
    if (!state.global) return;
    state.global.preview.hidden = true;
    state.global.previewFrame.srcdoc = '';
    state.global.consoleEl.innerHTML = '';
  }

  function clearConsole() {
    var state = S();
    if (state.global) state.global.consoleEl.innerHTML = '';
  }

  function appendConsole(type, args) {
    var state = S();
    if (!state.global) return;
    var line = document.createElement('div');
    line.className = 'ide-console-line' + (type === 'error' ? ' error' : type === 'warn' ? ' warn' : '');
    line.textContent = '[' + type + '] ' + (args || []).join(' ');
    state.global.consoleEl.appendChild(line);
    state.global.consoleEl.scrollTop = state.global.consoleEl.scrollHeight;
  }

  function onPreviewMessage(e) {
    var state = S();
    if (!state.global || !state.global.previewFrame) return;
    // Bug fix: guard against null source (some browsers set it null in odd cases)
    if (!e.source || e.source !== state.global.previewFrame.contentWindow) return;
    var d = e.data;
    if (!d || !d.__idePreview) return;
    appendConsole(d.type || 'log', d.args || []);
  }

  SG.ide.preview = {
    openPreview: openPreview,
    closePreview: closePreview,
    clearConsole: clearConsole,
    appendConsole: appendConsole,
    onPreviewMessage: onPreviewMessage,
    markdownDocument: markdownDocument,
    renderMarkdown: renderMarkdown,
    prettyJson: prettyJson
  };
})(window.SG = window.SG || {});