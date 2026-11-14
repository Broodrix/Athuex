/* Athuex tool error abstraction — v1.0.8 */
(function (SG) {
  'use strict';

  const MAP = [
    { re: /ENOENT|not found|no such file/i, code: 'NOT_FOUND',
      msg: 'That path was not found in the workspace.',
      next: 'Call list_files to see what exists, or check the spelling of the path.' },
    { re: /EEXIST|already exists/i, code: 'EXISTS',
      msg: 'A file already exists at that path.',
      next: 'Use str_replace to edit it, or delete_file first if you intend to replace it.' },
    { re: /permission|denied|EACCES|EPERM/i, code: 'DENIED',
      msg: 'Permission denied for that operation.',
      next: 'Use MAIN workspace tools (write_file) instead of external SMFS unless the user asked for SMFS.' },
    { re: /exceeds|too large|2MB|payload/i, code: 'TOO_LARGE',
      msg: 'Content exceeds the size limit.',
      next: 'Write a smaller chunk, or use write_file_context_optimized with append strategy.' },
    { re: /invalid path|illegal|traversal|\.\./i, code: 'BAD_PATH',
      msg: 'Invalid path.',
      next: 'Use a simple relative path like index.html or src/app.js (no ..).' },
    { re: /timeout|timed out|aborted/i, code: 'TIMEOUT',
      msg: 'The operation timed out.',
      next: 'Retry once, or narrow the request (smaller read range / simpler query).' },
    { re: /network|failed to fetch|CORS|proxy/i, code: 'NETWORK',
      msg: 'Network or proxy failure.',
      next: 'Check Settings → Worker URL and connectivity, then retry.' },
    { re: /Invalid JSON|JSON arguments/i, code: 'BAD_ARGS',
      msg: 'Tool arguments were not valid JSON.',
      next: 'Retry the tool call with a valid JSON object for arguments.' },
    { re: /unknown tool|not registered|unavailable/i, code: 'NO_TOOL',
      msg: 'That tool is not available.',
      next: 'Call list_tools to see registered tools, or list_programs for UI programs.' }
  ];

  function normalize(err, fallback) {
    const raw = String((err && err.message) || err || fallback || 'Unknown error');
    for (let i = 0; i < MAP.length; i++) {
      if (MAP[i].re.test(raw)) {
        return {
          ok: false,
          code: MAP[i].code,
          result: MAP[i].msg + ' (' + raw.slice(0, 120) + ')\nNext: ' + MAP[i].next,
          notify: true,
          raw: raw
        };
      }
    }
    return {
      ok: false,
      code: 'ERROR',
      result: raw.slice(0, 400) + '\nNext: Call list_tools or list_files, then retry with corrected arguments.',
      notify: true,
      raw: raw
    };
  }

  function wrapHandler(fn) {
    return async function (args, ctx) {
      try {
        const out = await fn(args, ctx);
        if (out && out.ok === false && out.result && !/Next:/.test(String(out.result))) {
          const n = normalize(out.result);
          return Object.assign({}, out, { result: n.result, code: n.code });
        }
        return out;
      } catch (e) {
        return normalize(e);
      }
    };
  }

  SG.toolErrors = { normalize: normalize, wrapHandler: wrapHandler, MAP: MAP };
})(window.SG = window.SG || {});
