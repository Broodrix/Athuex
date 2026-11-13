/* Athuex SW v2.11.1 — network-first nav, never cache GGUF (Range/HEAD unsafe) */
'use strict';
const CACHE = 'athuex-shell-v2.11.1';
const SHELL = [
  './', './index.html', './css/ide.css',
  './js/version.js', './js/settings.js', './js/store.js', './js/vfs.js', './js/ai/local.js', './js/ai/llama_server.js', './js/ai/harness.js', './adapters/consciousness.js', './adapters/neuromorphic.js', './adapters/thermodynamic.js', './adapters/spatial_memory.js', './adapters/sia.js', './adapters/continuous_learning.js', './js/app/adapters_ui.js', './js/ai/router.js', './js/ai/cloud.js', './js/hybrid_traces.js', './js/markdown.js',
  './js/preview.js', './js/runner.js', './js/templates.js', './js/github.js',
  './js/tools.js', './js/attachments.js', './js/app/helpers.js', './js/app/dialogs.js', './js/app/system_prompt.js', './js/app/offline.js', './js/app.js',
  './memory/athuex_memory.js',
  './programs/registry.js', './programs/chat.js', './programs/files.js', './programs/edit.js', './programs/preview.js', './programs/browser.js', './programs/tools.js', './programs/about.js', './programs/test.js', './programs/calculator.js', './programs/debug_console.js', './js/programs.js', './tools/registry.js', './tools/context_utils.js',
  './tools/vfs_list.js', './tools/vfs_read.js', './tools/vfs_write.js', './tools/vfs_delete.js', './tools/vfs_replace.js',
  './tools/file_reader.js', './tools/file_writer.js',
  './tools/run.js', './tools/preview.js',
  './tools/smfs.js', './tools/mcp.js', './tools/code.js', './tools/tessarune.js',
  './tools/websearch.js', './tools/memory.js', './tools/harness_tool.js',
  './smfs/bridge.js', './smfs/lorenz.js',
  './smfs/worker.js', './smfs/persistence.js', './smfs/mini-viewer.html',
  './manifest.webmanifest', './icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/\.gguf$/i.test(url.pathname)) return;

  // Navigation: network-first (fresh HTML on online, cached shell offline)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(req)
            .then((hit) => hit || caches.match('./index.html'))
            .then((h) => h || Response.error())
        )
    );
    return;
  }

  // Static assets: stale-while-revalidate (instant from cache, refresh in background)
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});