/* Shared context limits + CRC for VFS / Tessarune tools — v1.3.2 */
(function (SG) {
  'use strict';
  const MODEL_CONTEXT = {
    'nvidia/nemotron-3.5-bolt-e4b': 65536,
    'nvidia/nemotron-3.5-bolt-74b-a9b': 8192,
    'nvidia/nemotron-3.5-super-120b-a12b': 262144,
    'nvidia/nemotron-3.5-lightning-30b-a3b': 131072,
    'nvidia/llama-3.1-nemotron-70b-instruct': 131072,
    'meta/llama-3.1-8b-instruct': 131072,
    'meta/llama-3.1-70b-instruct': 131072,
    'google/gemma-2-9b-it': 8192,
    'google/gemma-2-27b-it': 8192,
    'microsoft/phi-3.5-mini-instruct': 131072,
    'mistralai/mistral-7b-instruct-v0.3': 32768,
    'qwen/qwen2.5-7b-instruct': 131072,
    'qwen/qwen2.5-72b-instruct': 131072,
    'deepseek-ai/deepseek-v3': 65536,
    'deepseek-ai/deepseek-v4-pro': 131072,
    'default-fallback': 8192
  };
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(str));
    const s = unescape(encodeURIComponent(String(str)));
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function crc32(str) {
    const bytes = utf8Bytes(str);
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function estimateTokens(text) {
    return Math.ceil(String(text || '').length / 4);
  }
  function contextLimit(modelId) {
    const id = String(modelId || '').toLowerCase();
    if (MODEL_CONTEXT[modelId]) return MODEL_CONTEXT[modelId];
    for (const k of Object.keys(MODEL_CONTEXT)) {
      if (k !== 'default-fallback' && id.indexOf(k.split('/').pop()) >= 0) return MODEL_CONTEXT[k];
    }
    if (/120b|70b|super/.test(id)) return 131072;
    if (/30b|32b|13b|14b|27b/.test(id)) return 65536;
    if (/8b|7b|9b|mini|nano|bolt|phi/.test(id)) return 32768;
    return MODEL_CONTEXT['default-fallback'];
  }
  /** Usable tokens for file content (reserve ~25% for system+history). */
  function usableTokens(modelId, usedTokens) {
    const ctx = contextLimit(modelId);
    const reserve = Math.max(2048, Math.floor(ctx * 0.25));
    return Math.max(1024, ctx - reserve - (Number(usedTokens) || 0));
  }
  function cleanName(n) {
    let s = String(n || '').replace(/\\/g, '/');
    if (s.startsWith('/')) s = s.slice(1);
    if (!s || /[\0-\x1f]/.test(s) || s.split('/').some(function (p) { return p === '..' || p === ''; })) return null;
    return s.slice(0, 200);
  }
  function pageEnd(text, start, size) {
    let end = Math.min(text.length, start + size);
    if (end >= text.length) return text.length;
    const nl = text.lastIndexOf('\n', end - 1);
    if (nl >= start + size / 2) return nl + 1;
    const c = text.charCodeAt(end - 1);
    if (c >= 0xd800 && c <= 0xdbff) end--;
    return end;
  }
  SG.contextUtils = {
    MODEL_CONTEXT, crc32, utf8Bytes, estimateTokens, contextLimit, usableTokens, cleanName, pageEnd
  };
})(window.SG = window.SG || {});
