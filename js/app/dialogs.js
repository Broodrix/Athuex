/* Athuex in-app dialogs — P4 modular split v2.5.5 */
(function (SG) {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };
  let _dialogResolve = null;
  let overlayStack = [];

  function ensureDialogUi() {
    if ($('athuex-dialog')) return;
    const wrap = document.createElement('div');
    wrap.id = 'athuex-dialog';
    wrap.className = 'athuex-dialog hidden';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<div class="athuex-dialog-scrim" id="athuex-dialog-scrim"></div>' +
      '<div class="athuex-dialog-card" role="dialog" aria-modal="true">' +
      '<h3 class="athuex-dialog-title" id="athuex-dialog-title">Notice</h3>' +
      '<p class="athuex-dialog-msg" id="athuex-dialog-msg"></p>' +
      '<input type="text" id="athuex-dialog-input" class="athuex-dialog-input hidden" autocomplete="off">' +
      '<div class="athuex-dialog-actions">' +
      '<button type="button" class="btn-secondary" id="athuex-dialog-cancel">Cancel</button>' +
      '<button type="button" class="btn-primary" id="athuex-dialog-ok">OK</button>' +
      '</div></div>';
    document.body.appendChild(wrap);
    function finish(val) {
      const r = _dialogResolve;
      _dialogResolve = null;
      wrap.classList.add('hidden');
      wrap.setAttribute('aria-hidden', 'true');
      if (r) r(val);
    }
    $('athuex-dialog-ok').onclick = function () {
      const input = $('athuex-dialog-input');
      if (input && !input.classList.contains('hidden')) finish(input.value);
      else finish(true);
    };
    $('athuex-dialog-cancel').onclick = function () { finish(null); };
    $('athuex-dialog-scrim').onclick = function () { finish(null); };
  }

  function showDialog(opts) {
    ensureDialogUi();
    opts = opts || {};
    const wrap = $('athuex-dialog');
    const title = $('athuex-dialog-title');
    const msg = $('athuex-dialog-msg');
    const input = $('athuex-dialog-input');
    const cancel = $('athuex-dialog-cancel');
    title.textContent = opts.title || 'Notice';
    msg.textContent = opts.message || '';
    if (opts.prompt) {
      input.classList.remove('hidden');
      input.value = opts.defaultValue != null ? String(opts.defaultValue) : '';
    } else {
      input.classList.add('hidden');
    }
    cancel.style.display = opts.hideCancel ? 'none' : '';
    wrap.classList.remove('hidden');
    wrap.setAttribute('aria-hidden', 'false');
    return new Promise(function (resolve) { _dialogResolve = resolve; });
  }

  function athuexAlert(message, title) {
    return showDialog({ title: title || 'Athuex', message: String(message || ''), hideCancel: true }).then(function () { return true; });
  }
  function athuexConfirm(message, title) {
    return showDialog({ title: title || 'Confirm', message: String(message || '') }).then(function (v) { return !!v; });
  }
  function athuexPrompt(message, def, title) {
    return showDialog({
      title: title || 'Input',
      message: String(message || ''),
      prompt: true,
      defaultValue: def != null ? def : ''
    }).then(function (v) { return v === null ? null : String(v); });
  }

  function pushOverlay(kind, state) {
    overlayStack.push({ kind: kind, state: state });
  }
  function popOverlay() {
    return overlayStack.pop();
  }

  SG.appDialogs = {
    ensureDialogUi: ensureDialogUi,
    athuexAlert: athuexAlert,
    athuexConfirm: athuexConfirm,
    athuexPrompt: athuexPrompt,
    pushOverlay: pushOverlay,
    popOverlay: popOverlay
  };
})(window.SG = window.SG || {});
