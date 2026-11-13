/**
 * athuex_memory.js - Version 1.0.1
 * Unified client-side Thue memory engine + Athuex WebGL streaming bridge.
 *
 * Exposes:
 *   - ThueMemory      (client-side string-based Thue rewrite engine)
 *   - AthuexBridge    (WebSocket → GPU texture stream, uses a token rewrite table)
 *   - fnv1a32         (deterministic token hashing helper)
 *   - ATHUEX_MEMORY_VERSION
 *
 * CHANGELOG 1.0.1
 *   - FIXED: AthuexBridge._transformToken tried to match string rules like
 *     "user_pref::coffee" against hex digits of a uint32 token. That could
 *     never match. The bridge now uses an explicit Map<number, number> of
 *     token-to-token rewrites. String rules live in ThueMemory (unchanged);
 *     the bridge only does integer lookups, which is O(1) and allocation-free.
 *   - ADDED: AthuexBridge.setTokenRules(map) to install/replace the token
 *     rewrite table at runtime.
 *   - ADDED: fnv1a32() exported so callers can build token maps from hashed
 *     string rules when their upstream tokenizer agrees on the hash.
 *   - REMOVED: the dead hex-substring path and the FNV-1a fold-back (no longer
 *     needed — tokens are passed through or mapped directly).
 */
(function (global) {
    'use strict';

    const VERSION = '1.0.1';

    // ============================================================
    // fnv1a32 — deterministic 32-bit hash of a string.
    // Use this to build token maps from string rules when both sides
    // agree on the hash. Returns an unsigned 32-bit integer.
    // ============================================================
    function fnv1a32(str) {
        let h = 0x811c9dc5 >>> 0;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h >>> 0;
    }

    // ============================================================
    // ThueMemory — client-side rewrite engine (unchanged from 1.0.0)
    // ============================================================
    class ThueMemory {
        constructor(initialState = '', rules = null) {
            this.state = String(initialState || '');
            this.rules = Object.create(null);
            if (rules && typeof rules === 'object') {
                for (const lhs of Object.keys(rules)) {
                    this.addRule(lhs, String(rules[lhs]));
                }
            }
        }

        addRule(lhs, rhs) {
            if (typeof lhs !== 'string' || typeof rhs !== 'string') return false;
            if (lhs.length === 0) return false;
            this.rules[lhs] = rhs;
            return true;
        }

        removeRule(lhs) {
            if (Object.prototype.hasOwnProperty.call(this.rules, lhs)) {
                delete this.rules[lhs];
                return true;
            }
            return false;
        }

        getApplicableRules() {
            const out = {};
            for (const lhs in this.rules) {
                if (this.state.indexOf(lhs) !== -1) out[lhs] = this.rules[lhs];
            }
            return out;
        }

        step(lhs = null) {
            if (lhs === null) {
                for (const k in this.rules) {
                    if (this.state.indexOf(k) !== -1) { lhs = k; break; }
                }
                if (lhs === null) return false;
            }
            if (!Object.prototype.hasOwnProperty.call(this.rules, lhs)) return false;
            if (this.state.indexOf(lhs) === -1) return false;
            this.state = this.state.replace(lhs, this.rules[lhs]);
            return true;
        }

        stepToFixpoint(maxIterations = 10000) {
            let n = 0;
            while (n < maxIterations && this.step()) n++;
            return n;
        }

        setState(s) { this.state = String(s || ''); }

        toJSON() {
            const rules = {};
            for (const k in this.rules) rules[k] = this.rules[k];
            return { version: VERSION, state: this.state, rules };
        }

        static fromJSON(obj) {
            const m = new ThueMemory();
            if (obj && typeof obj === 'object') {
                if (typeof obj.state === 'string') m.state = obj.state;
                if (obj.rules && typeof obj.rules === 'object') {
                    for (const k of Object.keys(obj.rules)) m.addRule(k, String(obj.rules[k]));
                }
            }
            return m;
        }

        /** Parse [NEW_RULE: lhs ::= rhs] and [MUTATE: lhs] tokens from LLM text. */
        processLlmResponse(text) {
            const ruleRe = /\[NEW_RULE:\s*([\s\S]*?)\s*::=\s*([\s\S]*?)\]/g;
            const mutateRe = /\[MUTATE:\s*([\s\S]*?)\s*\]/g;
            let m;
            while ((m = ruleRe.exec(text)) !== null) {
                this.addRule(m[1].trim(), m[2].trim());
            }
            while ((m = mutateRe.exec(text)) !== null) {
                const key = m[1].trim();
                if (key in this.rules && this.state.indexOf(key) !== -1) {
                    this.state = this.state.replace(key, this.rules[key]);
                }
            }
            return text.replace(ruleRe, '').replace(mutateRe, '').trim();
        }

        getRagContext() {
            const applicable = this.getApplicableRules();
            const keys = Object.keys(applicable);
            const lines = [
                `CURRENT MEMORY STATE: ${this.state}`,
                'ACTIVE MEMORY CONSTRAINTS:',
            ];
            if (keys.length === 0) lines.push(' - (none)');
            else for (const k of keys) lines.push(` - If '${k}' is true, it transforms into '${applicable[k]}'`);
            return lines.join('\n');
        }
    }

    // ============================================================
    // AthuexBridge — WebSocket → GPU texture stream + token rewrite
    // ============================================================
    class AthuexBridge {
        constructor(wsUrl, kernelInstance, options = {}) {
            this.wsUrl = wsUrl;
            this.kernel = kernelInstance || null;
            this.memory =
                options.memory instanceof ThueMemory
                    ? options.memory
                    : new ThueMemory(options.initialState || '', options.initialRules || null);

            this.gridSize = Math.max(1, Math.min(2048, options.gridSize | 0 || 512));
            this.maxReconnectDelay = options.maxReconnectDelay || 30000;
            this.heartbeatMs = options.heartbeatMs || 25000;

            // Token rewrite table: Map<uint32, uint32>. Empty = pass-through.
            // Install with `setTokenRules(...)` after construction if you prefer.
            this._tokenRules = new Map();
            if (options.tokenRules) this.setTokenRules(options.tokenRules);

            this.socket = null;
            this._clockTick = 0;
            this._reconnectAttempts = 0;
            this._reconnectTimer = null;
            this._heartbeatTimer = null;
            this._disposed = false;

            this._gpuCacheBuffer = new Uint32Array(this.gridSize * this.gridSize * 4);

            this._log(`Initialised (v${VERSION}, grid=${this.gridSize}, rules=${this._tokenRules.size})`);
            this.connect();
        }

        _log(...a)  { console.log('► [ATHUEX]:', ...a); }
        _warn(...a) { console.warn('▲ [ATHUEX]:', ...a); }
        _err(...a)  { console.error('▲ [ATHUEX]:', ...a); }

        // ---------- token rule table ----------
        /**
         * Install a token-to-token rewrite table.
         * Accepts a Map<number, number>, a plain object { [key]: value },
         * or an array of [key, value] pairs. Keys and values are coerced to
         * unsigned 32-bit integers.
         */
        setTokenRules(rules) {
            this._tokenRules.clear();
            if (!rules) return 0;

            const entries =
                rules instanceof Map ? rules.entries() :
                Array.isArray(rules) ? rules :
                (typeof rules === 'object' ? Object.entries(rules) : null);

            if (!entries) {
                this._err('setTokenRules: unsupported input type');
                return 0;
            }

            let n = 0;
            for (const [k, v] of entries) {
                const key = (Number(k) >>> 0);
                const val = (Number(v) >>> 0);
                if (!Number.isFinite(key) || !Number.isFinite(val)) continue;
                this._tokenRules.set(key, val);
                n++;
            }
            this._log(`setTokenRules: installed ${n} token rewrite(s)`);
            return n;
        }

        clearTokenRules() {
            const n = this._tokenRules.size;
            this._tokenRules.clear();
            return n;
        }

        _transformToken(token) {
            if (this._tokenRules.size === 0) return token >>> 0;
            const mapped = this._tokenRules.get(token >>> 0);
            return mapped === undefined ? (token >>> 0) : mapped;
        }

        // ---------- connection lifecycle ----------
        connect() {
            if (this._disposed) return;
            try {
                const socket = new WebSocket(this.wsUrl);
                socket.binaryType = 'arraybuffer';
                this.socket = socket;

                socket.onopen = () => {
                    if (this._disposed) { try { socket.close(); } catch (e) {} return; }
                    this._reconnectAttempts = 0;
                    this._log(`Connected → ${this.wsUrl}`);
                    this._handshake();
                    this._startHeartbeat();
                };

                socket.onerror = (e) => this._err('Socket error:', e);

                socket.onmessage = (e) => {
                    if (this._disposed) return;
                    if (e.data instanceof ArrayBuffer) this._handleMatrixStream(e.data);
                    else if (typeof e.data === 'string') this._warn('Ignored text frame.');
                };

                socket.onclose = () => {
                    if (this._disposed) return;
                    this._warn('Connection closed — scheduling reconnect.');
                    this._stopHeartbeat();
                    this._scheduleReconnect();
                };
            } catch (e) {
                this._err('Connection init failed:', e);
                this._scheduleReconnect();
            }
        }

        _scheduleReconnect() {
            if (this._disposed || this._reconnectTimer) return;
            this._reconnectAttempts++;
            const delay = Math.min(
                this.maxReconnectDelay,
                500 * Math.pow(2, Math.min(this._reconnectAttempts, 6))
            );
            this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                this.connect();
            }, delay);
        }

        _handshake() {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
            try {
                this.socket.send(JSON.stringify({
                    op: 0x1A, systemStatus: 'BRIDGE_ENGAGED', version: VERSION,
                }));
            } catch (e) { this._err('Handshake failed:', e); }
        }

        _startHeartbeat() {
            this._stopHeartbeat();
            if (!this.heartbeatMs) return;
            this._heartbeatTimer = setInterval(() => {
                if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
                try {
                    this.socket.send(JSON.stringify({ op: 0x1B, tick: this._clockTick }));
                } catch (e) { this._err('Heartbeat failed:', e); }
            }, this.heartbeatMs);
        }

        _stopHeartbeat() {
            if (this._heartbeatTimer) {
                clearInterval(this._heartbeatTimer);
                this._heartbeatTimer = null;
            }
        }

        // ---------- incoming binary stream ----------
        _handleMatrixStream(rawBuf) {
            const view = new Uint32Array(rawBuf);
            this._clockTick++;

            const total = Math.floor(view.length / 3);
            const cap = this.gridSize * this.gridSize;
            const count = Math.min(total, cap);

            this._gpuCacheBuffer.fill(0);

            for (let i = 0; i < count; i++) {
                const s = i * 3, d = i * 4;
                const token   =  view[s]     >>> 0;
                const chapter = (view[s + 1] >>> 0) & 0xFFFF;
                const verse   = (view[s + 2] >>> 0) & 0xFFFF;

                const t = this._transformToken(token);

                this._gpuCacheBuffer[d]     = t;
                this._gpuCacheBuffer[d + 1] = ((chapter << 16) | verse) >>> 0;
                this._gpuCacheBuffer[d + 2] = ((t ^ (chapter + verse)) & 0xFF) >>> 0;
                this._gpuCacheBuffer[d + 3] = 0xFFFFFFFF;
            }

            this._injectToKernel();
        }

        _injectToKernel() {
            if (!this.kernel) return;
            try {
                const r = this.kernel._0xRASTER;
                if (r && typeof r._0xSYNC_HARDWARE_GRID === 'function') {
                    r._0xSYNC_HARDWARE_GRID(this._gpuCacheBuffer, this._clockTick, true);
                } else if (typeof this.kernel._0xMAP_PIXEL_DATA === 'function') {
                    this.kernel._0xMAP_PIXEL_DATA(this._gpuCacheBuffer);
                }
            } catch (e) {
                this._err('Kernel injection failed:', e);
            }
        }

        // ---------- outbound ----------
        transmitInteractionTick(chapter, verse, inputToken) {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
            try {
                const packet = new Uint32Array([
                    inputToken >>> 0, chapter >>> 0, verse >>> 0,
                ]);
                this.socket.send(packet.buffer);
                return true;
            } catch (e) {
                this._err('Transmit failed:', e);
                return false;
            }
        }

        // ---------- teardown ----------
        dispose() {
            this._disposed = true;
            this._stopHeartbeat();
            if (this._reconnectTimer) {
                clearTimeout(this._reconnectTimer);
                this._reconnectTimer = null;
            }
            if (this.socket) {
                try { this.socket.close(); } catch (e) {}
                this.socket = null;
            }
            this._tokenRules.clear();
        }
    }

    global.ThueMemory            = ThueMemory;
    global.AthuexBridge          = AthuexBridge;
    global.fnv1a32               = fnv1a32;
    global.ATHUEX_MEMORY_VERSION = VERSION;
})(typeof self !== 'undefined' ? self : globalThis);