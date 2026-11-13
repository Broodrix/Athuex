/* Athuex Harness Adapters UI — P6 v2.5.8 */
(function (SG) {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };

  function renderGrid() {
    const grid = $('adapters-grid');
    const status = $('adapters-status');
    if (!grid) return;
    grid.innerHTML = '';
    if (!SG.harness || typeof SG.harness.listPlugins !== 'function') {
      if (status) status.textContent = 'Harness not loaded';
      return;
    }
    const list = SG.harness.listPlugins().filter(function (p) {
      return p.source === 'adapter' || p.source === 'user' || p.source === 'core';
    });
    // Prefer showing adapters first, then core safety
    list.sort(function (a, b) {
      const rank = function (s) {
        if (s === 'adapter') return 0;
        if (s === 'user') return 1;
        return 2;
      };
      return rank(a.source) - rank(b.source) || a.id.localeCompare(b.id);
    });
    list.forEach(function (p) {
      const card = document.createElement('div');
      card.className = 'adapter-card' + (p.enabled ? ' enabled' : '');
      card.setAttribute('role', 'listitem');
      const title = document.createElement('div');
      title.className = 'ad-title';
      title.textContent = p.id;
      const desc = document.createElement('div');
      desc.className = 'ad-desc';
      desc.textContent = p.description || '—';
      const meta = document.createElement('div');
      meta.className = 'ad-meta';
      meta.textContent = (p.source || '') + ' · v' + (p.version || '?') +
        (p.hasBefore ? ' · before' : '') + (p.hasAfter ? ' · after' : '');
      const toggle = document.createElement('label');
      toggle.className = 'ad-toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!p.enabled;
      cb.setAttribute('aria-label', 'Enable ' + p.id);
      const span = document.createElement('span');
      span.textContent = p.enabled ? 'Enabled' : 'Disabled';
      cb.addEventListener('change', function () {
        if (SG.harness && typeof SG.harness.enablePlugin === 'function') {
          SG.harness.enablePlugin(p.id, cb.checked);
          span.textContent = cb.checked ? 'Enabled' : 'Disabled';
          card.classList.toggle('enabled', cb.checked);
          if (typeof SG.toast === 'function') {
            SG.toast(p.id + (cb.checked ? ' enabled' : ' disabled'));
          }
          updateStatusLine();
        }
      });
      toggle.appendChild(cb);
      toggle.appendChild(span);
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(meta);
      card.appendChild(toggle);
      grid.appendChild(card);
    });
    updateStatusLine();
  }

  function updateStatusLine() {
    const status = $('adapters-status');
    if (!status || !SG.harness) return;
    const all = SG.harness.listPlugins() || [];
    const on = all.filter(function (p) { return p.enabled; }).length;
    status.textContent = on + ' / ' + all.length + ' plugins active · harness ' + (SG.harness.version || '');
  }

  function openAdapters() {
    const dlg = $('adapters-dialog');
    if (!dlg) return;
    renderGrid();
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  function closeAdapters() {
    const dlg = $('adapters-dialog');
    if (!dlg) return;
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }

  function bind() {
    const openBtn = $('btn-open-adapters');
    const closeBtn = $('btn-close-adapters');
    if (openBtn && !openBtn.getAttribute('data-bound')) {
      openBtn.setAttribute('data-bound', '1');
      openBtn.addEventListener('click', openAdapters);
    }
    if (closeBtn && !closeBtn.getAttribute('data-bound')) {
      closeBtn.setAttribute('data-bound', '1');
      closeBtn.addEventListener('click', closeAdapters);
    }
    document.addEventListener('athuex:harness-adapters', function () {
      if ($('adapters-dialog') && $('adapters-dialog').open) renderGrid();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  SG.adaptersUI = {
    open: openAdapters,
    close: closeAdapters,
    render: renderGrid
  };
})(window.SG = window.SG || {});
