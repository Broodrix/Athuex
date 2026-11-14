// Athuex CORS proxy v2.0.0 — NVIDIA-first, streaming-safe
// Env: ALLOWED_ORIGINS, ALLOWED_HOSTS, PROXY_KEY (optional)
const FORWARD = [
  'content-type', 'accept', 'authorization',
  'mcp-session-id', 'mcp-protocol-version', 'last-event-id',
  'x-proxy-key', 'user-agent'
];
const MAX_REDIRECTS = 5;
const UPSTREAM_TIMEOUT_MS = 120000;

function hostMatches(host, pattern) {
  host = host.toLowerCase();
  pattern = pattern.toLowerCase();
  if (pattern.startsWith('*.')) {
    const suf = pattern.slice(1);
    return host === pattern.slice(2) || host.endsWith(suf);
  }
  return host === pattern;
}

function isHostAllowed(host, extra) {
  host = host.toLowerCase();
  if (host === 'api.nvidia.com' || host.endsWith('.api.nvidia.com')) return true;
  if (host === 'integrate.api.nvidia.com') return true;
  if (host === 'api.nvcf.nvidia.com') return true;
  if (host === 'api.github.com') return true;
  if (host === 'mcp.supabase.com' || host === 'mcp.cloudflare.com' ||
      host === 'containers.mcp.cloudflare.com') return true;
  if (host.endsWith('.workers.dev') || host.endsWith('.supabase.co') ||
      host.endsWith('.supabase.com')) return true;
  const searchHosts = [
    'html.duckduckgo.com', 'lite.duckduckgo.com', 'duckduckgo.com', 'api.duckduckgo.com',
    'en.wikipedia.org', 'wikipedia.org', 'www.wikipedia.org',
    'google.serper.dev', 'api.search.brave.com',
    'api.bing.microsoft.com', 'www.googleapis.com', 'api.tavily.com'
  ];
  if (searchHosts.indexOf(host) >= 0) return true;
  if (host.endsWith('.wikipedia.org') || host.endsWith('.duckduckgo.com')) return true;
  for (const p of extra) if (hostMatches(host, p)) return true;
  return false;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String((env && env.ALLOWED_ORIGINS) || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  let allowOrigin = '*';
  if (allowed.length) {
    allowOrigin = allowed.includes(origin) ? origin : 'null';
  } else if (origin && origin !== 'null') {
    allowOrigin = origin;
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID, X-Proxy-Key',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function makeTimeoutSignal(request) {
  if (typeof AbortSignal.timeout !== 'function') return undefined;
  const t = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  if (request.signal && typeof AbortSignal.any === 'function') {
    try { return AbortSignal.any([request.signal, t]); } catch { return t; }
  }
  return t;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const json = (obj, status) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (env && env.PROXY_KEY) {
      const key = request.headers.get('x-proxy-key');
      if (key !== env.PROXY_KEY) return json({ error: 'Unauthorized' }, 401);
    }

    const target = new URL(request.url).searchParams.get('url');
    if (!target) {
      return json({
        ok: true, name: 'Athuex proxy', version: '2.0.0',
        supported: ['integrate.api.nvidia.com', 'api.nvcf.nvidia.com'],
        endpoint: '/?url=https://integrate.api.nvidia.com/v1/chat/completions'
      }, 200);
    }

    let t;
    try { t = new URL(target); } catch { return json({ error: 'Invalid URL' }, 400); }
    if (t.protocol !== 'https:') return json({ error: 'Only https allowed' }, 403);

    const extra = String((env && env.ALLOWED_HOSTS) || '')
      .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

    if (!isHostAllowed(t.hostname, extra)) {
      return json({ error: 'Host not allowed: ' + t.hostname, code: 'HOST_BLOCKED' }, 403);
    }

    try {
      const headers = new Headers();
      for (const k of FORWARD) {
        if (k === 'x-proxy-key') continue;
        const v = request.headers.get(k);
        if (v) headers.set(k, v);
      }
      if (!headers.has('Accept')) headers.set('Accept', 'application/json, text/event-stream');

      let bodyBuf = null;
      if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'DELETE') {
        bodyBuf = await request.arrayBuffer();
      }

      const signal = makeTimeoutSignal(request);
      const makeInit = (method, withBody) => {
        const init = { method, headers, redirect: 'manual', signal };
        if (withBody && bodyBuf) init.body = bodyBuf.slice(0);
        return init;
      };

      let currentUrl = target;
      let res = await fetch(currentUrl, makeInit(request.method, true));
      let redirects = 0;

      while (res.status >= 300 && res.status < 400 && redirects < MAX_REDIRECTS) {
        const loc = res.headers.get('location');
        if (!loc) break;
        let next;
        try { next = new URL(loc, currentUrl); } catch { break; }
        if (next.protocol !== 'https:' || !isHostAllowed(next.hostname, extra)) {
          return json({ error: 'Redirect blocked', code: 'REDIRECT_BLOCKED' }, 403);
        }
        const keepBody = res.status === 307 || res.status === 308;
        currentUrl = next.href;
        res = await fetch(currentUrl, makeInit(keepBody ? request.method : 'GET', keepBody));
        redirects++;
      }

      if (res.status >= 300 && res.status < 400) {
        return json({ error: 'Too many redirects' }, 502);
      }

      const out = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) out.set(k, v);

      // Do NOT touch content-encoding or content-length.
      // The body is unchanged; Workers passes compressed bytes through correctly[reference:2].
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: out
      });
    } catch (e) {
      return json({ error: String((e && e.message) || e), code: 'UPSTREAM' }, 502);
    }
  }
};