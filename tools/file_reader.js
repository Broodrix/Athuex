/* Context-aware workspace reader — dynamic model token window — v1.3.2 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  const U = SG.contextUtils;
  if (!R || !U) return;

  function needleSearch(text, query, budgetChars) {
    const q = String(query || '').toLowerCase().slice(0, 200);
    if (!q) return { content: '', matchingLines: 0, truncated: false };
    const lines = text.split('\n');
    const hit = [];
    lines.forEach(function (l, i) { if (l.toLowerCase().indexOf(q) >= 0) hit.push(i); });
    const keep = new Set();
    hit.forEach(function (i) {
      for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) keep.add(j);
    });
    const out = [];
    let used = 0, prev = -2, truncated = false;
    Array.from(keep).sort(function (a, b) { return a - b; }).forEach(function (j) {
      const row = 'L' + (j + 1) + ': ' + lines[j];
      if (used + row.length + 1 > budgetChars) { truncated = true; return; }
      if (j !== prev + 1 && out.length) out.push('--');
      out.push(row); used += row.length + 1; prev = j;
    });
    return { content: out.join('\n'), matchingLines: hit.length, truncated: truncated };
  }

  R.register({
    name: 'read_file_context_optimized',
    source: 'core:context-reader', version: '1.3.2',
    description:
      'Budget-aware read of workspace (main memory). Modes: complete_scan (cursor or pageNumber), needle_in_haystack, metadata_only. Returns fileCrc32 for write handshake.',
    parameters: {
      type: 'object',
      required: ['path', 'modelIdentifier'],
      properties: {
        path: { type: 'string' },
        modelIdentifier: { type: 'string' },
        pageNumber: { type: 'integer' },
        cursor: { type: 'integer' },
        urgencyMode: { type: 'string', enum: ['complete_scan', 'needle_in_haystack', 'metadata_only'] },
        query: { type: 'string' },
        contextTokensUsed: { type: 'integer' }
      }
    },
    handler: function (args, ctx) {
      const path = U.cleanName(args.path);
      const files = (ctx && ctx.files) || {};
      if (!path || files[path] === undefined) {
        return { ok: false, result: 'file not found: ' + (args.path || ''), notify: true };
      }
      const text = String(files[path]);
      const mode = String(args.urgencyMode || 'complete_scan');
      const budgetTok = U.usableTokens(args.modelIdentifier, args.contextTokensUsed);
      const budgetChars = budgetTok * 4;
      const fileCrc = U.crc32(text);
      const lines = text.split('\n').length;
      const bytes = U.utf8Bytes(text).length;
      const totalTok = U.estimateTokens(text);

      if (mode === 'metadata_only') {
        return {
          ok: true,
          result: JSON.stringify({
            ok: true, path: path, mode: mode, fileCrc32: fileCrc,
            lines: lines, bytes: bytes, tokensEst: totalTok, nextCursor: null
          }),
          notify: false
        };
      }
      if (mode === 'needle_in_haystack') {
        const n = needleSearch(text, args.query, budgetChars);
        return {
          ok: true,
          result: JSON.stringify({
            ok: true, path: path, mode: mode, fileCrc32: fileCrc,
            content: n.content, matchingLines: n.matchingLines, truncated: n.truncated
          }),
          notify: false
        };
      }

      // complete_scan: prefer cursor; fall back to pageNumber
      let cursor = 0;
      if (args.cursor != null && Number(args.cursor) >= 0) {
        cursor = Number(args.cursor) | 0;
      } else if (args.pageNumber != null && Number(args.pageNumber) > 1) {
        cursor = (Math.max(1, Number(args.pageNumber) | 0) - 1) * budgetChars;
      }
      if (cursor >= text.length) {
        return {
          ok: true,
          result: JSON.stringify({
            ok: true, path: path, mode: mode, fileCrc32: fileCrc,
            content: '', nextCursor: null, done: true, lines: lines, bytes: bytes
          }),
          notify: false
        };
      }
      if (text.length <= budgetChars && cursor === 0) {
        return {
          ok: true,
          result: JSON.stringify({
            ok: true, path: path, mode: mode, fileCrc32: fileCrc,
            content: text, nextCursor: null, done: true,
            lines: lines, bytes: bytes, tokensEst: totalTok,
            executionStrategy: 'direct_ingest'
          }),
          notify: false
        };
      }
      const end = U.pageEnd(text, cursor, budgetChars);
      const slice = text.slice(cursor, end);
      const next = end < text.length ? end : null;
      const pageNum = Math.floor(cursor / Math.max(1, budgetChars)) + 1;
      const totalPages = Math.ceil(text.length / Math.max(1, budgetChars));
      return {
        ok: true,
        result: JSON.stringify({
          ok: true, path: path, mode: mode, fileCrc32: fileCrc,
          content: slice, nextCursor: next, done: next == null,
          pageChars: slice.length, tokensEst: U.estimateTokens(slice),
          pagination: { currentPage: pageNum, totalPages: totalPages, hasMore: next != null, nextPageHint: next != null ? pageNum + 1 : null },
          executionStrategy: 'sliding_window_stream'
        }),
        notify: false
      };
    }
  });
})(window.SG = window.SG || {});
