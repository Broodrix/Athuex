/* Athuex Memory tools — Thue rewrite memory for the agent — v1.0.1 */
(function (SG) {
  'use strict';
  const R = SG.toolsRegistry;
  if (!R) return;

  const LS_KEY = 'athuex.memory.state';
  let mem = null;

  function ensure() {
    if (mem) return mem;
    if (typeof ThueMemory === 'undefined') {
      // Minimal fallback if script not loaded
      mem = {
        state: '',
        rules: Object.create(null),
        addRule: function (lhs, rhs) { if (lhs) this.rules[lhs] = String(rhs || ''); return true; },
        removeRule: function (lhs) { delete this.rules[lhs]; return true; },
        step: function () { return false; },
        stepToFixpoint: function () { return 0; },
        setState: function (s) { this.state = String(s || ''); },
        getRagContext: function () {
          return 'CURRENT MEMORY STATE: ' + this.state + '\nACTIVE MEMORY CONSTRAINTS:\n - (none — ThueMemory runtime not loaded)';
        },
        processLlmResponse: function (t) { return t; },
        toJSON: function () { return { state: this.state, rules: this.rules }; }
      };
    } else {
      mem = new ThueMemory();
    }
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (typeof ThueMemory !== 'undefined' && ThueMemory.fromJSON) {
          mem = ThueMemory.fromJSON(obj);
        } else {
          mem.state = obj.state || '';
          mem.rules = obj.rules || Object.create(null);
        }
      }
    } catch (_) {}
    return mem;
  }

  function persist() {
    try {
      const m = ensure();
      const data = typeof m.toJSON === 'function' ? m.toJSON() : { state: m.state, rules: m.rules };
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function getContext() {
    const m = ensure();
    return typeof m.getRagContext === 'function' ? m.getRagContext() : '';
  }

  function absorbAssistantText(text) {
    const m = ensure();
    if (typeof m.processLlmResponse === 'function') {
      const cleaned = m.processLlmResponse(String(text || ''));
      persist();
      return cleaned;
    }
    return text;
  }

  R.register({
    name: 'memory_get',
    description: 'Read Athuex long-term memory: current state string and active Thue rewrite rules. Use before answering questions about prior preferences or project conventions.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async function () {
      const m = ensure();
      const rules = {};
      const src = m.rules || {};
      for (const k in src) rules[k] = src[k];
      return {
        state: m.state || '',
        rules: rules,
        context: getContext()
      };
    }
  });

  R.register({
    name: 'memory_set_state',
    description: 'Replace the Athuex memory state string (short summary of user preferences, project facts, conventions).',
    parameters: {
      type: 'object',
      properties: {
        state: { type: 'string', description: 'New memory state text' }
      },
      required: ['state']
    },
    handler: async function (args) {
      const m = ensure();
      if (typeof m.setState === 'function') m.setState(args.state);
      else m.state = String(args.state || '');
      persist();
      return { ok: true, state: m.state };
    }
  });

  R.register({
    name: 'memory_add_rule',
    description: 'Add a Thue rewrite rule: when lhs appears in memory state it can become rhs. Example lhs="prefer tabs", rhs="user prefers tab indentation".',
    parameters: {
      type: 'object',
      properties: {
        lhs: { type: 'string', description: 'Left-hand side (pattern)' },
        rhs: { type: 'string', description: 'Right-hand side (replacement / meaning)' }
      },
      required: ['lhs', 'rhs']
    },
    handler: async function (args) {
      const m = ensure();
      const ok = m.addRule(String(args.lhs || ''), String(args.rhs || ''));
      persist();
      return { ok: !!ok, lhs: args.lhs, rhs: args.rhs };
    }
  });

  R.register({
    name: 'memory_remove_rule',
    description: 'Remove a Thue rewrite rule by lhs.',
    parameters: {
      type: 'object',
      properties: { lhs: { type: 'string' } },
      required: ['lhs']
    },
    handler: async function (args) {
      const m = ensure();
      const ok = m.removeRule(String(args.lhs || ''));
      persist();
      return { ok: !!ok };
    }
  });

  R.register({
    name: 'memory_step',
    description: 'Apply one or more Thue rewrite steps to the memory state (optional specific lhs).',
    parameters: {
      type: 'object',
      properties: {
        lhs: { type: 'string', description: 'Optional specific rule to apply' },
        fixpoint: { type: 'boolean', description: 'If true, step until no rules apply (max 1000)' }
      },
      required: []
    },
    handler: async function (args) {
      const m = ensure();
      let steps = 0;
      if (args && args.fixpoint) {
        steps = typeof m.stepToFixpoint === 'function' ? m.stepToFixpoint(1000) : 0;
      } else {
        const ok = typeof m.step === 'function' ? m.step(args && args.lhs ? args.lhs : null) : false;
        steps = ok ? 1 : 0;
      }
      persist();
      return { steps: steps, state: m.state };
    }
  });

  // Public helpers for app.js system prompt injection
  SG.memory = {
    ensure: ensure,
    getContext: getContext,
    absorbAssistantText: absorbAssistantText,
    persist: persist
  };
})(window.SG = window.SG || {});
