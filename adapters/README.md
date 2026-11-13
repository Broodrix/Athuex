# Athuex Harness Adapters (P6)

Modular plugins that extend the Termux llama-server harness (`js/ai/harness.js`).

## Design

- Each adapter is a plain script that registers one or more plugins via `SG.harness.registerPlugin` or `SG_REGISTER_HARNESS_PLUGIN`.
- Adapters are **disabled by default** except core safety plugins already in `harness.js`.
- User enables/disables them from the **Harness Adapters** UI (grid) or via tools.
- Enabled state is persisted in `localStorage` under `athuex.harness.adapters`.
- Workspace scan still loads `harness/*.js` and `*.harness.js` from the VFS for experimental user adapters (not auto-enabled).

## Built-in catalog

| id | Purpose |
|----|---------|
| consciousness | Adds structured reflection / meta-cognition guidance to the system message for deeper local reasoning. |
| neuromorphic | Light adaptive sampling: slightly lowers temperature on long histories to reduce drift on 4 GB devices. |
| thermodynamic | Thermal-aware sampling bias for Galaxy A06 / Helio G85: prefers cooler, shorter generations under long context. |
| spatial_memory | Injects a short spatial/workspace memory reminder so the model prefers memory + VFS tools when relevant. |
| sia | Self-Improving AI: richer trace recording into hybrid_traces / memory after successful local completions. |
| continuous_learning | BeforeRequest retrieval of recent successful solution traces to seed the prompt (no weight updates). |

## Adding a custom adapter

1. Place a `.js` file under `adapters/` (shipped) or under workspace `harness/` / `*.harness.js`.
2. Call `SG_REGISTER_HARNESS_PLUGIN({ id, version, description, enabled: false, beforeRequest, afterResponse })`.
3. Open Harness Adapters UI and enable it, or call `SG.harness.enablePlugin(id, true)`.

Do not enable experimental logit mutation (`onLogits`) unless you understand the risks; it remains feature-flagged off by default.
