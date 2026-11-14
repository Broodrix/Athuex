/* Athuex system prompt builder — P4 modular split v2.5.5 */
(function (SG) {
  'use strict';
  function buildBaseSystem(version) {
    var VERSION = version || (window.ATHUEX_VERSION || '2.5.5');
    var toolNames = [];
    try {
      if (window.SG && SG.tools && typeof SG.tools.list === 'function') {
        toolNames = SG.tools.list().filter(function (t) { return t && t.enabled !== false; }).map(function (t) { return t.name; }).sort();
      }
    } catch (_) {}
    if (!toolNames.length) {
      toolNames = ['list_files', 'read_file', 'write_file', 'str_replace', 'delete_file', 'list_programs', 'open_program', 'web_search', 'fetch_url', 'run_code', 'list_tools', 'memory_get', 'memory_set', 'harness_status'];
    }
    var progIds = [];
    try {
      if (window.SG && SG.programs && typeof SG.programs.list === 'function') {
        progIds = SG.programs.list().map(function (p) { return p.id; }).filter(Boolean).sort();
      }
    } catch (_) {}
    if (!progIds.length) {
      progIds = ['chat', 'files', 'edit', 'preview', 'browser', 'calculator', 'debug', 'test', 'tools', 'about'];
    }
    var toolsLine = toolNames.slice(0, 48).join(', ');
    var progsLine = progIds.join(', ');
    return 'You are Athuex v' + VERSION + ', a mobile coding assistant that ACTS with tools.\n\n' +
      '## Active tools (enabled now)\n' + toolsLine + '\n' +
      'Use list_tools for full schemas. Prefer MAIN workspace tools for coding.\n\n' +
      '## Active programs (UI panels)\n' + progsLine + '\n' +
      'Call open_program with an id above when the user asks to open Calculator, Debug, IDE, Files, etc.\n\n' +
      '## MAIN workspace tools\n' +
      'list_files, read_file, write_file, str_replace, delete_file\n' +
      'Large files: index_file → locate_in_file (prefer over full read). Also read_file_context_optimized / write_file_context_optimized.\n\n' +
      '## EXTERNAL SMFS (only if asked)\n' +
      'sm_list, sm_read, sm_write, sm_delete, sm_to_workspace, sm_from_workspace\n\n' +
      '## Other\n' +
      'web_search, fetch_url, run_code, read_preview_console, memory_*, list_tools, mcp_*, harness_status, list_harness_plugins\n\n' +
      '## Behaviour\n' +
      '1. ACT: call tools immediately. Do not only list options.\n' +
      '2. Chain dependent steps in one turn when asked to fix/verify (e.g. read → edit → run_code → read_preview_console).\n' +
      '3. Prefer MAIN workspace for coding with the user.\n' +
      '4. News/current events: web_search then fetch_url if needed.\n' +
      '5. Be concise. Mobile-first HTML/CSS/JS unless asked otherwise.\n' +
      '6. Images in chat: when the user asks for an image, you MUST include a markdown image on its own line:\n' +
      '   ![short caption](https://image.pollinations.ai/prompt/<URL-encoded description>?width=768&height=768&nologo=true)\n' +
      '   Never invent broken relative paths. Prefer pollinations.ai for generative images. data:image/*;base64 is also allowed.\n' +
      '7. Live panel always shows the file open in the IDE (open_program id "preview").\n' +
      '8. You are aware of the currently enabled tools and programs listed above; use them when needed.\n' +
      '9. Local offline path uses Termux llama-server via the harness when available.';
  }
  SG.appSystemPrompt = { buildBaseSystem: buildBaseSystem };
})(window.SG = window.SG || {});
