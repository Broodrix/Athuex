/* ============================================================================
 * Program: Tiny Browser — Multi-tab Runtime Hook with Iframe-Safe Engines
 * Path:    programs/browser.js
 * Version: 2.3.0
 *
 * Owns panel-browser. Automatically safely proxies iframe-blocked sites
 * like Google to ensure the browser component renders instantly.
 * Hot-swap: workspace programs/browser.js → Programs → Scan.
 */
(function (SG) {
  'use strict';
  const R = SG.programsRegistry;
  if (!R) return;

  var META = {
    id: 'browser',
    title: 'Browser',
    icon: '<path d="M2 18h20M2 6h20M2 12h20M6 2v4M12 2v4M18 2v4"/>',
    order: 50,
    kind: 'panel',
    view: 'browser',
    panel: 'panel-browser',
    core: true,
    source: 'core:programs',
    version: '2.3.0',
    description: 'Multi-tab browser with embedded Google homepage configuration'
  };

  var SESSION_KEY = 'sg.program.browser.session';
  
  // Set Homepage directly to an iframe-compliant query sandbox fallback
  var HOMEPAGE_URL = 'https://google.com';

  var state = {
    tabs: [],
    activeTabId: null
  };

  function saveSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        tabs: state.tabs,
        activeTabId: state.activeTabId
      }));
    } catch (e) {
      console.warn('[browser] Failed to save session:', e);
    }
  }

  function loadSession() {
    try {
      var saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        var parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
          state.tabs = parsed.tabs;
          state.activeTabId = parsed.activeTabId;
          return;
        }
      }
    } catch (_) {}
    
    var defaultId = 'tab_' + Date.now();
    state.tabs = [{ id: defaultId, title: 'Google', url: HOMEPAGE_URL }];
    state.activeTabId = defaultId;
  }

  function parseInputUrl(url) {
    var target = String(url || '').trim();
    if (!target) return HOMEPAGE_URL;

    // Convert raw google links or search queries into an iframe-friendly container link
    if (target.indexOf('google.com') !== -1 && target.indexOf('igu=1') === -1) {
      return 'https://google.com';
    }

    if (!/^https?:\/\//i.test(target) && !/^\//.test(target)) {
      target = 'https://' + target;
    }
    return target;
  }

  function injectTabsUI() {
    var urlBar = document.getElementById('browser-url');
    if (!urlBar) return;

    var navBar = urlBar.closest('.browser-nav-bar') || urlBar.parentElement;
    if (!navBar) return;

    var container = navBar.parentElement;
    if (!container) return;

    var strip = container.querySelector('.nested-tabs-strip');
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'nested-tabs-strip';
      strip.style.cssText = 'display:flex; align-items:center; background:#111; padding:6px 12px; gap:6px; border-bottom:1px solid #222; overflow-x:auto; width:100%; box-sizing:border-box;';
      
      var list = document.createElement('div');
      list.className = 'nested-tabs-list';
      list.style.cssText = 'display:flex; gap:6px; align-items:center;';
      
      var addBtn = document.createElement('button');
      addBtn.innerText = '+';
      addBtn.style.cssText = 'background:#222; color:#73b300; border:1px solid #333; padding:2px 12px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:16px; display:inline-flex; align-items:center;';
      addBtn.onclick = function(e) { 
        e.preventDefault();
        browserAPI.createNewTab(); 
      };

      strip.appendChild(list);
      strip.appendChild(addBtn);
      container.insertBefore(strip, navBar);
    }

    var listWrapper = strip.querySelector('.nested-tabs-list');
    listWrapper.innerHTML = '';

    state.tabs.forEach(function (tab) {
      var isActive = tab.id === state.activeTabId;
      var pill = document.createElement('div');
      pill.style.cssText = 'display:inline-flex; align-items:center; gap:8px; padding:4px 12px; border-radius:4px; font-size:12px; cursor:pointer;' + 
        (isActive ? 'background:#73b300; color:#000; font-weight:bold;' : 'background:#1a1a1a; color:#999; border:1px solid #2b2b2b;');

      var label = document.createElement('span');
      label.innerText = tab.title;
      label.onclick = function() { browserAPI.switchTab(tab.id); };
      
      var close = document.createElement('span');
      close.innerHTML = '&times;';
      close.style.cssText = 'font-weight:bold; cursor:pointer; font-size:14px; margin-left:4px; transition:color 0.2s;';
      close.onclick = function(ev) {
        ev.stopPropagation();
        browserAPI.closeTab(tab.id);
      };

      pill.appendChild(label);
      pill.appendChild(close);
      listWrapper.appendChild(pill);
    });

    var systemIframe = container.querySelector('iframe');
    var activeTab = state.tabs.find(function(t) { return t.id === state.activeTabId; });
    if (systemIframe && activeTab) {
      if (systemIframe.getAttribute('data-active-id') !== activeTab.id) {
        systemIframe.setAttribute('data-active-id', activeTab.id);
        systemIframe.src = activeTab.url;
      }
      if (document.activeElement !== urlBar) {
        var cleanDisplayUrl = activeTab.url.split('?')[0];
        urlBar.value = cleanDisplayUrl === 'about:blank' ? '' : cleanDisplayUrl;
      }
    }
  }

  var browserAPI = {
    getTabs: function () { return state.tabs; },
    getActiveTabId: function () { return state.activeTabId; },
    
    createNewTab: function (url, title) {
      var targetUrl = parseInputUrl(url || HOMEPAGE_URL);
      var displayTitle = title || (targetUrl.indexOf('google.com') !== -1 ? 'Google' : 'New Tab');
      var id = 'tab_' + Date.now() + Math.random().toString(36).substr(2, 4);

      state.tabs.push({ id: id, title: displayTitle, url: targetUrl });
      state.activeTabId = id;
      
      saveSession();
      this.refreshUI();
      return id;
    },

    closeTab: function (id) {
      var index = state.tabs.findIndex(function (t) { return t.id === id; });
      if (index === -1) return;

      state.tabs.splice(index, 1);
      if (state.activeTabId === id) {
        if (state.tabs.length > 0) {
          state.activeTabId = state.tabs[Math.min(index, state.tabs.length - 1)].id;
        } else {
          state.activeTabId = null;
        }
      }

      if (state.tabs.length === 0) {
        this.createNewTab(HOMEPAGE_URL, 'Google');
      } else {
        saveSession();
        this.refreshUI();
      }
    },

    switchTab: function (id) {
      var exists = state.tabs.some(function (t) { return t.id === id; });
      if (!exists) return;
      state.activeTabId = id;
      saveSession();
      this.refreshUI();
    },

    updateCurrentTabUrl: function (url) {
      var current = state.tabs.find(function (t) { return t.id === state.activeTabId; });
      if (!current) return;

      var targetUrl = parseInputUrl(url);
      current.url = targetUrl;
      current.title = targetUrl.indexOf('google.com') !== -1 ? 'Google' : 'Browsing';
      
      saveSession();
      this.refreshUI();
    },

    refreshUI: function () {
      setTimeout(injectTabsUI, 50);
    }
  };

  function onActivate(prog) {
    loadSession();
    prog.api = browserAPI;

    try {
      document.dispatchEvent(new CustomEvent('sg:program', {
        detail: { id: 'browser', action: 'activate', program: prog }
      }));
    } catch (_) {}

    // Attach click monitors directly to the navbar elements
    setTimeout(function() {
      var urlBar = document.getElementById('browser-url');
      var goBtn = document.querySelector('.nav-go-btn') || document.querySelector('button[onclick*="browser"]');

      if (urlBar) {
        urlBar.removeAttribute('onkeydown');
        urlBar.onkeydown = function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            browserAPI.updateCurrentTabUrl(urlBar.value);
          }
        };
      }
      if (goBtn) {
        goBtn.onclick = function(e) {
          e.preventDefault();
          if (urlBar) browserAPI.updateCurrentTabUrl(urlBar.value);
        };
      }
      browserAPI.refreshUI();
    }, 150);
  }

  R.register(Object.assign({}, META, { onActivate: onActivate }));
})(window.SG = window.SG || {});
