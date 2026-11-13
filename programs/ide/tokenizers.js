/* IDE module: syntax tokenizers & highlighting. See programsRegistry.register() in programs/ide.js */
(function (SG) {
  'use strict';
  SG.ide = SG.ide || {};

  function cfg(lang) { return SG.ide.config.langConfig(lang); }
  function esc(s) { return SG.ide.utils.escapeHtml(s); }
  function span(cls, inner) { return '<span class="' + cls + '">' + inner + '</span>'; }

  function readString(code, start, quote) {
    var i = start + 1;
    while (i < code.length) {
      var c = code.charAt(i);
      if (c === '\\') { i += 2; continue; }
      if (c === quote) { i++; break; }
      if (quote !== '`' && c === '\n') break;
      i++;
    }
    return i;
  }

  function tokenizeCode(code, lang) {
    var c = cfg(lang);
    var tokens = [];
    var i = 0;
    var n = code.length;

    function push(type, s, e) {
      tokens.push({ type: type, value: code.slice(s, e), start: s });
    }

    while (i < n) {
      var ch = code.charAt(i);

      if (/\s/.test(ch)) {
        var ws = i + 1;
        while (ws < n && /\s/.test(code.charAt(ws))) ws++;
        push('ws', i, ws);
        i = ws;
        continue;
      }

      if (c.lineComment && code.slice(i, i + c.lineComment.length) === c.lineComment) {
        var lc = code.indexOf('\n', i);
        if (lc < 0) lc = n;
        push('com', i, lc);
        i = lc;
        continue;
      }

      if (c.blockComment && code.slice(i, i + c.blockComment[0].length) === c.blockComment[0]) {
        var bc = code.indexOf(c.blockComment[1], i + c.blockComment[0].length);
        bc = bc < 0 ? n : bc + c.blockComment[1].length;
        push('com', i, bc);
        i = bc;
        continue;
      }

      if (ch === '"' || ch === "'" || (c.backtick && ch === '`')) {
        var se = readString(code, i, ch);
        push('str', i, se);
        i = se;
        continue;
      }

      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(code.charAt(i + 1)))) {
        var num = i + 1;
        while (num < n && /[0-9a-fA-FxXoObBeE._+\-]/.test(code.charAt(num))) {
          if ((code.charAt(num) === '+' || code.charAt(num) === '-') && !/[eE]/.test(code.charAt(num - 1))) break;
          num++;
        }
        push('num', i, num);
        i = num;
        continue;
      }

      if (/[A-Za-z_$]/.test(ch)) {
        var id = i + 1;
        while (id < n && /[A-Za-z0-9_$]/.test(code.charAt(id))) id++;
        var word = code.slice(i, id);
        var type = 'var';
        if (c.keywordSet.has(word)) type = 'kw';
        else if (c.typeSet.has(word)) type = 'type';
        else if (c.builtinSet.has(word)) type = 'builtin';
        else if (code.charAt(id) === '(') type = 'fn';
        push(type, i, id);
        i = id;
        continue;
      }

      if ('(){}[]'.indexOf(ch) >= 0) {
        push('bracket', i, i + 1);
        i++;
        continue;
      }

      if (/[+\-*/%=<>!&|^~?:;,.@#]/.test(ch)) {
        var op = i + 1;
        while (op < n && /[+\-*/%=<>!&|^~?:;,.@#]/.test(code.charAt(op))) op++;
        push('op', i, op);
        i = op;
        continue;
      }

      push('txt', i, i + 1);
      i++;
    }

    return tokens;
  }

  function tokenizeCss(code) {
    var tokens = [];
    var i = 0, n = code.length, inBlock = false, inValue = false;

    function push(type, s, e) { tokens.push({ type: type, value: code.slice(s, e), start: s }); }

    while (i < n) {
      var ch = code.charAt(i);

      if (/\s/.test(ch)) {
        var ws = i + 1;
        while (ws < n && /\s/.test(code.charAt(ws))) ws++;
        push('ws', i, ws); i = ws; continue;
      }

      if (code.slice(i, i + 2) === '/*') {
        var bc = code.indexOf('*/', i + 2);
        bc = bc < 0 ? n : bc + 2;
        push('com', i, bc); i = bc; continue;
      }

      if (ch === '"' || ch === "'") {
        var se = readString(code, i, ch);
        push('str', i, se); i = se; continue;
      }

      if (!inBlock) {
        if (ch === '{') { push('bracket', i, i + 1); inBlock = true; i++; continue; }
        if (ch === '}') { push('bracket', i, i + 1); inBlock = false; inValue = false; i++; continue; }
        if (ch === '@') {
          var at = i + 1;
          while (at < n && /[\w-]/.test(code.charAt(at))) at++;
          push('kw', i, at); i = at; continue;
        }
        var sel = i;
        while (sel < n && '{};'.indexOf(code.charAt(sel)) < 0 && code.slice(sel, sel + 2) !== '/*' && code.charAt(sel) !== '\n') sel++;
        if (sel === i) sel++;
        push('sel', i, sel); i = sel; continue;
      }

      if (!inValue) {
        if (ch === '}') { push('bracket', i, i + 1); inBlock = false; inValue = false; i++; continue; }
        if (ch === ';') { push('op', i, i + 1); inValue = false; i++; continue; }
        if (ch === ':') { push('op', i, i + 1); inValue = true; i++; continue; }
        var prop = i;
        while (prop < n && ':;{}'.indexOf(code.charAt(prop)) < 0 && code.slice(prop, prop + 2) !== '/*') prop++;
        if (prop === i) prop++;
        push('prop', i, prop); i = prop; continue;
      }

      if (ch === ';') { push('op', i, i + 1); inValue = false; i++; continue; }
      if (ch === '}') { push('bracket', i, i + 1); inBlock = false; inValue = false; i++; continue; }
      if (ch === '(' || ch === ')') { push('bracket', i, i + 1); i++; continue; }

      if (ch === '#') {
        var hex = i + 1;
        while (hex < n && /[0-9a-fA-F]/.test(code.charAt(hex))) hex++;
        push('num', i, hex); i = hex; continue;
      }

      if (/[0-9]/.test(ch)) {
        var num = i + 1;
        while (num < n && /[0-9a-zA-Z.%]/.test(code.charAt(num))) num++;
        push('num', i, num); i = num; continue;
      }

      if (/[A-Za-z_-]/.test(ch)) {
        var word = i + 1;
        while (word < n && /[\w-]/.test(code.charAt(word))) word++;
        var val = code.slice(i, word);
        var isKw = /^(important|inherit|initial|unset|none|auto|block|inline|flex|grid|absolute|relative|fixed|sticky|center|left|right|top|bottom|bold|italic|solid|dashed|transparent|currentColor)$/.test(val);
        push(isKw ? 'kw' : 'val', i, word); i = word; continue;
      }

      if (ch === '!') { push('op', i, i + 1); i++; continue; }
      push('txt', i, i + 1); i++;
    }
    return tokens;
  }

  function tokenizeHtml(code) {
    var tokens = [];
    var i = 0, n = code.length, lower = code.toLowerCase();

    function push(type, s, e) { tokens.push({ type: type, value: code.slice(s, e), start: s }); }

    while (i < n) {
      if (code.slice(i, i + 4) === '<!--') {
        var ce = code.indexOf('-->', i + 4);
        ce = ce < 0 ? n : ce + 3;
        push('com', i, ce); i = ce; continue;
      }
      if (code.slice(i, i + 2) === '<!' || code.slice(i, i + 2) === '<?') {
        var de = code.indexOf('>', i);
        de = de < 0 ? n : de + 1;
        push('com', i, de); i = de; continue;
      }
      if (code.charAt(i) === '<') {
        var j = i + 1;
        var closing = false;
        if (code.charAt(j) === '/') { closing = true; j++; }
        var nameStart = j;
        while (j < n && /[A-Za-z0-9:-]/.test(code.charAt(j))) j++;
        var tagName = code.slice(nameStart, j);
        if (!tagName) { push('txt', i, i + 1); i++; continue; }

        push('bracket', i, i + 1);
        if (closing) push('bracket', i + 1, i + 2);
        push('kw', nameStart, j);

        var k = j;
        while (k < n) {
          if (code.charAt(k) === '>') { push('bracket', k, k + 1); k++; break; }
          if (code.charAt(k) === '/' && code.charAt(k + 1) === '>') { push('bracket', k, k + 2); k += 2; break; }
          if (/\s/.test(code.charAt(k))) {
            var ws = k + 1;
            while (ws < n && /\s/.test(code.charAt(ws))) ws++;
            push('ws', k, ws); k = ws; continue;
          }
          if (code.charAt(k) === '"' || code.charAt(k) === "'") {
            var se = readString(code, k, code.charAt(k));
            push('str', k, se); k = se; continue;
          }
          if (code.charAt(k) === '=') { push('op', k, k + 1); k++; continue; }
          var ae = k + 1;
          while (ae < n && !/[\s=>"'\/]/.test(code.charAt(ae))) ae++;
          if (ae === k) ae = k + 1;
          push('attr', k, ae); k = ae;
        }
        i = k;

        var lowerTag = tagName.toLowerCase();
        if (!closing && (lowerTag === 'script' || lowerTag === 'style')) {
          var end = lower.indexOf('</' + lowerTag, i);
          var innerEnd = end < 0 ? n : end;
          var inner = code.slice(i, innerEnd);
          if (inner) {
            var innerToks = lowerTag === 'script' ? tokenizeCode(inner, 'javascript') : tokenizeCss(inner);
            for (var t = 0; t < innerToks.length; t++) {
              tokens.push({ type: innerToks[t].type, value: innerToks[t].value, start: innerToks[t].start + i });
            }
          }
          i = innerEnd;
        }
        continue;
      }
      if (code.charAt(i) === '&') {
        var ent = code.indexOf(';', i);
        if (ent > i && ent - i <= 12) { push('num', i, ent + 1); i = ent + 1; continue; }
      }
      var next = code.indexOf('<', i);
      if (next < 0) next = n;
      push('txt', i, next); i = next;
    }
    return tokens;
  }

  function highlightMarkdownHtml(src) {
    var lines = String(src).split('\n');
    var inFence = false;

    function inline(text) {
      var html = esc(text);
      html = html.replace(/`([^`]+)`/g, function (_, a) { return span('md-inline-code', a); });
      html = html.replace(/\*\*([^*]+)\*\*/g, function (_, a) { return span('md-strong', a); });
      html = html.replace(/(^|[^*])\*([^*]+)\*/g, function (m, pre, a) { return pre + span('md-em', a); });
      html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (m, label, url) {
        return span('md-link', label) + span('md-url', '(' + url + ')');
      });
      return html;
    }

    return lines.map(function (line) {
      if (/^```/.test(line)) {
        inFence = !inFence;
        return span('md-fence', esc(line));
      }
      if (inFence) return span('md-codeblock', esc(line));
      if (/^\s*$/.test(line)) return '';
      if (/^#{1,6}\s+/.test(line)) return span('md-head', esc(line));
      if (/^\s*>\s?/.test(line)) return span('md-quote', esc(line));
      return inline(line);
    }).join('\n');
  }

  function highlightCsvHtml(src) {
    return String(src).split('\n').map(function (line, idx) {
      var out = '', i = 0, header = idx === 0;
      while (i < line.length) {
        var cell = '';
        if (line.charAt(i) === '"') {
          var j = i + 1;
          while (j < line.length) {
            if (line.charAt(j) === '"' && line.charAt(j + 1) === '"') { cell += '"'; j += 2; continue; }
            if (line.charAt(j) === '"') { j++; break; }
            cell += line.charAt(j); j++;
          }
          out += span('csv-str', esc(cell)); i = j;
        } else {
          var k = line.indexOf(',', i);
          if (k < 0) k = line.length;
          cell = line.slice(i, k);
          out += span(header ? 'csv-head' : 'csv-cell', esc(cell));
          i = k;
        }
        if (i < line.length && line.charAt(i) === ',') { out += span('csv-delim', ','); i++; }
      }
      return out;
    }).join('\n');
  }

  var TOKEN_CLASS = {
    kw: 'tok-kw', str: 'tok-str', num: 'tok-num', com: 'tok-com',
    fn: 'tok-fn', op: 'tok-op', var: 'tok-var', type: 'tok-type',
    builtin: 'tok-builtin', bracket: 'tok-bracket', attr: 'tok-attr',
    sel: 'tok-sel', prop: 'tok-prop', val: 'tok-val'
  };

  function tokensToHtml(tokens, matches) {
    var out = '';
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var cls = TOKEN_CLASS[t.type] || '';
      if (t.type === 'bracket' && matches && matches.has(t.start)) cls += ' ide-bracket-match';
      var safe = esc(t.value);
      out += cls ? '<span class="' + cls + '">' + safe + '</span>' : safe;
    }
    return out;
  }

  function computeBracketMatch(tokens, pos) {
    if (!tokens || !tokens.length) return null;
    var open = '([{', close = ')]}', idx = -1;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t.type !== 'bracket') continue;
      if (t.start <= pos && pos <= t.start + t.value.length) { idx = i; break; }
    }
    if (idx < 0) return null;
    var ch = tokens[idx].value, pair, dir;
    if (open.indexOf(ch) >= 0) { pair = close.charAt(open.indexOf(ch)); dir = 1; }
    else if (close.indexOf(ch) >= 0) { pair = open.charAt(close.indexOf(ch)); dir = -1; }
    else return null;
    var depth = 0;
    for (var j = idx; j >= 0 && j < tokens.length; j += dir) {
      var tok = tokens[j];
      if (tok.type !== 'bracket') continue;
      if (tok.value === ch) depth++;
      else if (tok.value === pair) { depth--; if (depth === 0) return new Set([tokens[idx].start, tok.start]); }
    }
    return null;
  }

  function highlightCode(code, lang, tokens, matches) {
    if (lang === 'markdown') return highlightMarkdownHtml(code);
    if (lang === 'csv') return highlightCsvHtml(code);
    if (!tokens) {
      if (lang === 'html') tokens = tokenizeHtml(code);
      else if (lang === 'css') tokens = tokenizeCss(code);
      else tokens = tokenizeCode(code, lang);
    }
    return tokensToHtml(tokens, matches);
  }

  SG.ide.tokenizers = {
    readString: readString,
    tokenizeCode: tokenizeCode,
    tokenizeCss: tokenizeCss,
    tokenizeHtml: tokenizeHtml,
    highlightCode: highlightCode,
    highlightMarkdownHtml: highlightMarkdownHtml,
    highlightCsvHtml: highlightCsvHtml,
    computeBracketMatch: computeBracketMatch
  };
})(window.SG = window.SG || {});