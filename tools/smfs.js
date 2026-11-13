/* SMFS external volume tools — secondary memory — v1.3.2 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;
  const U = SG.contextUtils;

  async function dispatch(name, args) {
    if (!window.SMFS || !SMFS.isReady()) return { error: 'SMFS external volume not mounted' };
    args = args || {};
    try {
      switch (name) {
        case 'sm_read': {
          const r = await SMFS.read(args.path);
          let content = r.content;
          if (U && args.modelIdentifier && content) {
            const budget = U.usableTokens(args.modelIdentifier, args.contextTokensUsed) * 4;
            const cursor = Math.max(0, Number(args.cursor) || 0);
            if (content.length > budget) {
              const end = U.pageEnd(content, cursor, budget);
              const slice = content.slice(cursor, end);
              return {
                content: slice,
                truncated: end < content.length,
                nextCursor: end < content.length ? end : null,
                descriptor: { crc: r.crc, size: r.size },
                path: r.path
              };
            }
          }
          return { content: content, descriptor: { crc: r.crc, size: r.size }, path: r.path };
        }
        case 'sm_write': {
          const r = await SMFS.write(args.path, args.content, args.expectedCrc);
          return { crc: r.crc, path: r.path, size: r.size };
        }
        case 'sm_list': {
          const r = await SMFS.list(args.path || '/');
          return (r.children || []).map(function (c, i) {
            return { idx: i, path: c.path, name: c.name, type: c.type, size: c.size, hash: c.hash };
          });
        }
        case 'sm_delete': {
          await SMFS.remove(args.path);
          return { ok: true, path: args.path };
        }
        case 'sm_to_workspace': {
          const r = await SMFS.read(args.path);
          const files = (args._files) || {};
          let rel = String(args.path || '').replace(/^\/+/, '');
          if (!rel) return { error: 'bad path' };
          files[rel] = r.content;
          return { ok: true, path: rel, bytes: (r.content || '').length, note: 'copied external → workspace (main)' };
        }
        case 'sm_from_workspace': {
          const files = (args._files) || {};
          const rel = String(args.path || '').replace(/^\/+/, '');
          if (!rel || files[rel] === undefined) return { error: 'not in workspace: ' + rel };
          const r = await SMFS.write('/' + rel, files[rel], args.expectedCrc);
          return { ok: true, path: '/' + rel, crc: r.crc, note: 'copied workspace (main) → external' };
        }
        default: return { error: 'unknown SMFS tool: ' + name };
      }
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
  }

  function wrap(name, desc, params, required) {
    R.register({
      name: name, source: 'core:smfs', version: '1.3.2', description: desc,
      parameters: { type: 'object', properties: params || {}, required: required || [] },
      handler: async function (args, ctx) {
        args = args || {};
        args._files = (ctx && ctx.files) || {};
        if ((name === 'sm_write' || name === 'sm_delete') && typeof ctx.checkpoint === 'function' && args.path) {
          try {
            if (window.SMFS && SMFS.isReady()) {
              const r = await SMFS.read(args.path);
              ctx.checkpoint('smfs:' + args.path, r.content);
            }
          } catch (_) {}
        }
        if (name === 'sm_to_workspace' && typeof ctx.checkpoint === 'function') {
          const rel = String(args.path || '').replace(/^\/+/, '');
          if (rel && args._files[rel] !== undefined) ctx.checkpoint(rel, args._files[rel]);
        }
        const r = await dispatch(name, args);
        if (r && r.error) return { ok: false, result: r.error, notify: true };
        if (name === 'sm_to_workspace' && r && r.path && typeof ctx.onChange === 'function') ctx.onChange(r.path);
        return { ok: true, result: typeof r === 'string' ? r : JSON.stringify(r), notify: true };
      }
    });
  }

  wrap('sm_list', 'List SMFS external volume directory.', { path: { type: 'string' } }, []);
  wrap('sm_read', 'Read from SMFS external volume. Optional modelIdentifier for token-window paging + cursor.', {
    path: { type: 'string' }, modelIdentifier: { type: 'string' }, cursor: { type: 'integer' }, contextTokensUsed: { type: 'integer' }
  }, ['path']);
  wrap('sm_write', 'Write on SMFS external volume. Pass expectedCrc from sm_read.', {
    path: { type: 'string' }, content: { type: 'string' }, expectedCrc: { type: 'number' }
  }, ['path', 'content']);
  wrap('sm_delete', 'Delete from SMFS external volume.', { path: { type: 'string' } }, ['path']);
  wrap('sm_to_workspace', 'Copy a file from SMFS (external) into workspace (main memory) for editing.', {
    path: { type: 'string' }
  }, ['path']);
  wrap('sm_from_workspace', 'Copy a workspace file (main) into SMFS (external).', {
    path: { type: 'string' }, expectedCrc: { type: 'number' }
  }, ['path']);

  window.SMFSTools = { dispatch: dispatch };
})(window.SG = window.SG || {});
