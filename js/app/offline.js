/* Athuex offline / connectivity helper — P6 v2.5.8 */
(function (SG) {
  'use strict';
  const VERSION = '2.5.8';
  let lastOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  let lastServerOk = false;

  function isBrowserOnline() {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }

  function serverOk() {
    try {
      if (SG.llamaServer && typeof SG.llamaServer.isReady === 'function') {
        return !!SG.llamaServer.isReady();
      }
      if (SG.llamaServer && typeof SG.llamaServer.getLastHealth === 'function') {
        const h = SG.llamaServer.getLastHealth();
        return !!(h && h.ok);
      }
    } catch (_) {}
    return false;
  }

  function ggufOk() {
    try {
      if (SG.localAI && typeof SG.localAI.isReady === 'function') return !!SG.localAI.isReady();
      if (SG.localAI && typeof SG.localAI.getStatus === 'function') {
        return !!(SG.localAI.getStatus().hasGgufRuntime);
      }
    } catch (_) {}
    return false;
  }

  /** True if any local path can answer without NVIDIA */
  function localCapable() {
    return serverOk() || ggufOk();
  }

  function updateBar() {
    const bar = document.getElementById('offline-bar');
    if (!bar) return;
    const online = isBrowserOnline();
    const local = localCapable();
    lastOnline = online;
    lastServerOk = serverOk();
    if (online && lastServerOk) {
      bar.classList.add('hidden');
      bar.classList.remove('server-ok');
      return;
    }
    if (!online && local) {
      bar.textContent = lastServerOk
        ? 'Browser offline — using Termux llama-server'
        : 'Browser offline — using local GGUF';
      bar.classList.remove('hidden');
      bar.classList.add('server-ok');
      return;
    }
    if (!online && !local) {
      bar.textContent = 'Offline — start Termux llama-server (:8080) or load a Q4_K_M GGUF';
      bar.classList.remove('hidden');
      bar.classList.remove('server-ok');
      return;
    }
    // online but no local — hide (cloud can work)
    if (online && !local) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.add('hidden');
  }

  function bind() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', updateBar);
    window.addEventListener('offline', updateBar);
    document.addEventListener('athuex:harness-health', updateBar);
    document.addEventListener('athuex:local-status', updateBar);
    updateBar();
    setInterval(updateBar, 12000);
  }

  SG.appOffline = {
    version: VERSION,
    isBrowserOnline: isBrowserOnline,
    serverOk: serverOk,
    ggufOk: ggufOk,
    localCapable: localCapable,
    updateBar: updateBar,
    bind: bind
  };
})(window.SG = window.SG || {});
