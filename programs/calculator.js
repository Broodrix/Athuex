/* ============================================================================
 * Program: Calculator — v1.3.7
 * Path:    programs/calculator.js
 * Version: 1.3.7
 *
 * A self-contained calculator program for the Athuex navbar.
 * Registered as `kind: 'custom'` — the framework injects `content` as HTML
 * into the active panel, then calls `onActivate` so we can wire events.
 *
 * Hot-swap: copy into workspace as programs/calculator.js → Programs → Scan.
 * ========================================================================== */
(function (SG) {
  'use strict';
  const R = SG.programsRegistry;
  if (!R) return;

  /* ---- UI markup ---------------------------------------------------------- */

  var CONTENT =
    '<div class="prog-calc" id="calc-app">' +
      '<style>' +
        '.prog-calc{display:flex;flex-direction:column;height:100%;min-height:420px;' +
          'max-width:420px;margin:0 auto;padding:14px;box-sizing:border-box;gap:12px;' +
          'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
          'color:#f5f5f7;-webkit-user-select:none;user-select:none;}' +
        '.prog-calc .calc-display{flex:0 0 auto;background:#1c1c1e;' +
          'border:1px solid rgba(255,255,255,.06);border-radius:16px;' +
          'padding:14px 16px;text-align:right;min-height:96px;' +
          'display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden;}' +
        '.prog-calc .calc-expr{font-size:13px;color:#8e8e93;min-height:17px;' +
          'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;}' +
        '.prog-calc .calc-val{font-size:40px;font-weight:300;line-height:1.1;' +
          'margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
          'letter-spacing:.5px;}' +
        '.prog-calc .calc-val.is-error{color:#ff453a;font-size:34px;}' +
        '.prog-calc .calc-grid{flex:1 1 auto;display:grid;' +
          'grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(5,1fr);' +
          'gap:8px;min-height:260px;}' +
        '.prog-calc .calc-grid button{border:0;border-radius:14px;font-size:22px;' +
          'font-weight:500;font-family:inherit;cursor:pointer;padding:0;min-height:52px;' +
          'background:#2c2c2e;color:#f5f5f7;' +
          'transition:filter .08s ease,transform .05s ease;' +
          '-webkit-tap-highlight-color:transparent;touch-action:manipulation;outline:none;}' +
        '.prog-calc .calc-grid button:hover{filter:brightness(1.08);}' +
        '.prog-calc .calc-grid button:active{filter:brightness(1.35);transform:scale(.96);}' +
        '.prog-calc .calc-grid button:focus-visible{outline:2px solid #0a84ff;outline-offset:2px;}' +
        '.prog-calc .btn-fn{background:#3a3a3c;color:#f5f5f7;font-weight:500;}' +
        '.prog-calc .btn-op{background:#ff9f0a;color:#fff;font-weight:600;}' +
        '.prog-calc .btn-eq{background:#ff9f0a;color:#fff;font-weight:700;}' +
        '@media (max-height:560px){' +
          '.prog-calc .calc-val{font-size:32px;}' +
          '.prog-calc .calc-grid button{min-height:44px;font-size:20px;}' +
          '.prog-calc{min-height:340px;}}' +
      '</style>' +
      '<div class="calc-display">' +
        '<div class="calc-expr" id="calc-expr"></div>' +
        '<div class="calc-val" id="calc-val">0</div>' +
      '</div>' +
      '<div class="calc-grid">' +
        '<button type="button" class="btn-fn" data-key="ac"   aria-label="Clear all">AC</button>' +
        '<button type="button" class="btn-fn" data-key="back" aria-label="Backspace">⌫</button>' +
        '<button type="button" class="btn-fn" data-key="pct"  aria-label="Percent">%</button>' +
        '<button type="button" class="btn-op" data-key="op/"  aria-label="Divide">÷</button>' +
        '<button type="button"               data-key="7">7</button>' +
        '<button type="button"               data-key="8">8</button>' +
        '<button type="button"               data-key="9">9</button>' +
        '<button type="button" class="btn-op" data-key="op*"  aria-label="Multiply">×</button>' +
        '<button type="button"               data-key="4">4</button>' +
        '<button type="button"               data-key="5">5</button>' +
        '<button type="button"               data-key="6">6</button>' +
        '<button type="button" class="btn-op" data-key="op-"  aria-label="Subtract">−</button>' +
        '<button type="button"               data-key="1">1</button>' +
        '<button type="button"               data-key="2">2</button>' +
        '<button type="button"               data-key="3">3</button>' +
        '<button type="button" class="btn-op" data-key="op+"  aria-label="Add">+</button>' +
        '<button type="button" class="btn-fn" data-key="sign" aria-label="Toggle sign">±</button>' +
        '<button type="button"               data-key="0">0</button>' +
        '<button type="button"               data-key=".">.</button>' +
        '<button type="button" class="btn-eq" data-key="eq"   aria-label="Equals">=</button>' +
      '</div>' +
    '</div>';

  /* ---- State ------------------------------------------------------------- */

  var state = {
    tokens: [],        // [num, op, num, op, ...]
    current: '',       // number currently being typed
    result: null,      // set after '='
    justEvaluated: false,
    error: false,
    lastExpr: ''
  };

  function resetState() {
    state.tokens = [];
    state.current = '';
    state.result = null;
    state.justEvaluated = false;
    state.error = false;
    state.lastExpr = '';
  }

  /* ---- Formatting -------------------------------------------------------- */

  function fmt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return 'Error';
    if (n === 0) return '0';
    var abs = Math.abs(n);
    if (Number.isInteger(n) && abs < 1e15) return String(n);
    if (abs >= 1e15 || abs < 1e-6) {
      return n.toExponential(6).replace(/\.?0+e/, 'e');
    }
    var s = n.toPrecision(12);
    if (s.indexOf('e') >= 0) return s;
    s = s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return s;
  }

  /* ---- Precedence evaluation (no eval, no Function ctor) ----------------- */

  function evaluateTokens(tokens) {
    if (!tokens.length) return 0;
    var t = tokens.slice();
    // Strip any trailing operator left behind
    while (t.length && typeof t[t.length - 1] === 'string') t.pop();
    if (!t.length) return 0;
    if (t.length === 1) return typeof t[0] === 'number' ? t[0] : NaN;
    // Pass 1 — ×, ÷
    var i = 1;
    while (i < t.length) {
      if (t[i] === '×' || t[i] === '÷') {
        var a = t[i - 1], b = t[i + 1];
        if (typeof a !== 'number' || typeof b !== 'number') return NaN;
        if (t[i] === '÷' && b === 0) return NaN;
        var r = t[i] === '×' ? a * b : a / b;
        t.splice(i - 1, 3, r);
      } else {
        i += 2;
      }
    }
    // Pass 2 — +, −
    var acc = t[0];
    if (typeof acc !== 'number') return NaN;
    for (var j = 1; j < t.length; j += 2) {
      var rhs = t[j + 1];
      if (typeof rhs !== 'number') return NaN;
      acc = t[j] === '+' ? acc + rhs : acc - rhs;
    }
    return acc;
  }

  /* ---- Rendering --------------------------------------------------------- */

  function render() {
    var exprEl = document.getElementById('calc-expr');
    var valEl  = document.getElementById('calc-val');
    if (!exprEl || !valEl) return;

    if (state.error) {
      exprEl.textContent = state.lastExpr || '';
      valEl.textContent = 'Error';
      valEl.classList.add('is-error');
      return;
    }
    valEl.classList.remove('is-error');

    var exprStr = '';
    var main;

    if (state.justEvaluated) {
      exprStr = state.lastExpr || '';
      main = state.result === null ? '0' : fmt(state.result);
    } else {
      if (state.tokens.length > 0) {
        exprStr = state.tokens.map(function (x) {
          return typeof x === 'number' ? fmt(x) : x;
        }).join(' ');
        if (state.current !== '') exprStr += ' ' + state.current;
      }
      if (state.current !== '') {
        main = state.current;
      } else if (state.tokens.length &&
                 typeof state.tokens[state.tokens.length - 1] === 'number') {
        main = fmt(state.tokens[state.tokens.length - 1]);
      } else {
        main = '0';
      }
    }

    exprEl.textContent = exprStr;
    valEl.textContent  = main;
  }

  /* ---- Input handlers ---------------------------------------------------- */

  function pressDigit(d) {
    if (state.error) resetState();
    if (state.justEvaluated) {
      state.tokens = [];
      state.result = null;
      state.justEvaluated = false;
      state.lastExpr = '';
      state.current = '';
    }
    if (state.current.replace(/[-.]/g, '').length >= 15) return;
    if (state.current === '0') state.current = d;
    else state.current += d;
    render();
  }

  function pressDot() {
    if (state.error) resetState();
    if (state.justEvaluated) {
      state.tokens = [];
      state.result = null;
      state.justEvaluated = false;
      state.lastExpr = '';
      state.current = '';
    }
    if (state.current.indexOf('.') >= 0) return;
    if (state.current === '') state.current = '0.';
    else state.current += '.';
    render();
  }

  function pressOp(op) {
    if (state.error) resetState();
    if (state.justEvaluated) {
      state.tokens = [state.result];
      state.result = null;
      state.justEvaluated = false;
      state.lastExpr = '';
      state.current = '';
    }
    if (state.current !== '') {
      state.tokens.push(parseFloat(state.current));
      state.current = '';
    }
    var last = state.tokens[state.tokens.length - 1];
    if (typeof last === 'string') {
      state.tokens[state.tokens.length - 1] = op;
    } else if (state.tokens.length > 0) {
      state.tokens.push(op);
    } else {
      return; // nothing to operate on yet
    }
    render();
  }

  function pressEq() {
    if (state.error) { resetState(); render(); return; }
    if (state.current !== '') {
      state.tokens.push(parseFloat(state.current));
      state.current = '';
    }
    if (state.tokens.length === 0) return;
    // Drop trailing operator: [1, '+'] length even → incomplete; [1, '+', 2] length odd → ok
    if (state.tokens.length % 2 === 0) state.tokens.pop();
    if (state.tokens.length === 0) return;

    var exprStr = state.tokens.map(function (x) {
      return typeof x === 'number' ? fmt(x) : x;
    }).join(' ');
    var res = evaluateTokens(state.tokens);

    if (!isFinite(res)) {
      state.error = true;
      state.lastExpr = exprStr;
      state.tokens = [];
      state.current = '';
      state.result = null;
      state.justEvaluated = false;
      render();
      return;
    }

    state.lastExpr = exprStr;
    state.result = res;
    state.justEvaluated = true;
    state.tokens = [];
    state.current = '';
    render();
  }

  function pressBack() {
    if (state.error) { resetState(); render(); return; }
    if (state.justEvaluated) {
      state.current = state.result === null ? '' : fmt(state.result);
      state.tokens = [];
      state.result = null;
      state.justEvaluated = false;
      state.lastExpr = '';
    }
    if (state.current !== '') {
      state.current = state.current.slice(0, -1);
      if (state.current === '-' || state.current === '') state.current = '';
    } else if (state.tokens.length) {
      state.tokens.pop();
    }
    render();
  }

  function pressSign() {
    if (state.error) { resetState(); render(); return; }
    if (state.justEvaluated) {
      if (state.result !== null) state.result = -state.result;
      render();
      return;
    }
    if (state.current !== '') {
      if (state.current.charAt(0) === '-') state.current = state.current.slice(1);
      else state.current = '-' + state.current;
    } else if (state.tokens.length &&
               typeof state.tokens[state.tokens.length - 1] === 'number') {
      state.tokens[state.tokens.length - 1] = -state.tokens[state.tokens.length - 1];
    }
    render();
  }

  function pressPct() {
    if (state.error) { resetState(); render(); return; }
    var val;
    var fromCurrent = state.current !== '';
    if (fromCurrent) {
      val = parseFloat(state.current);
    } else if (state.justEvaluated && state.result !== null) {
      val = state.result;
    } else if (state.tokens.length &&
               typeof state.tokens[state.tokens.length - 1] === 'number') {
      val = state.tokens[state.tokens.length - 1];
    } else {
      return;
    }

    // Context-aware percent: `200 + 10%` → 10% *of the base* (20),
    // while `200 × 10%` → 0.1.
    var pct = val / 100;
    if (state.tokens.length >= 2) {
      var lastOp = state.tokens[state.tokens.length - 1];
      if ((lastOp === '+' || lastOp === '-') && typeof state.tokens[0] === 'number') {
        pct = state.tokens[0] * (val / 100);
      }
    }

    if (state.justEvaluated) {
      state.result = pct;
      state.lastExpr = '';
    } else if (fromCurrent) {
      state.current = String(pct);
    } else if (state.tokens.length) {
      state.tokens[state.tokens.length - 1] = pct;
    }
    render();
  }

  /* ---- Physical keyboard ------------------------------------------------- */

  function onKey(e) {
    var valEl = document.getElementById('calc-val');
    if (!valEl || valEl.getClientRects().length === 0) return;
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;

    var k = e.key;
    if (k.length === 1 && k >= '0' && k <= '9') { pressDigit(k); e.preventDefault(); return; }
    if (k === '.')                  { pressDot();                e.preventDefault(); return; }
    if (k === '+')                  { pressOp('+');              e.preventDefault(); return; }
    if (k === '-')                  { pressOp('-');              e.preventDefault(); return; }
    if (k === '*')                  { pressOp('×');              e.preventDefault(); return; }
    if (k === '/')                  { pressOp('÷');              e.preventDefault(); return; }
    if (k === 'Enter' || k === '=') { pressEq();                 e.preventDefault(); return; }
    if (k === 'Backspace')          { pressBack();               e.preventDefault(); return; }
    if (k === 'Escape' || k === 'Delete') { resetState(); render(); e.preventDefault(); return; }
    if (k === '%')                  { pressPct();                e.preventDefault(); return; }
    if (k === 'c' || k === 'C')     { resetState(); render();    e.preventDefault(); return; }
    if (k === 'n' || k === 'N')     { pressSign();               e.preventDefault(); return; }
  }

  /* ---- Binding (idempotent, hot-swap safe) ------------------------------- */

  function bind() {
    var root = document.getElementById('calc-app');
    if (!root) return;

    // Replace any previous click handler (supports hot-swap without leaks).
    if (root.__sgCalcHandler) {
      root.removeEventListener('click', root.__sgCalcHandler);
    }
    root.__sgCalcHandler = function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-key]') : null;
      if (!btn) return;
      var k = btn.getAttribute('data-key');
      if (k.length === 1 && k >= '0' && k <= '9') pressDigit(k);
      else if (k === '.')      pressDot();
      else if (k === 'op+')    pressOp('+');
      else if (k === 'op-')    pressOp('-');
      else if (k === 'op*')    pressOp('×');
      else if (k === 'op/')    pressOp('÷');
      else if (k === 'eq')     pressEq();
      else if (k === 'ac')     { resetState(); render(); }
      else if (k === 'back')   pressBack();
      else if (k === 'sign')   pressSign();
      else if (k === 'pct')    pressPct();
    };
    root.addEventListener('click', root.__sgCalcHandler);

    // Replace any previous keydown handler at the document level.
    if (window.__sgCalcKeyHandler) {
      document.removeEventListener('keydown', window.__sgCalcKeyHandler);
    }
    window.__sgCalcKeyHandler = onKey;
    document.addEventListener('keydown', window.__sgCalcKeyHandler);

    render();
  }

  /* ---- Activation -------------------------------------------------------- */

  function onActivate(prog) {
    try {
      document.dispatchEvent(new CustomEvent('sg:program', {
        detail: { id: 'calculator', action: 'activate', program: prog }
      }));
    } catch (_) {}
    setTimeout(bind, 0);
    if (SG.hooks && typeof SG.hooks.onCalculatorActivate === 'function') {
      try { SG.hooks.onCalculatorActivate(prog); } catch (e) { console.warn('[calculator]', e); }
    }
  }

  /* ---- Register ---------------------------------------------------------- */

  R.register({
    id: 'calculator',
    title: 'Calculator',
    icon: '<rect x="4" y="2" width="16" height="20" rx="2.5"/>' +
          '<rect x="7" y="5" width="10" height="3.5" rx="0.5"/>' +
          '<path d="M8 13h2M11 13h2M14 13h2M8 17h2M11 17h2M14 17h2"/>',
    order: 70,
    kind: 'custom',
    view: 'calculator',
    core: false,
    source: 'core:programs',
    version: '1.3.7',
    description: 'Calculator with + − × ÷, %, ±, backspace and keyboard support',
    content: CONTENT,
    onActivate: onActivate
  });
})(window.SG = window.SG || {});