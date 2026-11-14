/* Athuex attachment pipeline — P1 v2.5.2
 * Blob-backed store, lightweight extractors, chunked context, inspectable excerpts.
 * Designed for mobile memory limits (Galaxy A06 class). No heavy vendor bundles.
 */
(function (SG) {
  'use strict';
  const VERSION = '2.5.2';
  const MAX_FILE_BYTES = 64 * 1024 * 1024;
  const MAX_READ_BYTES = 512 * 1024;
  const MAX_CONTEXT_CHARS = 6000;
  const MAX_CHUNK_CHARS = 2400;
  const MAX_WORKSPACE_TEXT = 2 * 1024 * 1024;

  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|c|h|cc|cpp|hpp|py|sh|bash|thue|yaml|yml|toml|ini|cfg|conf|log|sql|java|kt|rs|go|php|rb|pl|r|diff|patch|svg|webmanifest|properties|gradle|env|dockerfile|makefile)$/i;
  const ZIP_EXT = /\.(zip|docx|xlsx|odt|ods|epub)$/i;
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico)$/i;
  const PDF_EXT = /\.pdf$/i;

  /** @type {Map<string, AttachmentMeta>} */
  const store = new Map();
  let lastContext = '';
  let lastInspect = [];

  /**
   * @typedef {Object} AttachmentMeta
   * @property {string} id
   * @property {string} name
   * @property {number} size
   * @property {string} mime
   * @property {Blob|null} blob
   * @property {string} parserStatus  // pending|text|zip-list|image-meta|pdf-meta|binary|error
   * @property {string} checksum      // short djb2 hex of first 64KiB
   * @property {string[]} excerpts
   * @property {string} note
   * @property {number} addedAt
   */

  function djb2Hex(str) {
    let h = 5381;
    const n = Math.min(str.length, 65536);
    for (let i = 0; i < n; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(16);
  }

  function isTextLike(name, mime) {
    if (TEXT_EXT.test(name)) return true;
    if (/^text\//i.test(mime || '')) return true;
    if (/(?:json|xml|javascript|typescript|yaml|csv|x-www-form-urlencoded|markdown)/i.test(mime || '')) return true;
    return false;
  }

  function isZipLike(name, mime) {
    if (ZIP_EXT.test(name)) return true;
    if (/zip|officedocument|opendocument|epub/i.test(mime || '')) return true;
    return false;
  }

  function isImage(name, mime) {
    if (IMAGE_EXT.test(name)) return true;
    return /^image\//i.test(mime || '');
  }

  function isPdf(name, mime) {
    if (PDF_EXT.test(name)) return true;
    return /pdf/i.test(mime || '');
  }

  /** Minimal ZIP central-directory listing (no full inflate). Returns entry names + sizes. */
  async function listZipEntries(blob) {
    const ab = await blob.slice(0, Math.min(blob.size, 4 * 1024 * 1024)).arrayBuffer();
    const u8 = new Uint8Array(ab);
    const view = new DataView(ab);
    // Find end of central directory (EOCD) signature 0x06054b50
    let eocd = -1;
    const maxScan = Math.min(u8.length, 65557);
    for (let i = u8.length - 22; i >= u8.length - maxScan && i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return { ok: false, entries: [], error: 'EOCD not found (not a zip or truncated)' };
    const totalEntries = view.getUint16(eocd + 10, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    if (cdOffset >= u8.length) return { ok: false, entries: [], error: 'central directory outside scanned range' };
    const entries = [];
    let off = cdOffset;
    for (let n = 0; n < totalEntries && off + 46 <= u8.length; n++) {
      if (view.getUint32(off, true) !== 0x02014b50) break;
      const method = view.getUint16(off + 10, true);
      const compSize = view.getUint32(off + 20, true);
      const uncompSize = view.getUint32(off + 24, true);
      const nameLen = view.getUint16(off + 28, true);
      const extraLen = view.getUint16(off + 30, true);
      const commentLen = view.getUint16(off + 32, true);
      let name = '';
      try {
        name = new TextDecoder('utf-8').decode(u8.subarray(off + 46, off + 46 + nameLen));
      } catch (_) {
        name = 'entry_' + n;
      }
      entries.push({ name: name, size: uncompSize, compressed: compSize, method: method });
      off += 46 + nameLen + extraLen + commentLen;
    }
    return { ok: true, entries: entries, error: null };
  }

  /** Extract plain text from docx-like zip (word/document.xml) without full inflate of everything. */
  async function extractDocxText(blob) {
    // Lightweight: only list + note; full XML inflate needs inflate which we avoid for RAM.
    // Return listing + instruction; optional future: add tiny inflate for document.xml only.
    const listed = await listZipEntries(blob);
    if (!listed.ok) return { text: '', note: listed.error };
    const names = listed.entries.map(function (e) { return e.name; });
    const hasDoc = names.some(function (n) { return /word\/document\.xml$/i.test(n); });
    return {
      text: '',
      note: hasDoc
        ? 'DOCX structure detected (' + listed.entries.length + ' entries). Full XML text extraction requires optional inflater; listing only in this build.'
        : 'ZIP package (' + listed.entries.length + ' entries).'
    };
  }

  async function imageMeta(blob, name) {
    try {
      if (typeof createImageBitmap === 'function') {
        const bmp = await createImageBitmap(blob.slice(0, Math.min(blob.size, 8 * 1024 * 1024)));
        const w = bmp.width, h = bmp.height;
        try { bmp.close(); } catch (_) {}
        return { note: 'Image ' + name + ': ' + w + '×' + h + ' px', width: w, height: h };
      }
    } catch (_) {}
    return { note: 'Image ' + name + ': metadata only (dimensions unavailable)', width: 0, height: 0 };
  }

  function chunkText(text, maxChunk) {
    const chunks = [];
    const s = String(text || '');
    let i = 0;
    while (i < s.length && chunks.length < 32) {
      chunks.push(s.slice(i, i + maxChunk));
      i += maxChunk;
    }
    return chunks;
  }

  function synthesizeExcerpt(chunks, budget) {
    if (!chunks.length) return '';
    if (chunks.length === 1) return chunks[0].slice(0, budget);
    // First + middle marker + last under budget
    const head = Math.floor(budget * 0.55);
    const tail = Math.floor(budget * 0.35);
    const mid = budget - head - tail - 40;
    let out = chunks[0].slice(0, head);
    if (chunks.length > 2 && mid > 20) {
      const midIdx = Math.floor(chunks.length / 2);
      out += '\n\n[… ' + (chunks.length - 2) + ' intermediate chunk(s) omitted …]\n\n' + chunks[midIdx].slice(0, Math.max(0, mid));
    } else if (chunks.length > 1) {
      out += '\n\n[… truncated …]\n\n';
    }
    out += chunks[chunks.length - 1].slice(-tail);
    return out.slice(0, budget);
  }

  /**
   * Process a list of File/Blob items into attachment metas + context string.
   * @param {Array<File|Blob>} filesList
   * @param {{onProgress?: function}} opts
   */
  async function processFiles(filesList, opts) {
    opts = opts || {};
    const list = Array.isArray(filesList) ? filesList : [];
    const contextParts = [];
    const addedWorkspace = [];
    let remaining = MAX_CONTEXT_CHARS;
    lastInspect = [];

    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const name = String(f.name || 'upload.bin').replace(/^.*[\\\/]/, '').replace(/[^\w.\-]+/g, '_') || 'upload.bin';
      if (typeof opts.onProgress === 'function') {
        try { opts.onProgress({ index: i, total: list.length, name: name, phase: 'start' }); } catch (_) {}
      }
      if (f.size > MAX_FILE_BYTES) {
        contextParts.push('[Rejected ' + name + ': exceeds 64 MiB]');
        lastInspect.push({ name: name, status: 'rejected', note: 'size > 64 MiB' });
        continue;
      }

      const mime = f.type || 'application/octet-stream';
      const id = 'att_' + Date.now().toString(36) + '_' + i;
      /** @type {AttachmentMeta} */
      const meta = {
        id: id,
        name: name,
        size: f.size,
        mime: mime,
        blob: f,
        parserStatus: 'pending',
        checksum: '',
        excerpts: [],
        note: '',
        addedAt: Date.now()
      };

      try {
        // Checksum sample
        const sample = await f.slice(0, Math.min(f.size, 65536)).text().catch(function () { return ''; });
        meta.checksum = djb2Hex(sample || name + f.size);

        if (isTextLike(name, mime)) {
          const readBytes = Math.min(f.size, MAX_READ_BYTES);
          const textContent = await f.slice(0, readBytes).text();
          const chunks = chunkText(textContent, MAX_CHUNK_CHARS);
          const room = Math.max(0, remaining);
          const excerpt = synthesizeExcerpt(chunks, room);
          const wasTruncated = f.size > readBytes || textContent.length > excerpt.length;
          meta.parserStatus = 'text';
          meta.excerpts = [excerpt];
          meta.note = wasTruncated
            ? 'Text excerpt; truncated (read ' + readBytes + ' B of ' + f.size + ' B, context budget)'
            : 'Full text within limits';
          if (excerpt) {
            contextParts.push(
              '--- BEGIN ATTACHMENT: ' + name + ' (' + formatBytes(f.size) + ', ' + meta.parserStatus + ', checksum ' + meta.checksum + ') ---\n' +
              excerpt +
              (wasTruncated ? '\n[Attachment excerpt truncated; original not fully included in model context.]' : '') +
              '\n--- END ATTACHMENT: ' + name + ' ---'
            );
            remaining -= excerpt.length;
          }
          // Workspace: only small fully-read text
          if (f.size <= MAX_WORKSPACE_TEXT && !wasTruncated && typeof opts.addToWorkspace === 'function') {
            const key = await opts.addToWorkspace(name, textContent);
            if (key) addedWorkspace.push(key);
          }
        } else if (isZipLike(name, mime)) {
          const listed = await listZipEntries(f);
          meta.parserStatus = 'zip-list';
          if (listed.ok) {
            const lines = listed.entries.slice(0, 80).map(function (e) {
              return e.name + ' (' + formatBytes(e.size) + ')';
            });
            const body = 'ZIP/Office package entries (' + listed.entries.length + '):\n' + lines.join('\n') +
              (listed.entries.length > 80 ? '\n… +' + (listed.entries.length - 80) + ' more' : '');
            const room = Math.max(0, remaining);
            const excerpt = body.slice(0, room);
            meta.excerpts = [excerpt];
            meta.note = 'Central-directory listing only; payloads not inflated (mobile RAM).';
            if (excerpt) {
              contextParts.push(
                '--- BEGIN ATTACHMENT: ' + name + ' (zip-list, ' + formatBytes(f.size) + ') ---\n' +
                excerpt + '\n--- END ATTACHMENT: ' + name + ' ---'
              );
              remaining -= excerpt.length;
            }
            if (/\.docx$/i.test(name)) {
              const dx = await extractDocxText(f);
              if (dx.note) meta.note += ' ' + dx.note;
            }
          } else {
            meta.parserStatus = 'error';
            meta.note = listed.error || 'zip parse failed';
            contextParts.push('[Attachment ' + name + ': ' + meta.note + ']');
          }
        } else if (isImage(name, mime)) {
          const im = await imageMeta(f, name);
          meta.parserStatus = 'image-meta';
          meta.note = im.note;
          const line = '[Image attachment: ' + name + '; ' + formatBytes(f.size) + '; ' + im.note +
            '. Pixel data not sent to the model in this build.]';
          if (remaining > 40) {
            contextParts.push(line);
            remaining -= line.length;
          }
          meta.excerpts = [line];
        } else if (isPdf(name, mime)) {
          meta.parserStatus = 'pdf-meta';
          meta.note = 'PDF detected; text/OCR extraction not enabled in this mobile build (metadata only).';
          const line = '[PDF attachment: ' + name + '; ' + formatBytes(f.size) + '; MIME ' + mime +
            '. Contents not decoded — do not claim to have read the PDF body.]';
          if (remaining > 40) {
            contextParts.push(line);
            remaining -= line.length;
          }
          meta.excerpts = [line];
        } else {
          meta.parserStatus = 'binary';
          meta.note = 'Binary; no parser for this type.';
          const line = '[Attachment: ' + name + '; ' + formatBytes(f.size) + '; MIME ' + mime +
            '. Binary content is not decoded. Do not claim to have inspected its contents.]';
          if (remaining > 40) {
            contextParts.push(line);
            remaining -= line.length;
          }
          meta.excerpts = [line];
        }
      } catch (e) {
        meta.parserStatus = 'error';
        meta.note = String((e && e.message) || e);
        contextParts.push('[Attachment ' + name + ' error: ' + meta.note + ']');
      }

      store.set(id, meta);
      lastInspect.push({
        id: meta.id,
        name: meta.name,
        size: meta.size,
        mime: meta.mime,
        status: meta.parserStatus,
        checksum: meta.checksum,
        note: meta.note,
        excerptPreview: (meta.excerpts[0] || '').slice(0, 280)
      });
      if (typeof opts.onProgress === 'function') {
        try { opts.onProgress({ index: i, total: list.length, name: name, phase: 'done', status: meta.parserStatus }); } catch (_) {}
      }
    }

    lastContext = contextParts.join('\n\n').slice(0, MAX_CONTEXT_CHARS);
    return {
      context: lastContext,
      workspaceAdded: addedWorkspace,
      inspect: lastInspect.slice(),
      count: lastInspect.length
    };
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KiB';
    return (n / (1024 * 1024)).toFixed(2) + ' MiB';
  }

  function getLastContext() { return lastContext; }
  function getInspect() { return lastInspect.slice(); }
  function clear() {
    store.clear();
    lastContext = '';
    lastInspect = [];
  }
  function listStore() {
    return Array.from(store.values()).map(function (m) {
      return {
        id: m.id, name: m.name, size: m.size, mime: m.mime,
        parserStatus: m.parserStatus, checksum: m.checksum, note: m.note, addedAt: m.addedAt
      };
    });
  }

  SG.attachments = {
    version: VERSION,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    MAX_CONTEXT_CHARS: MAX_CONTEXT_CHARS,
    processFiles: processFiles,
    getLastContext: getLastContext,
    getInspect: getInspect,
    list: listStore,
    clear: clear,
    formatBytes: formatBytes
  };
})(window.SG = window.SG || {});
