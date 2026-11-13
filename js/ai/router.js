/* Athuex AI router — llama-server | wllama GGUF | NVIDIA. P2 v2.5.3 */
(function (SG) {
  'use strict';

  function isOnline() {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }

  function modeFromSettings(s) {
    s = s || {};
    const m = String(s.aiMode || s.route || 'auto').toLowerCase();
    if (m === 'local' || m === 'int' || m === 'internal') return 'local';
    if (m === 'cloud' || m === 'ext' || m === 'external' || m === 'nvidia') return 'cloud';
    if (m === 'auto' || m === 'hyb' || m === 'hybrid') return 'auto';
    return 'auto';
  }

  function ggufReady() {
    try {
      if (SG.localAI && typeof SG.localAI.isReady === 'function') return !!SG.localAI.isReady();
      if (SG.localAI && typeof SG.localAI.getStatus === 'function') {
        return !!(SG.localAI.getStatus().hasGgufRuntime);
      }
    } catch (_) {}
    return false;
  }

  function llamaServerReady(settings) {
    try {
      if (SG.llamaServer && typeof SG.llamaServer.isReady === 'function') {
        return !!SG.llamaServer.isReady(settings);
      }
    } catch (_) {}
    return false;
  }

  function localReady(settings) {
    return llamaServerReady(settings) || ggufReady();
  }

  function prefersLocal(userText) {
    const t = String(userText || '').toLowerCase();
    if (t.length > 400) return false;
    if (/write|implement|refactor|debug|generate|full app|html|css|javascript|python|tool|search|news/.test(t)) return false;
    if (/\b(image|picture|photo|draw|show me a|show me an)\b/.test(t)) return false;
    if (t.length < 80) return true;
    return false;
  }

  function decide(userText, settings) {
    const mode = modeFromSettings(settings);
    const online = isOnline();
    const serverOk = llamaServerReady(settings);
    const ggufOk = ggufReady();
    const ready = serverOk || ggufOk;
    const localBackend = serverOk ? 'llama-server' : (ggufOk ? 'wllama' : 'none');

    if (mode === 'local') {
      if (!ready) return { route: 'none', reason: 'gguf-not-loaded', localBackend: 'none' };
      return { route: 'local', reason: serverOk ? 'settings:local-llama-server' : 'settings:local-gguf', localBackend: localBackend };
    }

    if (mode === 'cloud') {
      if (!online) {
        if (ready) return { route: 'local', reason: 'nvidia-offline-local', localBackend: localBackend };
        return { route: 'none', reason: 'nvidia-offline', localBackend: 'none' };
      }
      return { route: 'cloud', reason: 'settings:cloud', localBackend: localBackend };
    }

    if (ready && (prefersLocal(userText) || !online)) {
      return {
        route: 'local',
        reason: online
          ? (serverOk ? 'hybrid-light-llama-server' : 'hybrid-light-gguf')
          : (serverOk ? 'hybrid-offline-llama-server' : 'hybrid-offline-gguf'),
        localBackend: localBackend
      };
    }
    if (online) return { route: 'cloud', reason: ready ? 'hybrid-heavy' : 'hybrid-nvidia', localBackend: localBackend };
    return { route: 'none', reason: 'no-backend', localBackend: 'none' };
  }

  SG.aiRouter = {
    isOnline: isOnline,
    decide: decide,
    modeFromSettings: modeFromSettings,
    localReady: localReady,
    ggufReady: ggufReady,
    llamaServerReady: llamaServerReady
  };
})(window.SG = window.SG || {});
