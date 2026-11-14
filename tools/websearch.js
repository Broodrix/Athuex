/* Web search & page reader tools — websearch.js — v1.0.0
 *
 * Drop in workspace as tools/websearch.js (auto-loaded by registry.scanWorkspace)
 * or call SG.toolsRegistry.loadFromSource('core:websearch', src).
 *
 * Providers
 *   keyed    : Google (Serper) · Google CSE · Brave · Bing · Tavily
 *   keyless  : DuckDuckGo (html/lite scrape) · Wikipedia (API)
 *
 * Transport
 *   Every request goes through the Cloudflare CORS proxy (Settings → workerUrl)
 *   when configured (default), else direct fetch. Direct→proxy fallback on CORS.
 *
 * Settings (localStorage athuex.settings — same object mcp.js reads)
 *   workerUrl        : "https://athuex-proxy.<you>.workers.dev"
 *   proxyKey         : optional PROXY_KEY value
 *   searchViaProxy   : true (default) | false
 *   searchProvider   : "auto" | "serper" | "google" | "brave" | "bing" | "tavily" | "duckduckgo" | "wikipedia"
 *   searchKeys       : { serper, google, brave, bing, tavily }
 *   googleCx         : Google Programmable Search engine id (cx)
 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;

  const VERSION = '1.0.0';
  const TIMEOUT_MS = 20000;
  const MAX_PAGE_CHARS = 20000;
  const SETTINGS_KEYS = ['athuex.settings', 'sg.settings_v137', 'sg.settings_v136', 'sg.settings_v135', 'sg.settings_v134', 'sg.settings_v133', 'sg.settings_v132', 'sg.settings_v130', 'sg.settings_v129', 'sg.settings_v128', 'sg.settings_v127', 'sg.settings_v126', 'sg.settings_v125'];

  /* ------------------------------------------------------------------ *
   * settings
   * ------------------------------------------------------------------ */

  function getSettings() {
    if (window.SG && SG.settings && typeof SG.settings.load === 'function') return SG.settings.load();
    for (let i = 0; i < SETTINGS_KEYS.length; i++) {
      try {
        const raw = localStorage.getItem(SETTINGS_KEYS[i]);
        if (raw) return JSON.parse(raw) || {};
      } catch (_) {}
    }
    return {};
  }

  function resolveProxy() {
    const s = getSettings();
    return {
      proxyUrl: String(s.workerUrl || '').trim().replace(/\/+$/, ''),
      proxyKey: String(s.proxyKey || '').trim()
    };
  }

  function resolveKeys() {
    const s = getSettings();
    const k = (s.searchKeys && typeof s.searchKeys === 'object') ? s.searchKeys : {};
    return {
      serper:   String(k.serper || s.serperKey || '').trim(),
      google:   String(k.google || s.googleKey || '').trim(),
      googleCx: String(k.googleCx || s.googleCx || '').trim(),
      brave:    String(k.brave  || s.braveKey  || '').trim(),
      bing:     String(k.bing   || s.bingKey   || '').trim(),
      tavily:   String(k.tavily || s.tavilyKey || '').trim()
    };
  }

  /* ------------------------------------------------------------------ *
   * http — proxy first, direct fallback
   * ------------------------------------------------------------------ */

  async function rawFetch(url, init) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
    try {
      return await fetch(url, ctrl ? Object.assign({}, init || {}, { signal: ctrl.signal }) : (init || {}));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function proxyFetch(target, init) {
    const { proxyUrl, proxyKey } = resolveProxy();
    if (!proxyUrl) throw new Error('no CORS proxy configured');
    const url = proxyUrl + '?url=' + encodeURIComponent(target);
    const headers = Object.assign({}, (init && init.headers) || {});
    if (proxyKey) headers['X-Proxy-Key'] = proxyKey;
    return rawFetch(url, Object.assign({}, init, { headers }));
  }

  /** Returns { text, contentType, via } or throws with both attempts' errors. */
  async function fetchOk(target, init) {
    const { proxyUrl } = resolveProxy();
    const viaProxyFirst = !!proxyUrl && getSettings().searchViaProxy !== false;
    const plan = viaProxyFirst ? [proxyFetch, rawFetch] : [rawFetch, proxyFetch];
    const errs = [];
    for (let i = 0; i < plan.length; i++) {
      const fn = plan[i];
      if (fn === proxyFetch && !proxyUrl) continue;
      const mode = fn === proxyFetch ? 'proxy' : 'direct';
      try {
        const res = await fn(target, init || {});
        const text = await res.text().catch(() => '');
        // 200–299 with body is fine; DDG html sometimes returns 202
        if (!(res.status >= 200 && res.status < 300) || (!text && res.status !== 204)) {
          errs.push(mode + ' HTTP ' + res.status + (text ? ': ' + text.slice(0, 160).replace(/\s+/g, ' ') : ''));
          continue;
        }
        return {
          text,
          contentType: String(res.headers.get('content-type') || '').toLowerCase(),
          via: mode
        };
      } catch (e) {
        errs.push(mode + ' ' + String((e && e.message) || e));
      }
    }
    throw new Error('Search fetch failed. Set Settings → Worker URL (CORS proxy) and redeploy worker with search hosts. Details: ' + errs.join(' | '));
  }

  /* ------------------------------------------------------------------ *
   * text helpers
   * ------------------------------------------------------------------ */

  function stripTags(s) {
    return String(s == null ? '' : s).replace(/<[^>]*>/g, ' ');
  }

  function decodeEntities(s) {
    const str = String(s == null ? '' : s);
    if (typeof DOMParser === 'function') {
      try {
        const d = new DOMParser().parseFromString('<div>' + str + '</div>', 'text/html');
        return d.body ? (d.body.textContent || '') : str;
      } catch (_) {}
    }
    return str
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
  }

  function cleanText(s) {
    return decodeEntities(stripTags(s)).replace(/\s+/g, ' ').trim();
  }

  function truncate(s, max) {
    const str = String(s == null ? '' : s);
    return str.length > max ? str.slice(0, max) + '\n…[truncated at ' + max + ' chars]' : str;
  }

  function withSite(query, opts) {
    return opts && opts.site ? 'site:' + opts.site + ' ' + query : query;
  }

  function htmlToText(html) {
    const src = String(html || '');
    if (typeof DOMParser !== 'function') {
      return { title: '', text: cleanText(src) };
    }
    const doc = new DOMParser().parseFromString(src, 'text/html');
    const titleEl = doc.querySelector('title');
    const title = titleEl ? cleanText(titleEl.textContent) : '';

    doc.querySelectorAll('script,style,noscript,svg,iframe,form,button,head,template').forEach((n) => n.remove());
    doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
    ['p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
     'section', 'article', 'header', 'footer', 'pre', 'blockquote', 'td'].forEach((sel) => {
      doc.querySelectorAll(sel).forEach((n) => { n.appendChild(doc.createTextNode('\n')); });
    });

    const body = doc.body || doc.documentElement;
    let text = body ? (body.textContent || '') : '';
    text = text
      .replace(/\r/g, '')
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { title, text };
  }

  /* ------------------------------------------------------------------ *
   * providers
   * ------------------------------------------------------------------ */

  const PROVIDERS = {
    serper:     { label: 'Google (Serper)', keyed: true },
    google:     { label: 'Google CSE',      keyed: true },
    brave:      { label: 'Brave Search',    keyed: true },
    bing:       { label: 'Bing Web Search', keyed: true },
    tavily:     { label: 'Tavily',          keyed: true },
    duckduckgo: { label: 'DuckDuckGo',      keyed: false },
    wikipedia:  { label: 'Wikipedia',       keyed: false }
  };

  const SERPER_FRESH = { day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' };
  const BRAVE_FRESH  = { day: 'pd', week: 'pw', month: 'pm', year: 'py' };
  const BING_FRESH   = { day: 'Day', week: 'Week', month: 'Month' };
  const GOOGLE_FRESH = { day: 'd1', week: 'w1', month: 'm1', year: 'y1' };
  const DDG_FRESH    = { day: 'd', week: 'w', month: 'm', year: 'y' };

  function parseJson(text, who) {
    try { return JSON.parse(text); }
    catch (_) { throw new Error(who + ' returned non-JSON: ' + String(text || '').slice(0, 120)); }
  }

  async function runSerper(query, o) {
    const keys = resolveKeys();
    if (!keys.serper) throw new Error('missing Serper key (Settings → searchKeys.serper)');
    const body = { q: withSite(query, o), num: o.limit };
    if (SERPER_FRESH[o.freshness]) body.tbs = SERPER_FRESH[o.freshness];
    const r = await fetchOk('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': keys.serper },
      body: JSON.stringify(body)
    });
    const data = parseJson(r.text, 'Serper');
    const results = (data.organic || []).map((x) => ({
      title: cleanText(x.title), url: x.link, snippet: cleanText(x.snippet)
    }));
    let answer = '';
    if (data.answerBox) answer = cleanText(data.answerBox.answer || data.answerBox.snippet || '');
    if (!answer && data.knowledgeGraph) answer = cleanText(data.knowledgeGraph.description || '');
    return { results, answer };
  }

  async function runGoogle(query, o) {
    const keys = resolveKeys();
    if (!keys.google || !keys.googleCx) throw new Error('missing Google key/cx (Settings → searchKeys.google + googleCx)');
    let url = 'https://www.googleapis.com/customsearch/v1?key=' + encodeURIComponent(keys.google) +
      '&cx=' + encodeURIComponent(keys.googleCx) +
      '&q=' + encodeURIComponent(withSite(query, o)) +
      '&num=' + o.limit;
    if (GOOGLE_FRESH[o.freshness]) url += '&dateRestrict=' + GOOGLE_FRESH[o.freshness];
    const r = await fetchOk(url, { headers: { Accept: 'application/json' } });
    const data = parseJson(r.text, 'Google CSE');
    if (data.error) throw new Error('Google CSE: ' + (data.error.message || 'error'));
    const results = (data.items || []).map((x) => ({
      title: cleanText(x.title), url: x.link, snippet: cleanText(x.snippet)
    }));
    return { results, answer: '' };
  }

  async function runBrave(query, o) {
    const keys = resolveKeys();
    if (!keys.brave) throw new Error('missing Brave key (Settings → searchKeys.brave)');
    let url = 'https://api.search.brave.com/res/v1/web/search?q=' +
      encodeURIComponent(withSite(query, o)) + '&count=' + o.limit;
    if (BRAVE_FRESH[o.freshness]) url += '&freshness=' + BRAVE_FRESH[o.freshness];
    const r = await fetchOk(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': keys.brave }
    });
    const data = parseJson(r.text, 'Brave');
    const web = (data.web && data.web.results) || [];
    return {
      results: web.map((x) => ({
        title: cleanText(x.title), url: x.url, snippet: cleanText(x.description)
      })),
      answer: ''
    };
  }

  async function runBing(query, o) {
    const keys = resolveKeys();
    if (!keys.bing) throw new Error('missing Bing key (Settings → searchKeys.bing)');
    let url = 'https://api.bing.microsoft.com/v7.0/search?q=' +
      encodeURIComponent(withSite(query, o)) + '&count=' + o.limit + '&responseFilter=Webpages';
    if (BING_FRESH[o.freshness]) url += '&freshness=' + BING_FRESH[o.freshness];
    const r = await fetchOk(url, {
      headers: { Accept: 'application/json', 'Ocp-Apim-Subscription-Key': keys.bing }
    });
    const data = parseJson(r.text, 'Bing');
    const list = (data.webPages && data.webPages.value) || [];
    return {
      results: list.map((x) => ({
        title: cleanText(x.name), url: x.url, snippet: cleanText(x.snippet)
      })),
      answer: ''
    };
  }

  async function runTavily(query, o) {
    const keys = resolveKeys();
    if (!keys.tavily) throw new Error('missing Tavily key (Settings → searchKeys.tavily)');
    const body = {
      api_key: keys.tavily,
      query: withSite(query, o),
      max_results: o.limit,
      include_answer: true,
      search_depth: 'basic'
    };
    if (o.freshness) body.time_range = o.freshness;
    const r = await fetchOk('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    const data = parseJson(r.text, 'Tavily');
    if (data.detail || data.error) throw new Error('Tavily: ' + (data.detail || data.error));
    return {
      results: (data.results || []).map((x) => ({
        title: cleanText(x.title), url: x.url, snippet: cleanText(x.content)
      })),
      answer: cleanText(data.answer || '')
    };
  }

  function cleanDdgUrl(href) {
    let h = decodeEntities(String(href || ''));
    if (h.startsWith('//')) h = 'https:' + h;
    const m = /[?&]uddg=([^&]+)/.exec(h);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch (_) { return h; }
    }
    return h;
  }

  function parseDdg(html) {
    const out = [];
    const src = String(html || '');

    if (typeof DOMParser === 'function') {
      const doc = new DOMParser().parseFromString(src, 'text/html');

      // html.duckduckgo.com layout
      doc.querySelectorAll('.result').forEach((el) => {
        const a = el.querySelector('a.result__a');
        if (!a) return;
        const sn = el.querySelector('.result__snippet');
        out.push({
          title: cleanText(a.textContent),
          url: cleanDdgUrl(a.getAttribute('href')),
          snippet: sn ? cleanText(sn.textContent) : ''
        });
      });

      // lite.duckduckgo.com layout
      if (!out.length) {
        doc.querySelectorAll('a.result-link').forEach((a) => {
          let snippet = '';
          const tr = a.closest('tr');
          const next = tr && tr.nextElementSibling;
          const td = next && next.querySelector('td.result-snippet');
          if (td) snippet = cleanText(td.textContent);
          out.push({
            title: cleanText(a.textContent),
            url: cleanDdgUrl(a.getAttribute('href')),
            snippet
          });
        });
      }
      return out;
    }

    // no DOM — regex fallback
    const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(src))) {
      out.push({ title: cleanText(m[2]), url: cleanDdgUrl(m[1]), snippet: '' });
    }
    return out;
  }

  async function runDuckDuckGo(query, o) {
    const q = withSite(query, o);
    const endpoints = [
      'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q),
      'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) +
        (DDG_FRESH[o.freshness] ? '&df=' + DDG_FRESH[o.freshness] : '')
    ];
    let lastErr;
    for (let i = 0; i < endpoints.length; i++) {
      try {
        const r = await fetchOk(endpoints[i], {
          headers: { Accept: 'text/html,application/xhtml+xml' }
        });
        const results = parseDdg(r.text);
        if (results.length) return { results: results.slice(0, o.limit), answer: '' };
        lastErr = new Error('DuckDuckGo returned no parsable results (rate-limited or anomaly page)');
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('DuckDuckGo failed');
  }

  async function runWikipedia(query, o) {
    const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*' +
      '&list=search&srlimit=' + o.limit + '&srsearch=' + encodeURIComponent(query);
    const r = await fetchOk(url, { headers: { Accept: 'application/json' } });
    const data = parseJson(r.text, 'Wikipedia');
    const list = (data.query && data.query.search) || [];
    return {
      results: list.map((x) => ({
        title: x.title,
        url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(x.title).replace(/ /g, '_')),
        snippet: cleanText(x.snippet)
      })),
      answer: ''
    };
  }

  const RUNNERS = {
    serper: runSerper,
    google: runGoogle,
    brave: runBrave,
    bing: runBing,
    tavily: runTavily,
    duckduckgo: runDuckDuckGo,
    wikipedia: runWikipedia
  };

  function hasKey(name, keys) {
    if (name === 'google') return !!(keys.google && keys.googleCx);
    return !!keys[name];
  }

  function resolveChain(requested) {
    const want = String(requested || '').toLowerCase().trim();
    if (want && want !== 'auto') {
      return PROVIDERS[want] ? [want] : ['duckduckgo', 'wikipedia'];
    }
    const pref = String(getSettings().searchProvider || 'auto').toLowerCase();
    if (pref !== 'auto' && PROVIDERS[pref]) {
      return [pref].concat(['duckduckgo', 'wikipedia'].filter((n) => n !== pref));
    }
    const keys = resolveKeys();
    const keyed = ['serper', 'google', 'brave', 'bing', 'tavily'].filter((n) => hasKey(n, keys));
    return keyed.concat(['duckduckgo', 'wikipedia']);
  }

  function formatResults(query, provider, results, answer) {
    const label = PROVIDERS[provider] ? PROVIDERS[provider].label : provider;
    const lines = [
      'Search: "' + query + '"  ·  provider: ' + label + '  ·  ' + results.length +
        ' result' + (results.length === 1 ? '' : 's')
    ];
    if (answer) lines.push('', 'Answer: ' + truncate(answer, 500));
    lines.push('');
    results.forEach((r, i) => {
      lines.push((i + 1) + '. ' + (r.title || '(untitled)'));
      lines.push('   ' + r.url);
      if (r.snippet) lines.push('   ' + truncate(r.snippet.replace(/\s+/g, ' '), 300));
      lines.push('');
    });
    lines.push('Next: fetch_url(url) to read a page in full.');
    return lines.join('\n').trim();
  }

  /* ------------------------------------------------------------------ *
   * tools
   * ------------------------------------------------------------------ */

  R.register({
    name: 'web_search',
    source: 'core:search',
    description:
      'Search the web for query; returns titles, URLs, snippets. Use fetch_url to read a page. Prefer for news and current events.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Number of results 1-10, default 5' },
        provider: { type: 'string', description: 'auto|duckduckgo|wikipedia|serper|brave' },
        site: { type: 'string', description: 'Optional domain restrict' },
        freshness: { type: 'string', description: 'day|week|month|year' }
      },
      required: ['query']
    },
    handler: async function (args) {
      const query = String((args && args.query) || '').trim();
      if (!query) return { ok: false, result: 'query required', notify: true };

      const limit = Math.min(10, Math.max(1, Number(args.limit) || 5));
      const opts = {
        limit,
        site: String(args.site || '').trim(),
        freshness: String(args.freshness || '').toLowerCase()
      };

      const chain = resolveChain(args.provider);
      const errors = [];

      for (let i = 0; i < chain.length; i++) {
        const name = chain[i];
        const run = RUNNERS[name];
        if (!run) { errors.push(name + ': unknown provider'); continue; }
        try {
          const out = await run(query, opts);
          const results = (out.results || [])
            .filter((r) => r && r.url)
            .slice(0, limit);
          if (!results.length) { errors.push(name + ': no results'); continue; }

          if (args.json) {
            return {
              ok: true,
              result: JSON.stringify({
                query,
                provider: name,
                answer: out.answer || '',
                results
              }, null, 2),
              notify: true
            };
          }
          return { ok: true, result: formatResults(query, name, results, out.answer), notify: true };
        } catch (e) {
          errors.push(name + ': ' + String((e && e.message) || e));
        }
      }

      return {
        ok: false,
        result: 'web_search failed — ' + errors.join(' | ') +
          '\nHint: set Settings → workerUrl (CORS proxy) and add the search hosts to the proxy allowlist.',
        notify: true
      };
    }
  });

  R.register({
    name: 'fetch_url',
    source: 'core:search',
    description:
      'Fetch a URL via CORS proxy and return readable text. Use after web_search.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute https URL' },
        max_chars: { type: 'number', description: 'Max characters to return, default 20000' }
      },
      required: ['url']
    },
    handler: async function (args) {
      const rawUrl = String((args && args.url) || '').trim();
      if (!rawUrl) return { ok: false, result: 'url required', notify: true };

      let parsed;
      try { parsed = new URL(rawUrl); }
      catch (_) { return { ok: false, result: 'invalid url: ' + rawUrl, notify: true }; }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, result: 'only http(s) urls are supported', notify: true };
      }

      const max = Math.min(60000, Math.max(500, Number(args.max_chars) || MAX_PAGE_CHARS));

      try {
        const r = await fetchOk(parsed.href, {
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5'
          }
        });

        const isHtml = r.contentType.indexOf('html') >= 0 || /^\s*(<!doctype html|<html)/i.test(r.text);
        const isTexty = r.contentType.indexOf('json') >= 0 ||
                        r.contentType.indexOf('text') >= 0 ||
                        r.contentType.indexOf('xml') >= 0;

        if (args.raw || (!isHtml && !isTexty)) {
          return {
            ok: true,
            result: 'URL: ' + parsed.href + '\nContent-Type: ' + (r.contentType || 'unknown') +
              '\nVia: ' + r.via + '\n\n' + truncate(r.text, max),
            notify: false
          };
        }

        if (!isHtml) {
          return {
            ok: true,
            result: 'URL: ' + parsed.href + '\nVia: ' + r.via + '\n\n' + truncate(r.text, max),
            notify: false
          };
        }

        const extracted = htmlToText(r.text);
        const head = 'Title: ' + (extracted.title || '(none)') + '\nURL: ' + parsed.href +
          '\nVia: ' + r.via + '\n\n';
        return { ok: true, result: head + truncate(extracted.text, max), notify: false };
      } catch (e) {
        const msg = String((e && e.message) || e);
        const hint = /Host not allowed|HOST_BLOCKED/i.test(msg)
          ? '\nHint: add this host to ALLOWED_HOSTS in worker.js / wrangler.toml.'
          : /no CORS proxy|Failed to fetch|proxy/i.test(msg)
            ? '\nHint: set Settings → workerUrl to your Cloudflare CORS proxy.'
            : '';
        return { ok: false, result: 'fetch failed: ' + msg + hint, notify: true };
      }
    }
  });

  R.register({
    name: 'search_status',
    source: 'core:search',
    description: 'Report configured search providers, fallback chain, proxy URL and readiness for web_search / fetch_url.',
    parameters: { type: 'object', properties: {} },
    handler: function () {
      const keys = resolveKeys();
      const proxy = resolveProxy();
      const chain = resolveChain('auto');
      return {
        ok: true,
        result: JSON.stringify({
          version: VERSION,
          provider: getSettings().searchProvider || 'auto',
          fallbackChain: chain,
          keys: {
            serper: !!keys.serper,
            google: !!(keys.google && keys.googleCx),
            brave: !!keys.brave,
            bing: !!keys.bing,
            tavily: !!keys.tavily
          },
          keyless: ['duckduckgo', 'wikipedia'],
          proxy: proxy.proxyUrl || '(none — direct fetch only, most search APIs will fail CORS)',
          viaProxy: getSettings().searchViaProxy !== false,
          note: 'Keys live in Settings → searchKeys {serper, google, brave, bing, tavily} + googleCx. ' +
                'Add search hosts to the proxy allowlist (see ALLOWED_HOSTS / isHostAllowed in worker.js).'
        }, null, 2),
        notify: true
      };
    }
  });

  // handy for debugging in the browser console
  SG.webSearch = { version: VERSION, providers: RUNNERS, status: R.call.bind(R, 'search_status') };
})(window.SG = window.SG || {});