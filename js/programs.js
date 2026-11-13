/* Programs UI bootstrap — chips, manager, hot-swap — v1.3.7 */
(function (SG) {
  'use strict';
  const VERSION = (typeof window !== 'undefined' && window.ATHUEX_VERSION) || '1.0.0';

  function $(id) { return document.getElementById(id); }

  function ensureRegistry() {
    return SG.programsRegistry || null;
  }

  function toast(msg) {
    if (typeof SG.toast === 'function') SG.toast(msg);
    else if (typeof window.toast === 'function') window.toast(msg);
    else {
      var st = $('status-text');
      if (st) st.textContent = String(msg || '');
    }
  }

  function renderChips() {
    const R = ensureRegistry();
    const bar = $('quickbar');
    if (!R || !bar) return;
    const programs = (typeof R.pinnedList === 'function' ? R.pinnedList() : R.list().filter(function (p) { return p.enabled; }));
    const addBtn = $('chip-add');
    bar.querySelectorAll('.chip[data-program]').forEach(function (el) { el.remove(); });
    programs.forEach(function (p) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.setAttribute('data-program', p.id);
      btn.setAttribute('data-view', p.view || p.id);
      btn.id = 'chip-' + p.id;
      btn.title = p.description || p.title;
      btn.innerHTML = '<svg class="chip-ico" viewBox="0 0 24 24" aria-hidden="true">' +
        (p.icon || '') + '</svg><span></span>';
      btn.querySelector('span').textContent = p.title;
      btn.addEventListener('click', function () { activateProgram(p.id); });
      if (addBtn) bar.insertBefore(btn, addBtn);
      else bar.appendChild(btn);
    });
    if (typeof SG._programsOnChipsRender === 'function') SG._programsOnChipsRender();
  }

  function activateProgram(id) {
    const R = ensureRegistry();
    if (!R) return false;
    id = String(id || '');
    const p = R.get(id);
    if (!p || !p.enabled) {
      toast('Program unavailable: ' + id);
      return false;
    }
    if (p.kind === 'dialog' && p.dialog) {
      const d = $(p.dialog);
      if (d && d.showModal) d.showModal();
      if (typeof p.onActivate === 'function') {
        try { p.onActivate(p); } catch (e) { console.warn('[program]', id, e); }
      }
      return true;
    }
    // Single path: _programsActivatePanel owns view switch + onActivate (no double-call)
    if (typeof SG._programsActivatePanel === 'function') {
      SG._programsActivatePanel(p);
    } else {
      try {
        window.dispatchEvent(new CustomEvent('athuex:open-program', {
          detail: { id: p.id, view: p.view || p.id }
        }));
      } catch (_) {}
      if (typeof p.onActivate === 'function') {
        try { p.onActivate(p); } catch (e) { console.warn('[program]', id, e); }
      }
    }
    document.querySelectorAll('#quickbar .chip[data-program]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-program') === id);
    });
    return true;
  }

  function openManager() {
    bindManagerButtons();
    const dlg = $('programs-dialog');
    if (!dlg) {
      toast('Programs dialog missing');
      return;
    }
    renderManagerList();
    if (dlg.showModal) dlg.showModal();
  }

  function renderManagerList() {
    const R = ensureRegistry();
    const list = $('programs-manager-list');
    if (!R || !list) return;
    const programs = R.list();
    list.innerHTML = '';
    if (!programs.length) {
      list.innerHTML = '<p class="muted" style="padding:8px">No programs registered</p>';
      return;
    }
    programs.forEach(function (p, idx) {
      const row = document.createElement('div');
      row.className = 'prog-mgr-row' + (p.enabled ? '' : ' disabled');
      row.innerHTML =
        '<div class="prog-mgr-main">' +
          '<strong></strong>' +
          '<span class="muted prog-mgr-meta"></span>' +
        '</div>' +
        '<div class="prog-mgr-actions"></div>';
      row.querySelector('strong').textContent = p.title;
      row.querySelector('.prog-mgr-meta').textContent =
        p.id + (p.core ? ' · core' : ' · user') + ' · v' + (p.version || '?') + (p.enabled ? '' : ' · off');
      const actions = row.querySelector('.prog-mgr-actions');

      const up = document.createElement('button');
      up.type = 'button'; up.className = 'btn-secondary'; up.textContent = '↑';
      up.disabled = idx === 0;
      up.onclick = function () { moveProgram(p.id, -1); };

      const down = document.createElement('button');
      down.type = 'button'; down.className = 'btn-secondary'; down.textContent = '↓';
      down.disabled = idx === programs.length - 1;
      down.onclick = function () { moveProgram(p.id, 1); };

      const tog = document.createElement('button');
      tog.type = 'button'; tog.className = 'btn-secondary';
      tog.textContent = p.enabled ? 'Hide' : 'Show';
      tog.disabled = (p.id === 'chat');
      if (tog.disabled) tog.title = 'Default programs stay enabled';
      tog.onclick = function () {
        R.enable(p.id, !p.enabled);
        renderChips();
        renderManagerList();
        if (typeof SG._programsRelayout === 'function') SG._programsRelayout();
      };

      actions.appendChild(up);
      actions.appendChild(down);
      actions.appendChild(tog);

      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = 'btn-secondary';
      const pinned = typeof R.isPinned === 'function' && R.isPinned(p.id);
      pinBtn.textContent = pinned ? 'Unpin' : 'Pin';
      pinBtn.disabled = (p.id === 'chat') && pinned;
      pinBtn.title = (p.id === 'chat') ? 'Chat stays pinned' : (pinned ? 'Remove from navbar' : 'Add to navbar');
      pinBtn.onclick = function () {
        if (typeof R.isPinned === 'function' && R.isPinned(p.id)) R.unpin(p.id);
        else if (typeof R.pin === 'function') R.pin(p.id);
        renderChips();
        renderManagerList();
        if (typeof SG._programsRelayout === 'function') SG._programsRelayout();
      };
      actions.appendChild(pinBtn);

      if (!p.core) {
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'btn-secondary danger-text';
        del.textContent = 'Remove';
        del.onclick = function () {
          if (!confirm('Remove program "' + p.title + '"?')) return;
          R.unregister(p.id);
          renderChips();
          renderManagerList();
          if (typeof SG._programsRelayout === 'function') SG._programsRelayout();
        };
        actions.appendChild(del);
      }
      list.appendChild(row);
    });
  }

  function moveProgram(id, delta) {
    const R = ensureRegistry();
    if (!R) return;
    const ids = R.list().map(function (p) { return p.id; });
    const i = ids.indexOf(id);
    if (i < 0) return;
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    const t = ids[i]; ids[i] = ids[j]; ids[j] = t;
    R.setOrder(ids);
    renderChips();
    renderManagerList();
    if (typeof SG._programsRelayout === 'function') SG._programsRelayout();
  }

  function createCustomFromForm() {
    const R = ensureRegistry();
    if (!R) return;
    const idEl = $('prog-new-id');
    const titleEl = $('prog-new-title');
    const contentEl = $('prog-new-content');
    const id = (idEl && idEl.value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const title = (titleEl && titleEl.value || '').trim() || id;
    const content = (contentEl && contentEl.value || '').trim();
    if (!id) { toast('Program id required'); return; }
    if (R.get(id) && R.get(id).core) { toast('Cannot overwrite core program'); return; }
    R.saveCustom({
      id: id,
      title: title,
      kind: 'custom',
      view: id,
      content: content || '<p class="muted">Custom program: ' + title + '</p>',
      description: 'User program',
      icon: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 12h6M12 9v6"/>',
      order: 200
    });
    if (idEl) idEl.value = '';
    if (titleEl) titleEl.value = '';
    if (contentEl) contentEl.value = '';
    renderChips();
    renderManagerList();
    if (typeof SG._programsRelayout === 'function') SG._programsRelayout();
    toast('Program added: ' + title);
  }

  async function scanAndRefresh(filesMap, opts) {
    const R = ensureRegistry();
    if (!R) return [];
    if (typeof R.clearLoadedSources === 'function' && opts && opts.force !== false) {
      R.clearLoadedSources();
    }
    const loaded = await R.scanWorkspace(filesMap || {}, opts || { force: true });
    renderChips();
    renderManagerList();
    if (typeof SG._programsRelayout === 'function') SG._programsRelayout();
    return loaded;
  }

  function seedTemplates(filesMap) {
    if (!filesMap || typeof filesMap !== 'object') return [];
    var seeded = [];
    if (!filesMap['programs/test.js']) {
      filesMap['programs/test.js'] =
        "/* Seeded test — edit in Files */\n" +
        "(function (SG) {\n" +
        "  if (!SG.programsRegistry) return;\n" +
        "  SG.programsRegistry.register({\n" +
        "    id: 'test', title: 'Test', kind: 'custom', order: 180, core: false,\n" +
        "    source: 'workspace', version: '1.3.7',\n" +
        "    icon: '<rect x=\"5\" y=\"5\" width=\"14\" height=\"14\" rx=\"2\"/><path d=\"M9 12h6M12 9v6\"/>',\n" +
        "    content: '<h2>Test</h2><p class=\"muted\">Workspace program. Edit programs/test.js</p>'\n" +
        "  });\n" +
        "})(window.SG = window.SG || {});\n";
      seeded.push('programs/test.js');
    }
    return seeded;
  }

  async function runScan(filesMap) {
    var map = filesMap || {};
    var seeded = seedTemplates(map);
    var before = ensureRegistry() ? ensureRegistry().list().map(function (p) { return p.id; }) : [];
    var loaded = await scanAndRefresh(map, { force: true });
    var after = ensureRegistry() ? ensureRegistry().list() : [];
    var custom = after.filter(function (p) { return !p.core; });

    if (typeof SG._programsOnFilesChange === 'function' && seeded.length) {
      seeded.forEach(function (p) {
        try { SG._programsOnFilesChange(p); } catch (_) {}
      });
    }

    var msg;
    if (loaded.length) {
      msg = 'Scanned ' + loaded.length + ' file(s): ' + loaded.join(', ');
    } else if (seeded.length) {
      msg = 'Seeded ' + seeded.join(', ') + ' into workspace — open Files to edit';
    } else {
      var jsCount = Object.keys(map).filter(function (k) {
        return /\.js$/i.test(k);
      }).length;
      msg = 'No new program scripts found (' + jsCount + ' .js in workspace). Put files in programs/*.js then Scan.';
    }
    if (custom.length) msg += ' · ' + custom.length + ' custom chip(s)';
    toast(msg);
    return loaded;
  }

  function onScanClick(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    toast('Scanning…');
    var run = function () {
      if (typeof SG._programsScanFiles === 'function') return SG._programsScanFiles();
      return runScan({});
    };
    try {
      var p = run();
      if (p && typeof p.then === 'function') {
        p.catch(function (err) {
          toast('Scan failed: ' + (err && err.message ? err.message : err));
        });
      }
    } catch (err) {
      toast('Scan failed: ' + (err && err.message ? err.message : err));
    }
  }

  function bindManagerButtons() {
    var add = $('chip-add');
    if (add) {
      add.onclick = function (e) {
        if (e) e.preventDefault();
        openManager();
      };
    }
    var close = $('btn-close-programs');
    if (close) {
      close.onclick = function () {
        var d = $('programs-dialog');
        if (d) d.close();
      };
    }
    var create = $('btn-prog-create');
    if (create) {
      create.onclick = function (e) {
        if (e) e.preventDefault();
        createCustomFromForm();
      };
    }
    var refresh = $('btn-prog-scan');
    if (refresh) {
      refresh.onclick = onScanClick;
      // Also bind touchend for stubborn mobile WebViews
      refresh.ontouchend = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        onScanClick(e);
      };
    }
  }

  function boot() {
    var R = ensureRegistry();
    if (!R) return;
    R.restoreCustoms();
    renderChips();
    bindManagerButtons();
  }

  SG.programs = {
    version: VERSION,
    renderChips: renderChips,
    activate: activateProgram,
    openManager: openManager,
    scanAndRefresh: scanAndRefresh,
    runScan: runScan,
    seedTemplates: seedTemplates,
    boot: boot,
    bindManagerButtons: bindManagerButtons,
    list: function () {
      var R = ensureRegistry();
      return R ? R.list() : [];
    }
  };
})(window.SG = window.SG || {});
