/* GitHub Contents API via CORS Worker — lightweight push/pull */
(function (SG) {
  'use strict';

  function cfg() {
    if (window.SG && SG.settings && typeof SG.settings.load === 'function') return SG.settings.load();
    const keys = ['athuex.settings', 'sg.settings_v137', 'sg.settings_v136', 'sg.settings_v135', 'sg.settings_v134', 'sg.settings_v133', 'sg.settings_v132', 'sg.settings_v130', 'sg.settings_v129', 'sg.settings_v128', 'sg.settings_v127', 'sg.settings_v126', 'sg.settings_v125', 'sg.settings_v123', 'sg.settings_v122', 'sg.settings_v121', 'sg.settings_v120', 'sg.settings_v115'];
    for (let i = 0; i < keys.length; i++) {
      try {
        const raw = localStorage.getItem(keys[i]);
        if (raw) return JSON.parse(raw);
      } catch (_) {}
    }
    return {};
  }

  function proxyFetch(url, init) {
    const s = cfg();
    const p = (s.workerUrl || '').trim();
    if (!p) return Promise.reject(new Error('Worker URL required for GitHub'));
    const headers = Object.assign({}, (init && init.headers) || {});
    if (s.proxyKey) headers['X-Proxy-Key'] = s.proxyKey;
    const target = p.replace(/\/+$/, '') + '?url=' + encodeURIComponent(url);
    return fetch(target, Object.assign({}, init, { headers }));
  }

  function authHeaders(token) {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  function parseRepo(repo) {
    const m = String(repo || '').trim().match(/^([^/]+)\/([^/]+)$/);
    if (!m) throw new Error('Repo must be owner/name');
    return { owner: m[1], name: m[2].replace(/\.git$/, '') };
  }

  async function putFile(owner, name, path, content, token, sha) {
    const url = 'https://api.github.com/repos/' + owner + '/' + name + '/contents/' + encodeURIComponent(path).replace(/%2F/g, '/');
    const body = {
      message: 'Athuex sync: ' + path,
      content: btoa(unescape(encodeURIComponent(content)))
    };
    if (sha) body.sha = sha;
    const res = await proxyFetch(url, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.message || ('HTTP ' + res.status)) + (path ? ' (' + path + ')' : ''));
    return data;
  }

  async function getFileSha(owner, name, path, token) {
    const url = 'https://api.github.com/repos/' + owner + '/' + name + '/contents/' + encodeURIComponent(path).replace(/%2F/g, '/');
    const res = await proxyFetch(url, { headers: authHeaders(token) });
    if (res.status === 404) return null;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
    return data.sha || null;
  }

  async function getFile(owner, name, path, token) {
    const url = 'https://api.github.com/repos/' + owner + '/' + name + '/contents/' + encodeURIComponent(path).replace(/%2F/g, '/');
    const res = await proxyFetch(url, { headers: authHeaders(token) });
    if (res.status === 404) return null;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
    if (data.encoding === 'base64' && data.content) {
      try {
        return decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
      } catch (_) {
        return atob(data.content.replace(/\n/g, ''));
      }
    }
    return null;
  }

  async function pushAll(files) {
    const s = cfg();
    const token = (s.githubToken || '').trim();
    const repo = (s.githubRepo || '').trim();
    if (!token) throw new Error('GitHub token missing in Settings');
    if (!repo) throw new Error('GitHub repo missing (owner/name)');
    const { owner, name } = parseRepo(repo);
    const names = Object.keys(files).sort();
    const results = [];
    for (const path of names) {
      const sha = await getFileSha(owner, name, path, token);
      await putFile(owner, name, path, String(files[path] ?? ''), token, sha);
      results.push(path);
    }
    return { ok: true, count: results.length, paths: results };
  }

  async function pullAll(paths) {
    const s = cfg();
    const token = (s.githubToken || '').trim();
    const repo = (s.githubRepo || '').trim();
    if (!token) throw new Error('GitHub token missing in Settings');
    if (!repo) throw new Error('GitHub repo missing (owner/name)');
    const { owner, name } = parseRepo(repo);
    const out = {};
    for (const path of paths) {
      const content = await getFile(owner, name, path, token);
      if (content != null) out[path] = content;
    }
    return out;
  }

  SG.github = { pushAll, pullAll, parseRepo };
})(window.SG = window.SG || {});
