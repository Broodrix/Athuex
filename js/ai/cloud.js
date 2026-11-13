/* Athuex cloud (NVIDIA via CORS proxy) helpers — v1.0.3 */
(function (SG) {
  'use strict';

  function buildProxyUrl(workerUrl, targetUrl) {
    return String(workerUrl || '').replace(/\/+$/, '') + '?url=' + encodeURIComponent(targetUrl);
  }

  function authHeaders(apiKey, proxyKey, extra) {
    const h = Object.assign({
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    }, extra || {});
    if (proxyKey) h['X-Proxy-Key'] = proxyKey;
    return h;
  }

  /**
   * Prefer non-stream when tools are attached — NVIDIA integrate stream+tools
   * has been observed to return intermittent 404s (Nemotron 3.5).
   */
  function shouldStream(settings, hasTools) {
    if (settings && settings.stream === false) return false;
    if (hasTools) return false;
    return true;
  }

  SG.cloudAI = {
    buildProxyUrl: buildProxyUrl,
    authHeaders: authHeaders,
    shouldStream: shouldStream,
    API_URL: 'https://integrate.api.nvidia.com/v1/chat/completions',
    MODELS_URL: 'https://integrate.api.nvidia.com/v1/models'
  };
})(window.SG = window.SG || {});
