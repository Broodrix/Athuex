/* IndexedDB + localStorage chat history — Athuex v1.0.0 */
(function (SG) {
  'use strict';
  const DB_NAME = 'AthuexDB';
  const DB_VERSION = 3;
  const LS_CHATS = 'athuex.chats';
  const LS_MSGS = 'athuex.msgs';
  // Legacy keys for one-time migration
  const LEGACY_CHATS = ['sg.chats_v130', 'sg.chats_v129', 'sg.chats'];
  const LEGACY_MSGS = ['sg.msgs_v130', 'sg.msgs_v129', 'sg.msgs'];
  let db = null, idbOk = false;

  function open() {
    return new Promise(function (resolve) {
      if (db && idbOk) { resolve(true); return; }
      if (!('indexedDB' in window)) { idbOk = false; resolve(true); return; }
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { idbOk = false; resolve(true); return; }
      req.onerror = function () { idbOk = false; resolve(true); };
      req.onblocked = function () { idbOk = false; resolve(true); };
      req.onupgradeneeded = function (e) {
        const d = e.target.result;
        if (d.objectStoreNames.contains('chats')) try { d.deleteObjectStore('chats'); } catch (_) {}
        if (d.objectStoreNames.contains('messages')) try { d.deleteObjectStore('messages'); } catch (_) {}
        d.createObjectStore('chats', { keyPath: 'id' });
        const ms = d.createObjectStore('messages', { keyPath: 'id' });
        ms.createIndex('chatId', 'chatId', { unique: false });
      };
      req.onsuccess = function (e) {
        db = e.target.result; idbOk = true;
        db.onversionchange = function () { try { db.close(); } catch (_) {} db = null; idbOk = false; };
        resolve(true);
      };
    });
  }
  function idbRun(storeName, mode, work) {
    return new Promise(function (resolve) {
      if (!db || !idbOk) { resolve({ ok: false, result: null }); return; }
      try {
        const t = db.transaction(storeName, mode);
        const req = work(t.objectStore(storeName));
        let result = null;
        if (req) req.onsuccess = function () { result = req.result; };
        t.oncomplete = function () { resolve({ ok: true, result: result }); };
        t.onerror = t.onabort = function () { resolve({ ok: false, result: null }); };
      } catch (e) { resolve({ ok: false, result: null }); }
    });
  }
  function lsRead(key, fb) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fb; } catch (_) { return fb; }
  }
  function lsWrite(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (_) { return false; }
  }
  function migrateLegacy(primaryKey, legacyKeys, fallback) {
    let data = lsRead(primaryKey, null);
    if (data != null) return data;
    for (let i = 0; i < legacyKeys.length; i++) {
      data = lsRead(legacyKeys[i], null);
      if (data != null) {
        lsWrite(primaryKey, data);
        return data;
      }
    }
    return fallback;
  }
  async function saveChat(chat) {
    if (!chat || chat.id == null) return null;
    chat = Object.assign({}, chat, { id: String(chat.id) });
    const list = lsRead(LS_CHATS, []);
    const idx = list.findIndex(function (c) { return String(c.id) === chat.id; });
    if (idx >= 0) list[idx] = chat; else list.push(chat);
    lsWrite(LS_CHATS, list);
    if (idbOk) await idbRun('chats', 'readwrite', function (s) { return s.put(chat); });
    return chat.id;
  }
  async function loadChats() {
    if (idbOk) {
      const r = await idbRun('chats', 'readonly', function (s) { return s.getAll(); });
      if (r.ok && Array.isArray(r.result) && r.result.length) { lsWrite(LS_CHATS, r.result); return r.result; }
    }
    return migrateLegacy(LS_CHATS, LEGACY_CHATS, []);
  }
  async function deleteChat(id) {
    if (id == null) return false;
    id = String(id);
    lsWrite(LS_CHATS, lsRead(LS_CHATS, []).filter(function (c) { return String(c.id) !== id; }));
    if (idbOk) await idbRun('chats', 'readwrite', function (s) { return s.delete(id); });
    return true;
  }
  async function saveMessage(msg) {
    if (!msg || msg.id == null) return null;
    msg = Object.assign({}, msg, { id: String(msg.id), chatId: String(msg.chatId) });
    const all = lsRead(LS_MSGS, []);
    const idx = all.findIndex(function (m) { return String(m.id) === msg.id; });
    if (idx >= 0) all[idx] = msg; else all.push(msg);
    while (all.length > 2000) all.shift();
    lsWrite(LS_MSGS, all);
    if (idbOk) await idbRun('messages', 'readwrite', function (s) { return s.put(msg); });
    return msg.id;
  }
  async function loadMessages(chatId) {
    if (chatId == null) {
      if (idbOk) { const r = await idbRun('messages', 'readonly', function (s) { return s.getAll(); }); if (r.ok && Array.isArray(r.result)) return r.result; }
      return migrateLegacy(LS_MSGS, LEGACY_MSGS, []);
    }
    chatId = String(chatId);
    if (idbOk) {
      const r = await idbRun('messages', 'readonly', function (s) {
        try { return s.index('chatId').getAll(chatId); } catch (e) { return s.getAll(); }
      });
      if (r.ok && Array.isArray(r.result) && r.result.length) return r.result.filter(function (m) { return String(m.chatId) === chatId; });
    }
    return migrateLegacy(LS_MSGS, LEGACY_MSGS, []).filter(function (m) { return String(m.chatId) === chatId; });
  }
  async function deleteMessagesForChat(chatId) {
    if (chatId == null) return false;
    chatId = String(chatId);
    lsWrite(LS_MSGS, lsRead(LS_MSGS, []).filter(function (m) { return String(m.chatId) !== chatId; }));
    if (!idbOk || !db) return true;
    return new Promise(function (resolve) {
      try {
        const t = db.transaction('messages', 'readwrite');
        const store = t.objectStore('messages');
        const idx = store.index('chatId');
        const req = idx.openCursor(IDBKeyRange.only(chatId));
        req.onsuccess = function (e) {
          const cursor = e.target.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };
        t.oncomplete = function () { resolve(true); };
        t.onerror = t.onabort = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
  }

  SG.store = {
    open: open,
    saveChat: saveChat,
    loadChats: loadChats,
    deleteChat: deleteChat,
    saveMessage: saveMessage,
    loadMessages: loadMessages,
    deleteMessagesForChat: deleteMessagesForChat
  };
})(window.SG = window.SG || {});
