/* IDE module: language definitions & defaults. See programsRegistry.register() in programs/ide.js */
(function (SG) {
  'use strict';
  SG.ide = SG.ide || {};

  function makeLang(cfg) {
    cfg.keywordSet = new Set(cfg.keywords || []);
    cfg.builtinSet = new Set(cfg.builtins || []);
    cfg.typeSet = new Set(cfg.types || []);
    return cfg;
  }

  var LANGS = {
    text: makeLang({
      name: 'Plain Text', ext: ['txt', 'log'], tabSize: 2,
      lineComment: null, blockComment: null, keywords: [], builtins: [], types: []
    }),
    markdown: makeLang({
      name: 'Markdown', ext: ['md', 'markdown'], tabSize: 2,
      lineComment: '<!--', blockComment: null, keywords: [], builtins: [], types: []
    }),
    html: makeLang({
      name: 'HTML', ext: ['html', 'htm', 'xml', 'svg'], tabSize: 2,
      lineComment: null, blockComment: ['<!--', '-->'], autoIndentHtml: true,
      keywords: [], builtins: [], types: []
    }),
    css: makeLang({
      name: 'CSS', ext: ['css', 'scss', 'less'], tabSize: 2,
      lineComment: null, blockComment: ['/*', '*/'],
      keywords: [], builtins: [], types: []
    }),
    javascript: makeLang({
      name: 'JavaScript', ext: ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'], tabSize: 2,
      lineComment: '//', blockComment: ['/*', '*/'], backtick: true,
      keywords: ['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'async', 'await', 'of', 'static', 'get', 'set', 'true', 'false', 'null', 'undefined', 'NaN', 'Infinity'],
      types: ['any', 'unknown', 'never', 'void', 'string', 'number', 'boolean', 'object', 'symbol', 'bigint'],
      builtins: ['console', 'document', 'window', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Date', 'RegExp', 'Error', 'parseInt', 'parseFloat', 'isNaN', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'fetch', 'localStorage', 'sessionStorage', 'navigator', 'location', 'history', 'alert', 'confirm', 'prompt']
    }),
    json: makeLang({
      name: 'JSON', ext: ['json'], tabSize: 2,
      lineComment: null, blockComment: null,
      keywords: ['true', 'false', 'null'], builtins: [], types: []
    }),
    c: makeLang({
      name: 'C', ext: ['c', 'h'], tabSize: 4,
      lineComment: '//', blockComment: ['/*', '*/'],
      keywords: ['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while', '_Bool', '_Complex', '_Imaginary'],
      types: ['size_t', 'ssize_t', 'ptrdiff_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'FILE', 'va_list'],
      builtins: ['printf', 'fprintf', 'sprintf', 'snprintf', 'scanf', 'sscanf', 'malloc', 'calloc', 'realloc', 'free', 'memcpy', 'memset', 'strlen', 'strcpy', 'strncpy', 'strcmp', 'strncmp', 'fopen', 'fclose', 'fread', 'fwrite', 'exit']
    }),
    cpp: makeLang({
      name: 'C++', ext: ['cpp', 'cc', 'cxx', 'hpp', 'hxx'], tabSize: 4,
      lineComment: '//', blockComment: ['/*', '*/'],
      keywords: ['alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand', 'bitor', 'bool', 'break', 'case', 'catch', 'char', 'char8_t', 'char16_t', 'char32_t', 'class', 'compl', 'concept', 'const', 'consteval', 'constexpr', 'constinit', 'const_cast', 'continue', 'co_await', 'co_return', 'co_yield', 'decltype', 'default', 'delete', 'do', 'double', 'dynamic_cast', 'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'noexcept', 'not', 'not_eq', 'nullptr', 'operator', 'or', 'or_eq', 'private', 'protected', 'public', 'register', 'reinterpret_cast', 'requires', 'return', 'short', 'signed', 'sizeof', 'static', 'static_assert', 'static_cast', 'struct', 'switch', 'template', 'this', 'thread_local', 'throw', 'true', 'try', 'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'wchar_t', 'while', 'xor', 'xor_eq'],
      types: ['std', 'string', 'wstring', 'vector', 'map', 'unordered_map', 'set', 'unordered_set', 'unique_ptr', 'shared_ptr', 'weak_ptr', 'size_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t'],
      builtins: ['cout', 'cin', 'cerr', 'endl', 'printf', 'fprintf', 'sprintf', 'snprintf', 'malloc', 'free', 'memcpy', 'memset', 'strlen', 'strcpy', 'strcmp', 'make_unique', 'make_shared', 'move', 'forward']
    }),
    java: makeLang({
      name: 'Java', ext: ['java'], tabSize: 4,
      lineComment: '//', blockComment: ['/*', '*/'],
      keywords: ['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null', 'var', 'record', 'sealed', 'permits', 'yield'],
      types: ['String', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Object', 'List', 'Map', 'Set', 'ArrayList', 'HashMap', 'HashSet', 'Exception', 'RuntimeException', 'Thread', 'Runnable'],
      builtins: ['System', 'out', 'println', 'print', 'printf', 'Math', 'Arrays', 'Collections', 'Objects', 'Optional', 'Stream']
    }),
    bash: makeLang({
      name: 'Bash', ext: ['sh', 'bash', 'zsh'], tabSize: 2,
      lineComment: '#', blockComment: null,
      keywords: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'function', 'in', 'select', 'time', 'coproc', 'break', 'continue', 'return', 'exit', 'export', 'local', 'readonly', 'declare', 'typeset', 'unset', 'shift', 'source', 'alias', 'unalias', 'echo', 'printf', 'read', 'cd', 'pwd', 'test', 'true', 'false'],
      types: [], builtins: ['grep', 'sed', 'awk', 'cut', 'sort', 'uniq', 'head', 'tail', 'cat', 'ls', 'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'chmod', 'chown', 'git', 'npm', 'node', 'python', 'curl', 'wget']
    }),
    sql: makeLang({
      name: 'SQL', ext: ['sql'], tabSize: 2,
      lineComment: '--', blockComment: ['/*', '*/'],
      keywords: ['select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'drop', 'alter', 'add', 'column', 'index', 'view', 'join', 'inner', 'left', 'right', 'full', 'outer', 'on', 'group', 'by', 'order', 'having', 'limit', 'offset', 'union', 'all', 'distinct', 'as', 'and', 'or', 'not', 'null', 'is', 'in', 'between', 'like', 'exists', 'case', 'when', 'then', 'else', 'end', 'primary', 'key', 'foreign', 'references', 'default', 'unique', 'check', 'constraint', 'begin', 'commit', 'rollback', 'transaction'],
      types: ['int', 'integer', 'varchar', 'char', 'text', 'date', 'datetime', 'timestamp', 'decimal', 'numeric', 'float', 'double', 'boolean', 'blob'],
      builtins: ['count', 'sum', 'avg', 'min', 'max', 'coalesce', 'cast', 'convert', 'now']
    }),
    csv: makeLang({
      name: 'CSV', ext: ['csv'], tabSize: 2,
      lineComment: null, blockComment: null, keywords: [], builtins: [], types: []
    })
  };

  var LANG_BY_EXT = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'javascript', tsx: 'javascript',
    json: 'json',
    c: 'c', h: 'c',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
    java: 'java',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    sql: 'sql',
    html: 'html', htm: 'html', xml: 'html', svg: 'html',
    css: 'css', scss: 'css', less: 'css',
    md: 'markdown', markdown: 'markdown',
    csv: 'csv',
    txt: 'text', log: 'text'
  };

  var DEFAULT_PREFS = {
    theme: 'dark',
    fontSize: 13,
    wrap: false,
    lineNumbers: true,
    autoSave: true,
    sidebar: true,
    languageOverrides: {}
  };

  function languageForPath(path) {
    var state = SG.ide.state;
    if (state && state.prefs && state.prefs.languageOverrides && state.prefs.languageOverrides[path]) {
      return state.prefs.languageOverrides[path];
    }
    return LANG_BY_EXT[SG.ide.utils.extname(path)] || 'text';
  }

  function langConfig(lang) {
    return LANGS[lang] || LANGS.text;
  }

  SG.ide.config = {
    LANGS: LANGS,
    LANG_BY_EXT: LANG_BY_EXT,
    DEFAULT_PREFS: DEFAULT_PREFS,
    languageForPath: languageForPath,
    langConfig: langConfig,
    VERSION: '2.0.0',
    VFS_KEY: 'sg.ide.vfs.v2',
    SESSION_KEY: 'sg.ide.session.v2',
    PREFS_KEY: 'sg.ide.prefs.v2',
    MAX_HIGHLIGHT: 260000,
    WELCOME_MD: [
      '# IDE',
      '',
      'A multi-tab editor with syntax highlighting, file explorer, find/replace,',
      'command palette and live preview.',
      '',
      '## Shortcuts',
      '',
      '- Ctrl+S         save',
      '- Ctrl+F         find',
      '- Ctrl+H         replace',
      '- Ctrl+Shift+P   command palette',
      '- Ctrl+/         toggle comment',
      '- Ctrl+Space     suggestions',
      '- Alt+Up/Down    move line',
      '- Ctrl+G         goto line',
      '',
      '## Supported languages',
      '',
      'C, C++, Java, JavaScript, Bash, SQL, HTML, CSS, Markdown, JSON, CSV, plain text.',
      '',
      'Open the command palette (Ctrl+Shift+P) to start.',
      ''
    ].join('\n')
  };
})(window.SG = window.SG || {});