// Athuex sample MCP server v2.0.0 — dual-era (2026-07-28 modern + legacy), NVIDIA-first
const SERVER_INFO = { name: 'athuex-sample-mcp', version: '2.0.0' };
const MODERN_VERSION = '2026-07-28';
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const SUPPORTED = [MODERN_VERSION, ...LEGACY_VERSIONS];

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back a message.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_time',
    description: 'Returns the current UTC date and time as an ISO-8601 string. Takes no arguments.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'remember',
    description: 'Store a string value under a key in the KV binding.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' }, value: { type: 'string' } },
      required: ['key', 'value'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'recall',
    description: 'Recall the value stored under a key.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'list_keys',
    description: 'List all stored keys.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'nvidia_api',
    description: 'Call any NVIDIA NIM endpoint through the secure proxy. Examples: GET /v1/models; POST /v1/chat/completions; POST /v1/embeddings.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path beginning with /v1, e.g. /v1/models or /v1/chat/completions.' },
        method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method. Default GET.' },
        body: { type: 'object', description: 'JSON request body for POST.' },
        apiKey: { type: 'string', description: 'Optional NVIDIA API key. Falls back to NVIDIA_API_KEY env.' }
      },
      required: ['path'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  }
];

function jsonRpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}
function textContent(text) { return { content: [{ type: 'text', text: String(text) }] }; }

async function handleTool(name, args, env) {
  args = args || {};
  switch (name) {
    case 'echo': return textContent(String(args.message ?? ''));
    case 'get_time': return textContent(new Date().toISOString());

    case 'remember': {
      if (!env || !env.MCP_MEMORY) {
        return { isError: true, ...textContent('MCP_MEMORY KV binding is required') };
      }
      const k = String(args.key || '').slice(0, 128);
      const v = String(args.value || '').slice(0, 4000);
      if (!k) return { isError: true, ...textContent('key required') };
      await env.MCP_MEMORY.put(k, v);
      return textContent('Stored "' + k + '"');
    }

    case 'recall': {
      if (!env || !env.MCP_MEMORY) {
        return { isError: true, ...textContent('MCP_MEMORY KV binding is required') };
      }
      const k = String(args.key || '');
      if (!k) return { isError: true, ...textContent('key required') };
      const val = await env.MCP_MEMORY.get(k);
      return textContent(val === null ? 'No value for "' + k + '"' : val);
    }

    case 'list_keys': {
      if (!env || !env.MCP_MEMORY) {
        return { isError: true, ...textContent('MCP_MEMORY KV binding is required') };
      }
      const list = await env.MCP_MEMORY.list();
      const keys = list.keys.map((e) => e.name);
      return textContent(keys.length ? keys.join('\n') : 'No keys.');
    }

    case 'nvidia_api': {
      if (!env || !env.PROXY_URL) {
        return { isError: true, ...textContent('PROXY_URL is not configured') };
      }
      const path = String(args.path || '/v1/models');
      const method = String(args.method || 'GET').toUpperCase();
      const target = 'https://integrate.api.nvidia.com' + (path.startsWith('/') ? path : '/' + path);
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      };
      const key = args.apiKey || env.NVIDIA_API_KEY;
      if (key) headers['Authorization'] = 'Bearer ' + key;
      if (env.PROXY_KEY) headers['x-proxy-key'] = env.PROXY_KEY;

      const init = { method, headers, signal: AbortSignal.timeout(120000) };
      if (args.body && method !== 'GET' && method !== 'HEAD') {
        init.body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
      }

      const res = await fetch(String(env.PROXY_URL) + encodeURIComponent(target), init);
      const text = await res.text();
      return textContent(text);
    }

    default: return { isError: true, ...textContent('Unknown tool: ' + name) };
  }
}

const NOTIFS = new Set(['notifications/initialized', 'notifications/cancelled', 'notifications/progress']);

function resolveEra(request, msg) {
  const header = request.headers.get('MCP-Protocol-Version');
  if (header === MODERN_VERSION) return 'modern';
  if (header && LEGACY_VERSIONS.includes(header)) return 'legacy';
  if (msg && msg._meta && msg._meta['io.modelcontextprotocol/protocolVersion'] === MODERN_VERSION) return 'modern';
  return 'legacy';
}

async function dispatch(msg, env, era) {
  const id = msg.id, method = msg.method, params = msg.params || {};

  if (method === 'server/discover') {
    return jsonRpcResult(id, {
      supportedVersions: SUPPORTED,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: 'Use tools/list. The nvidia_api tool calls any NVIDIA NIM endpoint through the secure proxy.'
    });
  }

  if (method === 'initialize') {
    const requested = String(params.protocolVersion || '');
    const version = LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];
    return jsonRpcResult(id, {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO
    });
  }

  if (NOTIFS.has(method)) return null;
  if (method === 'logging/setLevel') return jsonRpcResult(id, {});
  if (method === 'ping') return jsonRpcResult(id, {});

  if (era === 'modern') {
    const meta = params._meta || {};
    const requested = meta['io.modelcontextprotocol/protocolVersion'];
    if (requested && !SUPPORTED.includes(requested)) {
      return jsonRpcError(id, -32000, 'Unsupported protocol version', {
        supported: SUPPORTED, requested
      });
    }
  }

  if (method === 'tools/list') return jsonRpcResult(id, { tools: TOOLS });

  if (method === 'tools/call') {
    try {
      return jsonRpcResult(id, await handleTool(params.name, params.arguments || {}, env));
    } catch (e) {
      return jsonRpcResult(id, { isError: true, content: [{ type: 'text', text: String((e && e.message) || e) }] });
    }
  }

  if (method === 'resources/list') return jsonRpcResult(id, { resources: [] });
  if (method === 'resources/templates/list') return jsonRpcResult(id, { resourceTemplates: [] });
  if (method === 'prompts/list') return jsonRpcResult(id, { prompts: [] });

  return jsonRpcError(id, -32601, 'Method not found: ' + method);
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/mcp') {
      return new Response(JSON.stringify({ error: 'Use /mcp' }), {
        status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    if (request.method === 'GET') {
      return new Response(JSON.stringify({
        name: SERVER_INFO.name,
        version: SERVER_INFO.version,
        protocol: MODERN_VERSION,
        supportedVersions: SUPPORTED,
        endpoint: '/mcp',
        tools: TOOLS.map((t) => t.name),
        storage: env && env.MCP_MEMORY ? 'kv' : 'missing',
        proxy: env && env.PROXY_URL ? 'configured' : 'missing'
      }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    let body;
    try { body = await request.json(); }
    catch {
      return new Response(JSON.stringify(jsonRpcError(null, -32700, 'Parse error')), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const isBatch = Array.isArray(body);
    const messages = isBatch ? body : [body];
    const replies = [];

    for (const msg of messages) {
      if (!msg || msg.jsonrpc !== '2.0') {
        replies.push(jsonRpcError(msg && msg.id, -32600, 'Invalid Request'));
        continue;
      }
      if (!('id' in msg)) continue;

      const era = resolveEra(request, msg);
      const reply = await dispatch(msg, env, era);
      if (reply !== null) replies.push(reply);
    }

    if (replies.length === 0) return new Response(null, { status: 202, headers: { ...cors } });

    const negotiated = request.headers.get('MCP-Protocol-Version') === MODERN_VERSION
      ? MODERN_VERSION
      : LEGACY_VERSIONS[0];

    return new Response(JSON.stringify(isBatch ? replies : replies[0]), {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Mcp-Protocol-Version': negotiated
      }
    });
  }
};