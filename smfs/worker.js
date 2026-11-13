/* SMFS engine worker — exclusive filesystem + ZIP polyglot export/import */
'use strict';

const files = new Map(); // path -> { bytes: Uint8Array, crc: number }
let volumeName = 'workspace';
let sizeMB = 32;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function normPath(p) {
  let s = String(p || '/').replace(/\\/g, '/');
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/\/+/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

self.onmessage = async (e) => {
  const { op, id, payload } = e.data || {};
  try {
    let result;
    switch (op) {
      case 'mount': result = mount(payload || {}); break;
      case 'read': result = read((payload && payload.path) || '/'); break;
      case 'write': result = write((payload && payload.path) || '/', (payload && payload.content) || '', payload && payload.expectedCrc); break;
      case 'list': result = list((payload && payload.path) || '/'); break;
      case 'walk': result = walk(); break;
      case 'remove': result = remove((payload && payload.path) || '/'); break;
      case 'export': result = await exportZip(); break;
      case 'import': result = await importZip(payload && payload.bytes); break;
      case 'stat': result = { fileCount: files.size, sizeMB, volumeName }; break;
      default: throw new Error('unknown op: ' + op);
    }
    // transfer zip bytes if present
    if (result && result.bytes && result.bytes.buffer) {
      self.postMessage({ id, ok: true, result }, [result.bytes.buffer]);
    } else {
      self.postMessage({ id, ok: true, result });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};

function mount(opts) {
  sizeMB = Math.max(1, Math.min(128, Number(opts.sizeMB) || 32));
  volumeName = String(opts.name || 'workspace');
  if (opts.clear) files.clear();
  if (files.size === 0) {
    const welcome = new TextEncoder().encode(
      '# Athuex SMFS\n\nPortable volume ready. Ask the AI to create files, or Import an .ssf.\n'
    );
    files.set('/WELCOME.md', { bytes: welcome, crc: crc32(welcome) });
  }
  return { ok: true, sizeMB, fileCount: files.size, mode: 'exclusive' };
}

function read(path) {
  path = normPath(path);
  const node = files.get(path);
  if (!node) throw new Error('ENOENT: ' + path);
  const content = new TextDecoder().decode(node.bytes);
  return { content, crc: node.crc, size: node.bytes.length, path };
}

function write(path, content, expectedCrc) {
  path = normPath(path);
  if (path === '/') throw new Error('cannot write root');
  const existing = files.get(path);
  if (existing && expectedCrc !== undefined && expectedCrc !== null) {
    if (existing.crc !== Number(expectedCrc)) {
      throw new Error('conflict: crc mismatch (file changed since last read)');
    }
  }
  const bytes = new TextEncoder().encode(String(content == null ? '' : content));
  const maxBytes = sizeMB * 1024 * 1024;
  let used = 0;
  files.forEach((n, p) => { if (p !== path) used += n.bytes.length; });
  if (used + bytes.length > maxBytes) throw new Error('ENOSPC: volume limit ' + sizeMB + ' MB');
  const crc = crc32(bytes);
  files.set(path, { bytes, crc });
  return { crc, path, size: bytes.length };
}

function list(path) {
  path = normPath(path);
  const children = [];
  const prefix = path === '/' ? '/' : path + '/';
  files.forEach((node, p) => {
    if (path === '/') {
      const rest = p.slice(1);
      if (!rest.includes('/')) {
        children.push({ path: p, name: rest, type: 1, size: node.bytes.length, hash: node.crc });
      } else {
        const top = rest.split('/')[0];
        if (!children.some((c) => c.name === top && c.type === 2)) {
          children.push({ path: '/' + top, name: top, type: 2, size: 0, hash: 0 });
        }
      }
    } else if (p.startsWith(prefix)) {
      const rest = p.slice(prefix.length);
      if (!rest.includes('/')) {
        children.push({ path: p, name: rest, type: 1, size: node.bytes.length, hash: node.crc });
      }
    }
  });
  children.sort((a, b) => a.name.localeCompare(b.name));
  return { children };
}

function walk() {
  const out = [];
  files.forEach((node, path) => {
    out.push({ path, size: node.bytes.length, crc: node.crc });
  });
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function remove(path) {
  path = normPath(path);
  if (!files.has(path)) throw new Error('ENOENT: ' + path);
  files.delete(path);
  return { ok: true, path };
}

/* ── ZIP (store / deflate-raw when available) ── */
const enc = new TextEncoder();

async function deflateRaw(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (_) {
    return null;
  }
}

async function inflateRaw(u8) {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (_) {
    return null;
  }
}

async function exportZip() {
  const names = [];
  files.forEach((_, p) => names.push(p.replace(/^\//, '') || 'root.txt'));
  names.sort();
  const parts = [];
  const cd = [];
  const now = new Date();
  const dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dd = (((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  let off = 0;

  for (const name of names) {
    const path = '/' + name;
    const node = files.get(path) || files.get(name);
    const raw = node ? node.bytes : new Uint8Array(0);
    const crc = node ? node.crc : crc32(raw);
    let data = await deflateRaw(raw);
    let method = 8;
    if (!data || data.length >= raw.length) { data = raw; method = 0; }
    const nb = enc.encode(name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, method, true);
    lh.setUint16(10, dt, true);
    lh.setUint16(12, dd, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, raw.length, true);
    lh.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(lh.buffer), nb, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true);
    ch.setUint16(12, dt, true);
    ch.setUint16(14, dd, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, raw.length, true);
    ch.setUint16(28, nb.length, true);
    ch.setUint32(42, off, true);
    cd.push(new Uint8Array(ch.buffer), nb);
    off += 30 + nb.length + data.length;
  }

  let cdLen = 0;
  cd.forEach((x) => { cdLen += x.length; });
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, names.length, true);
  eocd.setUint16(10, names.length, true);
  eocd.setUint32(12, cdLen, true);
  eocd.setUint32(16, off, true);

  const total = off + cdLen + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  for (const p of cd) { out.set(p, pos); pos += p.length; }
  out.set(new Uint8Array(eocd.buffer), pos);
  return { bytes: out, fileCount: names.length, size: out.length };
}

async function importZip(input) {
  if (!input) throw new Error('no data');
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  }
  if (e < 0) throw new Error('Not a valid ZIP/.ssf');
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const td = new TextDecoder();
  const next = new Map();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt ZIP directory');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true);
    const xl = dv.getUint16(p + 30, true);
    const cl = dv.getUint16(p + 32, true);
    const lo = dv.getUint32(p + 42, true);
    const name = td.decode(buf.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (!name || name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
    if (dv.getUint32(lo, true) !== 0x04034b50) continue;
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    let d = buf.subarray(ds, ds + csize);
    if (method === 8) {
      const inflated = await inflateRaw(d);
      if (!inflated) continue;
      d = inflated;
    } else if (method !== 0) continue;
    const bytes = new Uint8Array(d);
    const path = normPath(name);
    next.set(path, { bytes, crc: crc32(bytes) });
  }
  files.clear();
  next.forEach((v, k) => files.set(k, v));
  if (files.size === 0) throw new Error('No files in archive');
  return { ok: true, fileCount: files.size };
}
