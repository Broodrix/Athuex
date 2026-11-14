/* MCP client tools — dual-era (legacy + 2026-07-28) — Athuex v1.0.0 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;

  let rpcId = 1;
  let negotiatedVersion = '2025-03-26';

  function getSettings() {
    if (window.SG && SG.settings && typeof SG.settings.load === 'function') return SG.settings.load();
    const keys = [
      'athuex.settings',
      'sg.settings_v137', 'sg.settings_v136', 'sg.settings_v135', 'sg.settings_v134',
      'sg.settings_v133', 'sg.settings_v132', 'sg.settings_v130', 'sg.settings_v129',
      'sg.settings_v128', 'sg.settings_v127', 'sg.settings_v126', 'sg.settings_v125'
    ];
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (raw) return JSON.parse(raw) || {};
      } catch (_) {}
    }
    return {};
  }

  function resolveMcpUrl() {
    const u = (getSettings().mcpUrl || '').trim();
    return (u || '').replace(/\/+$/, '');
  }

  function resolveProxy() {
    const s = getSettings();
    return {
      proxyUrl: (s.workerUrl || '').trim().replace(/\/+$/, ''),
      proxyKey: (s.proxyKey || '').trim()
    };
  }

  async function mcpFetch(pathOrEmpty, body, extraHeaders) {
    const base = resolveMcpUrl();
    if (!base) throw new Error('MCP URL not configured (Settings → MCP)');
    const target = base + (pathOrEmpty || '/mcp');
    const { proxyUrl, proxyKey } = resolveProxy();
    const viaProxy = getSettings().mcpViaProxy === true;
    const headers = Object.assign({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': negotiatedVersion
    }, extraHeaders || {});

    async function doFetch(url, extra) {
      const h = Object.assign({}, headers, extra || {});
      const init = { method: body ? 'POST' : 'GET', headers: h };
      if (body) init.body = JSON.stringify(body);
      const res = await fetch(url, init);
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
      return { ok: res.ok, status: res.status, data: data, text: text };
    }

    if (viaProxy && proxyUrl) {
      const proxied = proxyUrl + '?url=' + encodeURIComponent(target);
      const extra = {};
      if (proxyKey) extra['X-Proxy-Key'] = proxyKey;
      return doFetch(proxied, extra);
    }
    return doFetch(target);
  }

  async function initialize() {
    const body = {
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'Athuex', version: (window.ATHUEX_VERSION || '1.0.0') }
      }
    };
    const r = await mcpFetch('', body);
    if (r.data && r.data.result && r.data.result.protocolVersion) {
      negotiatedVersion = r.data.result.protocolVersion;
    }
    return r;
  }

  R.register({
    name: 'mcp_list_tools',
    description: 'List tools available on the configured MCP server.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async function () {
      await initialize();
      const r = await mcpFetch('', {
        jsonrpc: '2.0', id: rpcId++, method: 'tools/list', params: {}
      });
      if (!r.ok) return { error: 'MCP list failed: ' + r.status, detail: r.data };
      return r.data && r.data.result ? r.data.result : r.data;
    }
  });

  R.register({
    name: 'mcp_call_tool',
    description: 'Call a tool on the configured MCP server by name with arguments.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'MCP tool name' },
        arguments: { type: 'object', description: 'Tool arguments object' }
      },
      required: ['name']
    },
    handler: async function (args) {
      await initialize();
      const r = await mcpFetch('', {
        jsonrpc: '2.0',
        id: rpcId++,
        method: 'tools/call',
        params: { name: args.name, arguments: args.arguments || {} }
      });
      if (!r.ok) return { error: 'MCP call failed: ' + r.status, detail: r.data };
      return r.data && r.data.result ? r.data.result : r.data;
    }
  });
})(window.SG = window.SG || {});
