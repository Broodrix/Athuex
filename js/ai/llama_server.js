/* Athuex → Termux llama-server bridge (OpenAI-compatible) — P2 v2.5.3
 * Prefer native llama.cpp tokens over wllama WASM when the user runs
 * llama-server on the same device (e.g. http://127.0.0.1:8080).
 */
(function (SG) {
  'use strict';
  const VERSION = '2.5.3';
  let lastHealth = { ok: false, at: 0, error: '', model: '' };
  const HEALTH_TTL_MS = 8000;

  function defaultUrl(settings) {
    const s = settings || {};
    const u = String(s.llamaServerUrl || s.llamaUrl || '').trim();
    return u || 'http://127.0.0.1:8080';
  }

  function baseUrl(settings) {
    return defaultUrl(settings).replace(/\/+$/, '');
  }

  async function probe(settings, force) {
    const now = Date.now();
    if (!force && lastHealth.at && (now - lastHealth.at) < HEALTH_TTL_MS) {
      return lastHealth;
    }
    const root = baseUrl(settings);
    const ctrl = new AbortController();
    const timer = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, 2500);
    try {
      // llama-server: GET /health or /v1/models
      let res = await fetch(root + '/health', { method: 'GET', signal: ctrl.signal, mode: 'cors' });
      if (!res.ok) {
        res = await fetch(root + '/v1/models', { method: 'GET', signal: ctrl.signal, mode: 'cors' });
      }
      clearTimeout(timer);
      if (!res.ok) {
        lastHealth = { ok: false, at: now, error: 'HTTP ' + res.status, model: '' };
        return lastHealth;
      }
      let model = '';
      try {
        const data = await res.json();
        if (data && data.data && data.data[0] && data.data[0].id) model = String(data.data[0].id);
        else if (data && data.model) model = String(data.model);
        else if (data && data.status) model = 'server';
      } catch (_) { model = 'server'; }
      lastHealth = { ok: true, at: now, error: '', model: model };
      return lastHealth;
    } catch (e) {
      clearTimeout(timer);
      lastHealth = { ok: false, at: now, error: String((e && e.message) || e), model: '' };
      return lastHealth;
    }
  }

  function isReady(settings) {
    return !!(lastHealth.ok && (Date.now() - lastHealth.at) < HEALTH_TTL_MS * 3);
  }

  /**
   * Non-streaming completion against llama-server OpenAI API.
   * @param {Array<{role:string,content:string}>} messages
   * @param {object} opts
   */
  async function complete(messages, opts) {
    opts = opts || {};
    const settings = opts.settings || {};
    const root = baseUrl(settings);
    const model = String(opts.model || settings.llamaServerModel || 'local').trim() || 'local';
    const body = {
      model: model,
      messages: (messages || []).map(function (m) {
        return { role: m.role === 'system' ? 'system' : (m.role === 'assistant' ? 'assistant' : 'user'), content: String(m.content || '') };
      }),
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.4,
      max_tokens: typeof opts.max_tokens === 'number' ? opts.max_tokens : 1024,
      stream: !!opts.stream
    };
    // llama.cpp server optional sampling (ignored if unsupported)
    if (typeof opts.top_p === 'number') body.top_p = opts.top_p;
    if (typeof opts.top_k === 'number') body.top_k = opts.top_k;
    if (typeof opts.repeat_penalty === 'number') body.repeat_penalty = opts.repeat_penalty;
    if (Array.isArray(opts.stop) && opts.stop.length) body.stop = opts.stop;
    const headers = { 'Content-Type': 'application/json', Accept: opts.stream ? 'text/event-stream, application/json' : 'application/json' };
    const signal = opts.signal;

    if (opts.stream && typeof opts.onDelta === 'function') {
      const res = await fetch(root + '/v1/chat/completions', {
        method: 'POST', headers: headers, body: JSON.stringify(body), signal: signal
      });
      if (!res.ok) {
        const t = await res.text().catch(function () { return ''; });
        throw new Error('llama-server HTTP ' + res.status + (t ? ': ' + t.slice(0, 200) : ''));
      }
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (!reader) {
        // fallback non-stream parse
        const data = await res.json();
        const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        opts.onDelta(text);
        return { message: { role: 'assistant', content: text }, backend: 'llama-server' };
      }
      const dec = new TextDecoder();
      let full = '';
      let buf = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        const parts = buf.split('\n');
        buf = parts.pop() || '';
        for (let i = 0; i < parts.length; i++) {
          let line = parts[i].trim();
          if (!line || line === 'data: [DONE]') continue;
          if (line.indexOf('data:') === 0) line = line.slice(5).trim();
          try {
            const j = JSON.parse(line);
            const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (delta) {
              full += delta;
              opts.onDelta(full);
            }
          } catch (_) {}
        }
      }
      return { message: { role: 'assistant', content: full }, backend: 'llama-server' };
    }

    const res = await fetch(root + '/v1/chat/completions', {
      method: 'POST', headers: headers, body: JSON.stringify(Object.assign({}, body, { stream: false })), signal: signal
    });
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch (_) { data = { error: raw.slice(0, 280) }; }
    if (!res.ok) throw new Error('llama-server HTTP ' + res.status + ': ' + (data.error || raw).toString().slice(0, 200));
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    return { message: { role: 'assistant', content: text }, backend: 'llama-server' };
  }

  SG.llamaServer = {
    version: VERSION,
    probe: probe,
    isReady: isReady,
    complete: complete,
    baseUrl: baseUrl,
    getLastHealth: function () { return Object.assign({}, lastHealth); }
  };
})(window.SG = window.SG || {});
