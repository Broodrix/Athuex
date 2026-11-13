/* Context-aware workspace writer — CRC + token guard — v1.3.2 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  const U = SG.contextUtils;
  if (!R || !U) return;

  const STRATEGIES = {
    overwrite: 'overwrite',
    direct_overwrite: 'overwrite',
    append: 'append',
    chunked_append: 'append',
    create_only: 'create_only'
  };

  R.register({
    name: 'write_file_context_optimized',
    source: 'core:context-writer', version: '1.3.2',
    description:
      'Write/append workspace (main memory) with CRC handshake. Strategies: overwrite|direct_overwrite, append|chunked_append, create_only. Pass expectedCrc from prior read fileCrc32.',
    parameters: {
      type: 'object',
      required: ['path', 'content', 'modelIdentifier', 'writeStrategy'],
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        modelIdentifier: { type: 'string' },
        writeStrategy: {
          type: 'string',
          enum: ['overwrite', 'direct_overwrite', 'append', 'chunked_append', 'create_only']
        },
        expectedCrc: { type: 'integer' },
        contextTokensUsed: { type: 'integer' }
      }
    },
    handler: function (args, ctx) {
      const path = U.cleanName(args.path);
      if (!path) return { ok: false, result: 'Invalid path', notify: true };
      const content = String(args.content == null ? '' : args.content);
      const strategyKey = String(args.writeStrategy || 'overwrite');
      const strategy = STRATEGIES[strategyKey] || null;
      if (!strategy) {
        return { ok: false, result: 'writeStrategy must be overwrite|append|create_only (or direct_overwrite|chunked_append)', notify: true };
      }

      const payloadTok = U.estimateTokens(content);
      const limit = U.usableTokens(args.modelIdentifier, args.contextTokensUsed);
      if (payloadTok > limit) {
        return {
          ok: false,
          result: 'Payload ~' + payloadTok + ' tokens exceeds safe window (~' + limit + '). Split and use append/chunked_append.',
          notify: true
        };
      }
      if (U.utf8Bytes(content).length > 2 * 1024 * 1024) {
        return { ok: false, result: 'Payload exceeds 2MB limit', notify: true };
      }

      const files = (ctx && ctx.files) || {};
      const exists = Object.prototype.hasOwnProperty.call(files, path);
      if (strategy === 'create_only' && exists) {
        return { ok: false, result: 'File already exists (create_only)', notify: true };
      }
      if (exists && strategy !== 'create_only') {
        if (args.expectedCrc == null) {
          return {
            ok: false,
            result: 'expectedCrc required for existing files — re-read with read_file_context_optimized first',
            notify: true
          };
        }
        const current = U.crc32(String(files[path] == null ? '' : files[path]));
        if (Number(args.expectedCrc) !== current) {
          return {
            ok: false,
            result: 'CRC conflict — file changed since last read. Re-read and retry.',
            notify: true
          };
        }
      }

      if (typeof ctx.checkpoint === 'function' && exists) ctx.checkpoint(path, files[path]);
      let next = content;
      if (strategy === 'append' && exists) next = String(files[path] || '') + content;
      if (U.utf8Bytes(next).length > 2 * 1024 * 1024) {
        return { ok: false, result: 'Final file would exceed 2MB', notify: true };
      }
      files[path] = next;
      if (typeof ctx.onChange === 'function') ctx.onChange(path);
      const crc = U.crc32(next);
      return {
        ok: true,
        result: JSON.stringify({
          ok: true,
          path: path,
          strategy: strategy,
          crc32: crc,
          bytes: U.utf8Bytes(next).length,
          lines: next.split('\n').length,
          metrics: {
            bytesWritten: content.length,
            estimatedTokensSent: payloadTok
          }
        }),
        notify: true
      };
    }
  });
})(window.SG = window.SG || {});
