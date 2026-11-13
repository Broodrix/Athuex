/* IDE module: editor core (input, highlight, gutter, find, completions).
 * See programsRegistry.register() in programs/ide.js */
(function (SG) {
  'use strict';
  SG.ide = SG.ide || {};

  var autoSaveTimer = null;
  var historyTimer = null;
  var highlightTimer = null;
  var gutterTimer = null;
  var findTimer = null;

  function S() { return SG.ide.state; }
  function D() { return SG.ide.state.dom; }
  function U() { return SG.ide.utils; }
  function C() { return SG.ide.config; }

  function getCaretPos() {
    var ta = D().ta;
    if (!ta) return { line: 1, col: 1, index: 0 };
    var value = ta.value;
    var index = ta.selectionStart || 0;
    var before = value.slice(0, index);
    var line = before.split('\n').length;
    var col = index - before.lastIndexOf('\n');
    return { line: line, col: col, index: index };
  }

  function updateStatus() {
    var dom = D();
    var tab = SG.ide.tabs.getActiveTab();
    if (!tab) {
      if (dom.statusPos) dom.statusPos.textContent = 'Ln 1, Col 1';
      return;
    }
    var p = getCaretPos();
    if (dom.statusPos) dom.statusPos.textContent = 'Ln ' + p.line + ', Col ' + p.col;
    if (dom.statusPath) dom.statusPath.textContent = tab.path;
    SG.ide.tabs.updateSaveStatus();
  }

  function syncScroll() {
    var dom = D();
    var ta = dom.ta;
    if (!ta) return;
    if (dom.hl) { dom.hl.scrollTop = ta.scrollTop; dom.hl.scrollLeft = ta.scrollLeft; }
    if (dom.gutterInner) dom.gutterInner.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
  }

  function updateGutter() {
    var dom = D();
    var prefs = S().prefs;
    if (!dom.gutter || !dom.gutterInner || !dom.ta) return;
    if (!prefs.lineNumbers || prefs.wrap) { dom.gutter.hidden = true; return; }
    dom.gutter.hidden = false;
    var lines = dom.ta.value.split('\n').length;
    var digits = String(lines).length;
    dom.gutter.style.width = (digits * 8 + 22) + 'px';
    var nums = new Array(lines);
    for (var i = 0; i < lines; i++) nums[i] = i + 1;
    dom.gutterInner.textContent = nums.join('\n');
    syncScroll();
  }

  function scheduleGutter() {
    clearTimeout(gutterTimer);
    gutterTimer = setTimeout(updateGutter, 40);
  }

  function scheduleHighlight() {
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(renderHighlight, 70);
  }

  function renderHighlight() {
    var dom = D();
    var tab = SG.ide.tabs.getActiveTab();
    if (!dom.codeEl || !dom.ta || !tab) return;
    var code = dom.ta.value;

    // Fast path for very large files
    if (code.length > C().MAX_HIGHLIGHT) {
      dom.codeEl.textContent = code + '\n';
      S().lastTokens = null;
      syncScroll();
      return;
    }

    var tokens = null;
    var matches = null;
    if (tab.language !== 'markdown' && tab.language !== 'csv') {
      if (tab.language === 'html') tokens = SG.ide.tokenizers.tokenizeHtml(code);
      else if (tab.language === 'css') tokens = SG.ide.tokenizers.tokenizeCss(code);
      else tokens = SG.ide.tokenizers.tokenizeCode(code, tab.language);
      matches = SG.ide.tokenizers.computeBracketMatch(tokens, dom.ta.selectionStart || 0);
      S().lastTokens = tokens;
      S().lastCode = code;
    } else {
      S().lastTokens = null;
      S().lastCode = '';
    }
    var html = SG.ide.tokenizers.highlightCode(code, tab.language, tokens, matches);
    dom.codeEl.innerHTML = html + '\n';
    syncScroll();
  }

  function pushHistory(tab, content) {
    if (!tab) return;
    if (!tab.history) tab.history = { stack: [content], index: 0 };
    var h = tab.history;
    if (h.stack[h.index] === content) return;
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push(content);
    if (h.stack.length > 120) h.stack.shift();
    h.index = h.stack.length - 1;
  }

  function scheduleHistory(tab) {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(function () { pushHistory(tab, tab && tab.content); }, 450);
  }

  function scheduleAutoSave() {
    if (!S().prefs.autoSave) return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(function () { SG.ide.tabs.saveActive(true); }, 1200);
  }

  function applyHistory(tab, content) {
    var dom = D();
    if (!dom.ta) return;
    S().suppressInput = true;
    dom.ta.value = content;
    S().suppressInput = false;
    tab.content = content;
    tab.dirty = true;
    updateGutter();
    renderHighlight();
    SG.ide.tabs.renderTabs();
    SG.ide.tabs.updateSaveStatus();
    updateStatus();
    scheduleAutoSave();
  }

  function undo() {
    var tab = SG.ide.tabs.getActiveTab();
    if (!tab || !tab.history) return;
    clearTimeout(historyTimer);
    var h = tab.history;
    if (h.index <= 0) { SG.ide.dialogs.toast('Nothing to undo'); return; }
    h.index--;
    applyHistory(tab, h.stack[h.index]);
  }

  function redo() {
    var tab = SG.ide.tabs.getActiveTab();
    if (!tab || !tab.history) return;
    clearTimeout(historyTimer);
    var h = tab.history;
    if (h.index >= h.stack.length - 1) { SG.ide.dialogs.toast('Nothing to redo'); return; }
    h.index++;
    applyHistory(tab, h.stack[h.index]);
  }

  function onInput() {
    if (S().suppressInput) return;
    var dom = D();
    var tab = SG.ide.tabs.getActiveTab();
    if (!tab) return;
    tab.content = dom.ta.value;
    if (!tab.dirty) {
      tab.dirty = true;
      SG.ide.tabs.renderTabs();
      SG.ide.tree.scheduleTreeRefresh();
    }
    SG.ide.tabs.updateSaveStatus();
    scheduleHighlight();
    scheduleGutter();
    updateStatus();
    scheduleHistory(tab);
    scheduleAutoSave();
    S().saveSessionDebounced();
    S().emit('change', { path: tab.path, value: tab.content });
  }

  function setEditorContent(content, opts) {
    var dom = D();
    var tab = SG.ide.tabs.getActiveTab();
    if (!tab || !dom.ta) return;
    opts = opts || {};
    var scroll = dom.ta.scrollTop;
    var sel = dom.ta.selectionStart;
    S().suppressInput = true;
    dom.ta.value = content;
    S().suppressInput = false;
    tab.content = content;
    tab.dirty = true;
    pushHistory(tab, content);
    var newSel = opts.selection != null ? opts.selection : Math.min(sel, content.length);
    try { dom.ta.setSelectionRange(newSel, newSel); } catch (_) {}
    dom.ta.scrollTop = scroll;
    updateGutter();
    renderHighlight();
    SG.ide.tabs.renderTabs();
    SG.ide.tabs.updateSaveStatus();
    updateStatus();
    scheduleAutoSave();
    S().saveSessionDebounced();
  }

  function insertTextAtCursor(text, caretOffset) {
    var ta = D().ta;
    if (!ta) return;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    ta.setRangeText(text, start, end, 'end');
    if (caretOffset != null) {
      var pos = start + caretOffset;
      try { ta.setSelectionRange(pos, pos); } catch (_) {}
    }
    onInput();
  }

  function replaceRange(start, end, text, selectStart, selectEnd) {
    var ta = D().ta;
    if (!ta) return;
    ta.setRangeText(text, start, end, 'end');
    if (selectStart != null && selectEnd != null) {
      try { ta.setSelectionRange(selectStart, selectEnd); } catch (_) {}
    }
    onInput();
  }

  function indentUnit() {
    var tab = SG.ide.tabs.getActiveTab();
    var size = C().langConfig(tab ? tab.language : 'text').tabSize || 2;
    return new Array(size + 1).join(' ');
  }

  function handleEnter(e) {
    e.preventDefault();
    var ta = D().ta;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var value = ta.value;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var line = value.slice(lineStart, start);
    var indentMatch = line.match(/^[ \t]*/);
    var indent = indentMatch ? indentMatch[0] : '';
    var trimmed = line.replace(/[ \t]+$/, '');
    var cfg = C().langConfig(SG.ide.tabs.getActiveTab() ? SG.ide.tabs.getActiveTab().language : 'text');
    var extra = '';
    var unit = indentUnit();

    if (/[{[(]$/.test(trimmed)) extra = unit;
    if (cfg.autoIndentHtml && />$/.test(trimmed) && !/\/>$/.test(trimmed) && !/<\//.test(trimmed)) extra = unit;

    var next = value.charAt(end);
    if (extra && /[}\])]/.test(next)) {
      var insert = '\n' + indent + extra + '\n' + indent;
      var target = start + 1 + indent.length + extra.length;
      replaceRange(start, end, insert, target, target);
    } else {
      insertTextAtCursor('\n' + indent + extra);
    }
  }

  function handleTab(e) {
    e.preventDefault();
    var ta = D().ta;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var tab = SG.ide.tabs.getActiveTab();

    if (e.shiftKey) {
      var val = ta.value;
      var lineStart = val.lastIndexOf('\n', start - 1) + 1;
      var lineEnd = val.indexOf('\n', end);
      if (lineEnd < 0) lineEnd = val.length;
      var block = val.slice(lineStart, lineEnd);
      var size = (C().langConfig(tab ? tab.language : 'text').tabSize) || 2;
      var re = new RegExp('^ {1,' + size + '}', 'gm');
      var newBlock = block.replace(re, '');
      replaceRange(lineStart, lineEnd, newBlock, lineStart, lineStart + newBlock.length);
      return;
    }

    if (start === end) {
      var before = ta.value.slice(0, start);
      var col = start - (before.lastIndexOf('\n') + 1);
      var unit = indentUnit();
      var spaces = unit.length - (col % unit.length);
      insertTextAtCursor(new Array(spaces + 1).join(' '));
      return;
    }

    var v = ta.value;
    var ls = v.lastIndexOf('\n', start - 1) + 1;
    var le = v.indexOf('\n', end);
    if (le < 0) le = v.length;
    var selected = v.slice(ls, le);
    var prefix = indentUnit();
    var updated = selected.split('\n').map(function (l) { return prefix + l; }).join('\n');
    replaceRange(ls, le, updated, ls, ls + updated.length);
  }

  function handleAutoPair(e) {
    var ta = D().ta;
    var key = e.key;
    var pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
    var closers = { ')': '(', ']': '[', '}': '{', '"': '"', "'": "'", '`': '`' };

    if (e.key === 'Backspace' && ta.selectionStart === ta.selectionEnd && ta.selectionStart > 0) {
      var s = ta.selectionStart;
      var before = ta.value.charAt(s - 1);
      var after = ta.value.charAt(s);
      if (pairs[before] === after) {
        e.preventDefault();
        ta.setRangeText('', s - 1, s + 1, 'end');
        onInput();
      }
      return;
    }

    if (pairs[key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var start = ta.selectionStart;
      var end = ta.selectionEnd;
      if (start !== end) {
        e.preventDefault();
        var selected = ta.value.slice(start, end);
        var wrapped = key + selected + pairs[key];
        replaceRange(start, end, wrapped, start + 1, start + 1 + selected.length);
        return;
      }
      var next = ta.value.charAt(end);
      if (next && !/[\s)\]}>"',;.]/.test(next)) return;
      if ((key === '"' || key === "'" || key === '`') && /[\w]/.test(ta.value.charAt(end - 1))) return;
      e.preventDefault();
      insertTextAtCursor(key + pairs[key], 1);
      return;
    }

    if (closers[key] && ta.selectionStart === ta.selectionEnd) {
      var pos = ta.selectionStart;
      if (ta.value.charAt(pos) === key) {
        e.preventDefault();
        try { ta.setSelectionRange(pos + 1, pos + 1); } catch (_) {}
      }
    }
  }

  function onEditorKeyDown(e) {
    if (e.isComposing) return;
    var dom = D();
    var mod = e.ctrlKey || e.metaKey;
    var key = e.key;

    if (S().completion.items.length && dom.completions && !dom.completions.hidden) {
      if (key === 'ArrowDown') { e.preventDefault(); S().completion.index = Math.min(S().completion.items.length - 1, S().completion.index + 1); renderCompletions(); return; }
      if (key === 'ArrowUp') { e.preventDefault(); S().completion.index = Math.max(0, S().completion.index - 1); renderCompletions(); return; }
      if (key === 'Enter') { e.preventDefault(); applyCompletion(S().completion.index); return; }
      if (key === 'Escape') { e.preventDefault(); hideCompletions(); return; }
    }

    if (mod && !e.shiftKey && key.toLowerCase() === 's') { e.preventDefault(); SG.ide.tabs.saveActive(); return; }
    if (mod && key.toLowerCase() === 'f') { e.preventDefault(); openFind(false); return; }
    if (mod && key.toLowerCase() === 'h') { e.preventDefault(); openFind(true); return; }
    if (mod && e.shiftKey && key.toLowerCase() === 'p') { e.preventDefault(); SG.ide.palette.showPalette('command'); return; }
    if (mod && !e.shiftKey && key.toLowerCase() === 'p') { e.preventDefault(); SG.ide.palette.showPalette('command'); return; }
    if (mod && key === '/') { e.preventDefault(); toggleComment(); return; }
    if (mod && key.toLowerCase() === 'd') { e.preventDefault(); duplicateLine(); return; }
    if (mod && key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && key === ' ') { e.preventDefault(); showCompletions(); return; }
    if (mod && key.toLowerCase() === 'g') { e.preventDefault(); gotoLine(); return; }
    if (e.altKey && key === 'ArrowUp') { e.preventDefault(); moveLine(-1); return; }
    if (e.altKey && key === 'ArrowDown') { e.preventDefault(); moveLine(1); return; }
    if (key === 'Escape') { hideCompletions(); closeFind(); return; }
    if (key === 'Tab') { handleTab(e); return; }
    if (key === 'Enter') { handleEnter(e); return; }
    if (!mod && !e.altKey) handleAutoPair(e);
  }

  function scrollToSelection() {
    var ta = D().ta;
    if (!ta) return;
    var pos = ta.selectionStart;
    var before = ta.value.slice(0, pos);
    var line = before.split('\n').length - 1;
    var lh = parseFloat(window.getComputedStyle(ta).lineHeight) || 20;
    var top = line * lh;
    var h = ta.clientHeight;
    if (top < ta.scrollTop + 20) ta.scrollTop = Math.max(0, top - 40);
    else if (top > ta.scrollTop + h - 40) ta.scrollTop = top - h + 80;
  }

  function toggleComment() {
    var tab = SG.ide.tabs.getActiveTab();
    if (!tab) return;
    var cfg = C().langConfig(tab.language);
    var marker = cfg.lineComment;
    var ta = D().ta;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var value = ta.value;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = value.indexOf('\n', end);
    if (lineEnd < 0) lineEnd = value.length;
    var block = value.slice(lineStart, lineEnd);
    var lines = block.split('\n');

    if (!marker) {
      if (!cfg.blockComment) { SG.ide.dialogs.toast('No comment syntax'); return; }
      marker = cfg.blockComment[0];
      var close = cfg.blockComment[1];
      if (start !== end) {
        var selected = value.slice(start, end);
        replaceRange(start, end, marker + selected + close, start + marker.length, start + marker.length + selected.length);
      } else {
        insertTextAtCursor(marker + close, marker.length);
      }
      return;
    }

    var allCommented = lines.every(function (l) {
      return l.trim() === '' || l.replace(/^\s*/, '').indexOf(marker) === 0;
    });

    var updated = lines.map(function (l) {
      if (allCommented) {
        var re = new RegExp('^(\\s*)' + U().escapeRegExp(marker) + ' ?');
        return l.replace(re, '$1');
      }
      return l.replace(/^(\s*)/, '$1' + marker + ' ');
    }).join('\n');

    replaceRange(lineStart, lineEnd, updated, lineStart, lineStart + updated.length);
  }

  function duplicateLine() {
    var ta = D().ta;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var value = ta.value;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = value.indexOf('\n', end);
    if (lineEnd < 0) lineEnd = value.length;
    var block = value.slice(lineStart, lineEnd);
    var insert = block + '\n' + block;
    replaceRange(lineStart, lineEnd, insert, lineStart + insert.length, lineStart + insert.length);
  }

  function moveLine(dir) {
    var ta = D().ta;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var value = ta.value;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = value.indexOf('\n', end);
    if (lineEnd < 0) lineEnd = value.length;
    if (dir < 0 && lineStart === 0) return;
    if (dir > 0 && lineEnd >= value.length) return;
    var block = value.slice(lineStart, lineEnd);

    if (dir < 0) {
      var prevStart = value.lastIndexOf('\n', lineStart - 2) + 1;
      var prev = value.slice(prevStart, lineStart - 1);
      var newValue = value.slice(0, prevStart) + block + '\n' + prev + value.slice(lineEnd);
      var delta = block.length + 1;
      ta.value = newValue;
      try { ta.setSelectionRange(start - delta, end - delta); } catch (_) {}
    } else {
      var nextEnd = value.indexOf('\n', lineEnd + 1);
      if (nextEnd < 0) nextEnd = value.length;
      var next = value.slice(lineEnd + 1, nextEnd);
      var newValue2 = value.slice(0, lineStart) + next + '\n' + block + value.slice(nextEnd);
      var delta2 = next.length + 1;
      ta.value = newValue2;
      try { ta.setSelectionRange(start + delta2, end + delta2); } catch (_) {}
    }
    onInput();
  }

  function gotoLine() {
    SG.ide.dialogs.showPrompt('Go to line', '1', 'Line number').then(function (n) {
      if (!n) return;
      var line = parseInt(n, 10);
      if (!line || line < 1) return;
      var ta = D().ta;
      var lines = ta.value.split('\n');
      line = Math.min(line, lines.length);
      var idx = 0;
      for (var i = 0; i < line - 1; i++) idx += lines[i].length + 1;
      ta.setSelectionRange(idx, idx + lines[line - 1].length);
      ta.focus();
      scrollToSelection();
      updateStatus();
    });
  }

  function formatJSON() {
    var tab = SG.ide.tabs.getActiveTab();
    if (!tab) return;
    if (tab.language !== 'json') { SG.ide.dialogs.toast('Format currently supports JSON files'); return; }
    try {
      var parsed = JSON.parse(D().ta.value);
      setEditorContent(JSON.stringify(parsed, null, 2));
      SG.ide.dialogs.toast('Formatted JSON');
    } catch (e) {
      SG.ide.dialogs.toast('Invalid JSON: ' + e.message, 'error');
    }
  }

  // ---- Find / replace ----

  function computeFindMatches() {
    var dom = D();
    var find = S().find;
    var query = dom.findInput ? dom.findInput.value : '';
    find.query = query;
    find.replace = dom.replaceInput ? dom.replaceInput.value : '';
    find.matches = [];
    find.index = -1;
    if (!query) return;

    var text = dom.ta.value;
    var flags = 'g' + (find.caseSensitive ? '' : 'i');
    var re;
    try { re = find.regex ? new RegExp(query, flags) : new RegExp(U().escapeRegExp(query), flags); } catch (_) { return; }

    var m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      find.matches.push({ start: m.index, end: m.index + m[0].length });
      if (find.matches.length > 5000) break;
    }
    if (find.matches.length) {
      var caret = dom.ta.selectionStart;
      for (var i = 0; i < find.matches.length; i++) {
        if (find.matches[i].start >= caret) { find.index = i; break; }
      }
      if (find.index < 0) find.index = 0;
    }
  }

  function updateFindCount() {
    var dom = D();
    if (!dom.findCount) return;
    if (!S().find.matches.length) {
      dom.findCount.textContent = dom.findInput && dom.findInput.value ? '0/0' : '';
    } else {
      dom.findCount.textContent = (S().find.index + 1) + '/' + S().find.matches.length;
    }
  }

  function openFind(replaceMode) {
    var dom = D();
    if (!dom.findBar) return;
    dom.findBar.hidden = false;
    var sel = dom.ta.value.slice(dom.ta.selectionStart, dom.ta.selectionEnd);
    if (sel && sel.indexOf('\n') < 0) dom.findInput.value = sel;
    computeFindMatches();
    updateFindCount();
    setTimeout(function () {
      try { dom.findInput.focus(); dom.findInput.select(); } catch (_) {}
    }, 20);
    if (replaceMode) setTimeout(function () { try { dom.replaceInput.focus(); } catch (_) {} }, 30);
  }

  function closeFind() {
    var dom = D();
    if (!dom.findBar || dom.findBar.hidden) return;
    dom.findBar.hidden = true;
    try { dom.ta.focus(); } catch (_) {}
  }

  function toggleFindOption(which) {
    var find = S().find;
    var dom = D();
    if (which === 'case') {
      find.caseSensitive = !find.caseSensitive;
      var cb = dom.findBar.querySelector('[data-action="toggle-case"]');
      if (cb) cb.classList.toggle('active', find.caseSensitive);
    }
    if (which === 'regex') {
      find.regex = !find.regex;
      var rb = dom.findBar.querySelector('[data-action="toggle-regex"]');
      if (rb) rb.classList.toggle('active', find.regex);
    }
    computeFindMatches();
    updateFindCount();
  }

  function findNext(dir) {
    computeFindMatches();
    var find = S().find;
    var dom = D();
    if (!find.matches.length) { updateFindCount(); SG.ide.dialogs.toast('No matches'); return; }
    var idx = find.index < 0 ? 0 : (find.index + dir + find.matches.length) % find.matches.length;
    find.index = idx;
    var m = find.matches[idx];
    try {
      dom.ta.setSelectionRange(m.start, m.end);
      dom.ta.focus();
    } catch (_) {}
    scrollToSelection();
    updateFindCount();
  }

  function replaceOne() {
    computeFindMatches();
    var find = S().find;
    var dom = D();
    if (!find.matches.length) { SG.ide.dialogs.toast('No matches'); return; }
    var m = find.matches[find.index >= 0 ? find.index : 0];
    if (!m) return;
    dom.ta.setRangeText(dom.replaceInput.value, m.start, m.end, 'end');
    onInput();
    computeFindMatches();
    updateFindCount();
    findNext(1);
  }

  function replaceAll() {
    computeFindMatches();
    var find = S().find;
    var dom = D();
    if (!find.matches.length) { SG.ide.dialogs.toast('No matches'); return; }
    var text = dom.ta.value;
    var replacement = dom.replaceInput.value;
    var newText;
    if (find.regex) {
      var flags = 'g' + (find.caseSensitive ? '' : 'i');
      try { newText = text.replace(new RegExp(find.query, flags), replacement); } catch (_) { return; }
    } else {
      newText = text.split(find.query).join(replacement);
    }
    setEditorContent(newText);
    SG.ide.dialogs.toast('Replaced all');
    computeFindMatches();
    updateFindCount();
  }

  function scheduleFind() {
    clearTimeout(findTimer);
    findTimer = setTimeout(function () { computeFindMatches(); updateFindCount(); }, 120);
  }

  // ---- Completions ----

  function showCompletions() {
    var tab = SG.ide.tabs.getActiveTab();
    if (!tab) return;
    var ta = D().ta;
    var pos = ta.selectionStart;
    var before = ta.value.slice(0, pos);
    var m = before.match(/[A-Za-z_$][\w$]*$/);
    var prefix = m ? m[0] : '';
    var start = m ? pos - prefix.length : pos;
    var cfg = C().langConfig(tab.language);
    var seen = {};
    var candidates = [];

    function add(label, kind) {
      if (!label || seen[label]) return;
      seen[label] = true;
      candidates.push({ label: label, kind: kind });
    }

    (cfg.keywords || []).forEach(function (k) { add(k, 'kw'); });
    (cfg.builtins || []).forEach(function (k) { add(k, 'fn'); });
    (cfg.types || []).forEach(function (k) { add(k, 'type'); });

    var re = /[A-Za-z_$][\w$]{1,}/g;
    var mm;
    while ((mm = re.exec(ta.value)) !== null) {
      if (mm[0].length >= 2) add(mm[0], 'word');
    }

    var lower = prefix.toLowerCase();
    var filtered = candidates.filter(function (c) {
      return c.label.toLowerCase().indexOf(lower) === 0;
    }).slice(0, 40);

    if (!filtered.length) { SG.ide.dialogs.toast('No suggestions'); return; }

    S().completion.items = filtered;
    S().completion.index = 0;
    S().completion.prefix = prefix;
    S().completion.start = start;
    renderCompletions();
  }

  function renderCompletions() {
    var dom = D();
    var completion = S().completion;
    if (!dom.completions) return;
    dom.completions.hidden = false;
    dom.completions.innerHTML = '';
    completion.items.forEach(function (item, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ide-completion' + (i === completion.index ? ' active' : '');
      btn.innerHTML = '<span class="ide-completion-kind"></span><span class="ide-completion-label"></span>';
      btn.querySelector('.ide-completion-kind').textContent = item.kind;
      btn.querySelector('.ide-completion-label').textContent = item.label;
      btn.addEventListener('click', function () { applyCompletion(i); });
      dom.completions.appendChild(btn);
    });
  }

  function hideCompletions() {
    var dom = D();
    if (dom && dom.completions) dom.completions.hidden = true;
    S().completion.items = [];
  }

  function applyCompletion(i) {
    var completion = S().completion;
    var item = completion.items[i];
    var dom = D();
    if (!item || !dom.ta) return;
    dom.ta.setRangeText(item.label, completion.start, dom.ta.selectionStart, 'end');
    hideCompletions();
    onInput();
    try { dom.ta.focus(); } catch (_) {}
  }

  SG.ide.editor = {
    getCaretPos: getCaretPos,
    updateStatus: updateStatus,
    updateGutter: updateGutter,
    scheduleGutter: scheduleGutter,
    scheduleHighlight: scheduleHighlight,
    renderHighlight: renderHighlight,
    syncScroll: syncScroll,
    onInput: onInput,
    setEditorContent: setEditorContent,
    insertTextAtCursor: insertTextAtCursor,
    replaceRange: replaceRange,
    handleEnter: handleEnter,
    handleTab: handleTab,
    handleAutoPair: handleAutoPair,
    onEditorKeyDown: onEditorKeyDown,
    scrollToSelection: scrollToSelection,
    toggleComment: toggleComment,
    duplicateLine: duplicateLine,
    moveLine: moveLine,
    gotoLine: gotoLine,
    formatJSON: formatJSON,
    undo: undo,
    redo: redo,
    pushHistory: pushHistory,
    applyHistory: applyHistory,
    scheduleHistory: scheduleHistory,
    scheduleAutoSave: scheduleAutoSave,
    openFind: openFind,
    closeFind: closeFind,
    findNext: findNext,
    replaceOne: replaceOne,
    replaceAll: replaceAll,
    computeFindMatches: computeFindMatches,
    updateFindCount: updateFindCount,
    toggleFindOption: toggleFindOption,
    scheduleFind: scheduleFind,
    showCompletions: showCompletions,
    renderCompletions: renderCompletions,
    hideCompletions: hideCompletions,
    applyCompletion: applyCompletion
  };
})(window.SG = window.SG || {});