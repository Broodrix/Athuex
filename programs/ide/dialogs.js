/* IDE module: dialogs (toast, modals, context menus). See programsRegistry.register() in programs/ide.js */
(function (SG) {
  'use strict';
  SG.ide = SG.ide || {};

  var toastTimer = null;

  function toast(message, type) {
    var state = SG.ide.state;
    if (!state.global || !state.global.toast) return;
    var el = state.global.toast;
    el.textContent = String(message || '');
    el.className = 'ide-toast show' + (type === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.className = 'ide-toast' + (type === 'error' ? ' error' : '');
    }, 2600);
  }

  function showPrompt(title, value, placeholder) {
    return new Promise(function (resolve) {
      var state = SG.ide.state;
      if (!state.shell) { resolve(null); return; }
      var overlay = document.createElement('div');
      overlay.className = 'ide-modal';
      overlay.innerHTML =
        '<div class="ide-modal-box" role="dialog" aria-modal="true">' +
          '<div class="ide-modal-title"></div>' +
          '<input class="ide-modal-input" type="text" autocomplete="off" spellcheck="false">' +
          '<div class="ide-modal-actions">' +
            '<button type="button" data-act="cancel">Cancel</button>' +
            '<button type="button" data-act="ok" class="primary">OK</button>' +
          '</div>' +
        '</div>';
      state.shell.appendChild(overlay);
      overlay.querySelector('.ide-modal-title').textContent = title || '';
      var input = overlay.querySelector('input');
      input.value = value || '';
      input.placeholder = placeholder || '';

      var closed = false;
      function close(val) {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        resolve(val);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
        else if (e.key === 'Enter') { e.preventDefault(); close(input.value.trim()); }
      }
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) { close(null); return; }
        var act = e.target.getAttribute('data-act');
        if (act === 'ok') close(input.value.trim());
        if (act === 'cancel') close(null);
      });
      document.addEventListener('keydown', onKey);
      setTimeout(function () { try { input.focus(); input.select(); } catch (_) {} }, 20);
    });
  }

  function showConfirm(message, okLabel) {
    return new Promise(function (resolve) {
      var state = SG.ide.state;
      if (!state.shell) { resolve(false); return; }
      var overlay = document.createElement('div');
      overlay.className = 'ide-modal';
      overlay.innerHTML =
        '<div class="ide-modal-box" role="dialog" aria-modal="true">' +
          '<div class="ide-modal-title">Confirm</div>' +
          '<div class="ide-modal-message"></div>' +
          '<div class="ide-modal-actions">' +
            '<button type="button" data-act="cancel">Cancel</button>' +
            '<button type="button" data-act="ok" class="primary"></button>' +
          '</div>' +
        '</div>';
      state.shell.appendChild(overlay);
      overlay.querySelector('.ide-modal-message').textContent = message || '';
      overlay.querySelector('[data-act="ok"]').textContent = okLabel || 'OK';

      var closed = false;
      function close(val) {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        resolve(val);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        else if (e.key === 'Enter') { e.preventDefault(); close(true); }
      }
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) { close(false); return; }
        var act = e.target.getAttribute('data-act');
        if (act === 'ok') close(true);
        if (act === 'cancel') close(false);
      });
      document.addEventListener('keydown', onKey);
      setTimeout(function () { try { overlay.querySelector('[data-act="ok"]').focus(); } catch (_) {} }, 20);
    });
  }

  function closeContextMenu() {
    var menu = document.getElementById('ide-context-menu');
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
  }

  function showContextMenu(x, y, items) {
    var state = SG.ide.state;
    if (!state.shell) return;
    closeContextMenu();
    var menu = document.createElement('div');
    menu.className = 'ide-context';
    menu.id = 'ide-context-menu';

    items.forEach(function (item) {
      if (item.separator) {
        var sep = document.createElement('div');
        sep.className = 'sep';
        menu.appendChild(sep);
        return;
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = item.label;
      if (item.danger) btn.className = 'danger';
      btn.addEventListener('click', function () {
        closeContextMenu();
        try { item.run(); } catch (e) { toast(String(e.message || e), 'error'); }
      });
      menu.appendChild(btn);
    });

    state.shell.appendChild(menu);
    var rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';

    setTimeout(function () {
      document.addEventListener('pointerdown', onDocDown, { once: true });
    }, 0);
    function onDocDown(e) {
      if (!menu.contains(e.target)) closeContextMenu();
    }
  }

  SG.ide.dialogs = {
    toast: toast,
    showPrompt: showPrompt,
    showConfirm: showConfirm,
    showContextMenu: showContextMenu,
    closeContextMenu: closeContextMenu
  };
})(window.SG = window.SG || {});