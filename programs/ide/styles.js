/* IDE module: CSS. See programsRegistry.register() in programs/ide.js */
(function (SG) {
  'use strict';
  SG.ide = SG.ide || {};

  var STYLES = `
.ide-shell{
  --ide-bg:#0d1117;--ide-bg-elev:#161b22;--ide-bg-elev2:#1c2128;
  --ide-border:#30363d;--ide-text:#c9d1d9;--ide-muted:#8b949e;
  --ide-accent:#73b300;--ide-accent-2:#2ea043;--ide-danger:#f85149;
  --ide-warn:#d29922;--ide-sel:rgba(115,179,0,.28);
  --ide-font-size:13px;
  --ide-font:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
  color-scheme:dark;
}
.ide-shell[data-theme="light"]{
  --ide-bg:#ffffff;--ide-bg-elev:#f6f8fa;--ide-bg-elev2:#eaeef2;
  --ide-border:#d0d7de;--ide-text:#1f2328;--ide-muted:#656d76;
  --ide-accent:#1a7f37;--ide-accent-2:#1f883d;--ide-danger:#cf222e;
  --ide-warn:#9a6700;--ide-sel:rgba(26,127,55,.18);
  color-scheme:light;
}
.ide-shell,.ide-shell *{box-sizing:border-box;}
.ide-shell{position:absolute;inset:0;display:flex;background:var(--ide-bg);color:var(--ide-text);font-family:var(--ide-font);font-size:var(--ide-font-size);overflow:hidden;z-index:5;direction:ltr;text-align:left;}
.ide-panel-host{position:relative;}
.ide-shell.sidebar-collapsed .ide-sidebar{display:none;}
.ide-sidebar{width:232px;flex:0 0 232px;display:flex;flex-direction:column;min-height:0;background:var(--ide-bg-elev);border-right:1px solid var(--ide-border);}
.ide-sidebar-head{display:flex;align-items:center;justify-content:space-between;gap:4px;padding:8px 10px;border-bottom:1px solid var(--ide-border);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ide-muted);}
.ide-sidebar-actions{display:flex;gap:2px;}
.ide-sidebar-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ide-tree{flex:1;overflow:auto;padding:4px 0;overscroll-behavior:contain;}
.ide-tree-row{display:flex;align-items:center;gap:6px;min-height:32px;padding:0 8px;cursor:pointer;font-size:12px;color:var(--ide-text);white-space:nowrap;user-select:none;-webkit-user-select:none;}
.ide-tree-row:hover{background:var(--ide-bg-elev2);}
.ide-tree-row.active{background:var(--ide-sel);}
.ide-tree-label{overflow:hidden;text-overflow:ellipsis;}
.ide-tree-chevron{width:14px;flex:0 0 14px;text-align:center;color:var(--ide-muted);font-size:10px;}
.ide-tree-icon{display:inline-flex;flex:0 0 18px;color:var(--ide-muted);}
.ide-tree-dirty{margin-left:auto;color:var(--ide-accent);font-size:10px;}
.ide-sidebar-foot{padding:6px;border-top:1px solid var(--ide-border);}
.ide-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;position:relative;}
.ide-tabs-strip{display:flex;align-items:center;height:40px;flex:0 0 40px;min-width:0;background:var(--ide-bg-elev);border-bottom:1px solid var(--ide-border);}
.ide-tabs-list{display:flex;gap:2px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none;padding:4px 4px 0 6px;}
.ide-tabs-list::-webkit-scrollbar{display:none;}
.ide-tab{display:inline-flex;align-items:center;gap:6px;max-width:190px;min-width:96px;height:32px;padding:0 4px 0 10px;border:1px solid transparent;border-bottom:none;border-radius:6px 6px 0 0;background:transparent;color:var(--ide-muted);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;touch-action:manipulation;}
.ide-tab.active{background:var(--ide-bg);color:var(--ide-text);border-color:var(--ide-border);}
.ide-tab-name{overflow:hidden;text-overflow:ellipsis;}
.ide-tab-dirty{color:var(--ide-accent);font-size:10px;flex:0 0 auto;}
.ide-tab-close{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:4px;font-size:14px;line-height:1;flex:0 0 auto;}
.ide-tab-close:hover{background:var(--ide-bg-elev2);color:var(--ide-danger);}
.ide-tab-add{width:34px;height:32px;margin:0 2px 0 0;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--ide-muted);font-size:18px;cursor:pointer;flex:0 0 auto;}
.ide-tab-add:hover{background:var(--ide-bg-elev2);color:var(--ide-text);}
.ide-tabs-more{flex:0 0 auto;margin-right:2px;}
.ide-toolbar{display:flex;align-items:center;gap:2px;padding:4px 8px;flex:0 0 auto;background:var(--ide-bg-elev);border-bottom:1px solid var(--ide-border);overflow-x:auto;scrollbar-width:none;}
.ide-toolbar::-webkit-scrollbar{display:none;}
.ide-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:36px;height:36px;padding:0 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--ide-muted);font:inherit;font-size:12px;cursor:pointer;touch-action:manipulation;white-space:nowrap;flex:0 0 auto;}
.ide-btn:hover,.ide-btn:focus-visible{background:var(--ide-bg-elev2);color:var(--ide-text);outline:none;}
.ide-btn.wide{width:100%;}
.ide-btn.primary{background:var(--ide-accent);color:#000;font-weight:600;border-color:var(--ide-accent);}
.ide-sep{width:1px;height:20px;background:var(--ide-border);margin:0 4px;flex:0 0 1px;}
.ide-breadcrumb{flex:0 0 auto;min-height:24px;padding:3px 12px;color:var(--ide-muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--ide-bg);border-bottom:1px solid var(--ide-border);}
.ide-editor-wrap{flex:1;display:flex;position:relative;min-height:0;overflow:hidden;background:var(--ide-bg);}
.ide-gutter{flex:0 0 auto;overflow:hidden;position:relative;z-index:3;background:var(--ide-bg-elev);border-right:1px solid var(--ide-border);color:var(--ide-muted);font-family:var(--ide-font);font-size:var(--ide-font-size);line-height:1.55;user-select:none;-webkit-user-select:none;}
.ide-gutter-inner{padding:12px 10px 12px 8px;text-align:right;white-space:pre;min-height:100%;will-change:transform;}
.ide-editor-stack{position:relative;flex:1;min-width:0;min-height:0;overflow:hidden;}
.ide-highlight,.ide-textarea{position:absolute;inset:0;margin:0;padding:12px 16px;font-family:var(--ide-font);font-size:var(--ide-font-size);line-height:1.55;letter-spacing:0;tab-size:2;box-sizing:border-box;font-variant-ligatures:none;}
.ide-highlight{overflow:auto;pointer-events:none;z-index:1;background:var(--ide-bg);color:var(--ide-text);white-space:pre;scrollbar-width:none;}
.ide-highlight::-webkit-scrollbar{display:none;}
.ide-textarea{z-index:2;background:transparent;color:transparent;-webkit-text-fill-color:transparent;caret-color:var(--ide-text);border:0;outline:none;resize:none;overflow:auto;white-space:pre;min-width:0;min-height:0;overscroll-behavior:contain;}
.ide-textarea::selection{background:var(--ide-sel);}
.ide-shell.wrap .ide-highlight,.ide-shell.wrap .ide-textarea{white-space:pre-wrap;overflow-wrap:anywhere;}
.ide-shell.composing .ide-textarea{color:var(--ide-text);-webkit-text-fill-color:var(--ide-text);background:var(--ide-bg);}
.ide-shell.hide-gutter .ide-gutter{display:none;}
.ide-findbar{position:absolute;top:8px;right:12px;z-index:20;display:flex;flex-direction:column;gap:6px;padding:8px;background:var(--ide-bg-elev);border:1px solid var(--ide-border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:min(440px,calc(100% - 24px));}
.ide-findbar[hidden]{display:none;}
.ide-findrow{display:flex;align-items:center;gap:4px;flex-wrap:wrap;}
.ide-input{flex:1;min-width:90px;height:32px;padding:0 8px;background:var(--ide-bg);color:var(--ide-text);border:1px solid var(--ide-border);border-radius:4px;font:inherit;font-size:12px;outline:none;}
.ide-input:focus{border-color:var(--ide-accent);}
.ide-find-count{color:var(--ide-muted);font-size:11px;min-width:42px;text-align:center;}
.ide-btn.active{background:var(--ide-sel);border-color:var(--ide-accent);color:var(--ide-text);}
.ide-statusbar{display:flex;align-items:center;justify-content:space-between;gap:8px;height:26px;flex:0 0 26px;padding:0 10px;background:var(--ide-accent);color:#000;font-size:11px;font-weight:500;overflow:hidden;}
.ide-status-left,.ide-status-right{display:flex;align-items:center;gap:12px;min-width:0;}
.ide-status-item{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:transparent;border:0;color:inherit;font:inherit;padding:0;}
button.ide-status-item{cursor:pointer;}
.ide-status-item.dirty{font-weight:700;}
.ide-completions{position:absolute;left:16px;right:16px;bottom:34px;z-index:15;display:flex;gap:6px;overflow-x:auto;padding:8px;background:var(--ide-bg-elev);border:1px solid var(--ide-border);border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,.4);scrollbar-width:none;}
.ide-completions[hidden]{display:none;}
.ide-completions::-webkit-scrollbar{display:none;}
.ide-completion{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;padding:6px 10px;border:1px solid var(--ide-border);border-radius:6px;background:var(--ide-bg);color:var(--ide-text);font:inherit;font-size:12px;cursor:pointer;}
.ide-completion.active,.ide-completion:hover{border-color:var(--ide-accent);background:var(--ide-sel);}
.ide-completion-kind{color:var(--ide-muted);font-size:9px;text-transform:uppercase;}
.ide-palette,.ide-preview,.ide-modal,.ide-context,.ide-toast{font-family:var(--ide-font);font-size:var(--ide-font-size);}
.ide-palette{position:fixed;inset:0;z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:12vh 12px 12px;background:rgba(0,0,0,.45);}
.ide-palette[hidden]{display:none;}
.ide-palette-box{width:min(640px,100%);max-height:70vh;display:flex;flex-direction:column;background:var(--ide-bg-elev);color:var(--ide-text);border:1px solid var(--ide-border);border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden;}
.ide-palette-input{height:48px;padding:0 14px;background:transparent;border:0;border-bottom:1px solid var(--ide-border);color:var(--ide-text);font:inherit;font-size:14px;outline:none;}
.ide-palette-list{overflow:auto;padding:6px;overscroll-behavior:contain;}
.ide-palette-item{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:0;border-radius:6px;background:transparent;color:var(--ide-text);font:inherit;font-size:13px;text-align:left;cursor:pointer;}
.ide-palette-item.active,.ide-palette-item:hover{background:var(--ide-sel);}
.ide-palette-hint{margin-left:auto;color:var(--ide-muted);font-size:11px;}
.ide-palette-foot{padding:6px 12px;border-top:1px solid var(--ide-border);color:var(--ide-muted);font-size:10px;}
.ide-preview{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.55);}
.ide-preview[hidden]{display:none;}
.ide-preview-box{width:min(1000px,100%);height:min(80vh,800px);display:flex;flex-direction:column;background:var(--ide-bg);border:1px solid var(--ide-border);border-radius:10px;overflow:hidden;}
.ide-preview-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;background:var(--ide-bg-elev);border-bottom:1px solid var(--ide-border);}
.ide-preview-title{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ide-preview-actions{display:flex;gap:2px;flex:0 0 auto;}
.ide-preview-body{flex:1;display:flex;flex-direction:column;min-height:0;}
.ide-preview-body iframe{flex:1;width:100%;border:0;background:#fff;}
.ide-console{height:130px;overflow:auto;background:#0a0c10;color:#c9d1d9;font-family:var(--ide-font);font-size:12px;padding:8px 12px;border-top:1px solid var(--ide-border);}
.ide-console-line{white-space:pre-wrap;word-break:break-word;border-bottom:1px solid rgba(255,255,255,.04);padding:2px 0;}
.ide-console-line.error{color:#ff7b72;}
.ide-console-line.warn{color:#d29922;}
.ide-context{position:fixed;z-index:10020;min-width:190px;padding:6px;background:var(--ide-bg-elev);border:1px solid var(--ide-border);border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,.45);}
.ide-context button{display:flex;width:100%;align-items:center;gap:8px;padding:9px 10px;border:0;border-radius:5px;background:transparent;color:var(--ide-text);font:inherit;font-size:12px;text-align:left;cursor:pointer;}
.ide-context button:hover{background:var(--ide-sel);}
.ide-context .danger{color:var(--ide-danger);}
.ide-context .sep{height:1px;background:var(--ide-border);margin:4px 2px;}
.ide-modal{position:fixed;inset:0;z-index:10030;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.55);}
.ide-modal[hidden]{display:none;}
.ide-modal-box{width:min(420px,100%);background:var(--ide-bg-elev);border:1px solid var(--ide-border);border-radius:10px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);}
.ide-modal-title{font-size:14px;font-weight:600;margin-bottom:10px;}
.ide-modal-message{font-size:13px;color:var(--ide-muted);margin-bottom:12px;white-space:pre-wrap;}
.ide-modal-input{width:100%;height:38px;padding:0 10px;background:var(--ide-bg);border:1px solid var(--ide-border);border-radius:6px;color:var(--ide-text);font:inherit;font-size:13px;outline:none;}
.ide-modal-input:focus{border-color:var(--ide-accent);}
.ide-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;}
.ide-modal-actions button{height:34px;padding:0 14px;border:1px solid var(--ide-border);border-radius:6px;background:transparent;color:var(--ide-text);font:inherit;font-size:12px;cursor:pointer;}
.ide-modal-actions button.primary{background:var(--ide-accent);border-color:var(--ide-accent);color:#000;font-weight:600;}
.ide-toast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%) translateY(20px);z-index:10040;padding:9px 16px;border-radius:8px;background:var(--ide-bg-elev2);border:1px solid var(--ide-border);color:var(--ide-text);font-size:12px;box-shadow:0 12px 32px rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .18s,transform .18s;max-width:90vw;}
.ide-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
.ide-toast.error{border-color:var(--ide-danger);color:var(--ide-danger);}
.ide-shell .tok-kw{color:#ff7b72;}
.ide-shell .tok-str{color:#a5d6ff;}
.ide-shell .tok-num{color:#79c0ff;}
.ide-shell .tok-com{color:#8b949e;font-style:italic;}
.ide-shell .tok-fn{color:#d2a8ff;}
.ide-shell .tok-type{color:#ffa657;}
.ide-shell .tok-builtin{color:#79c0ff;}
.ide-shell .tok-attr{color:#7ee787;}
.ide-shell .tok-sel{color:#7ee787;}
.ide-shell .tok-prop{color:#79c0ff;}
.ide-shell .tok-val{color:#a5d6ff;}
.ide-shell .tok-op{color:#ff7b72;}
.ide-shell .ide-bracket-match{background:rgba(115,179,0,.25);outline:1px solid rgba(115,179,0,.5);border-radius:2px;}
.ide-shell .md-head{color:#79c0ff;font-weight:700;}
.ide-shell .md-fence{color:#ff7b72;}
.ide-shell .md-codeblock{color:#a5d6ff;}
.ide-shell .md-inline-code{background:rgba(110,118,129,.3);color:#a5d6ff;border-radius:3px;}
.ide-shell .md-strong{font-weight:700;}
.ide-shell .md-em{font-style:italic;}
.ide-shell .md-link{color:#79c0ff;text-decoration:underline;}
.ide-shell .md-url{color:#8b949e;}
.ide-shell .md-quote{color:#8b949e;font-style:italic;}
.ide-shell .csv-head{color:#7ee787;font-weight:700;}
.ide-shell .csv-cell{color:#c9d1d9;}
.ide-shell .csv-str{color:#a5d6ff;}
.ide-shell .csv-delim{color:#ff7b72;}
.ide-shell[data-theme="light"] .tok-kw{color:#cf222e;}
.ide-shell[data-theme="light"] .tok-str{color:#0a3069;}
.ide-shell[data-theme="light"] .tok-num{color:#0550ae;}
.ide-shell[data-theme="light"] .tok-com{color:#6e7781;}
.ide-shell[data-theme="light"] .tok-fn{color:#8250df;}
.ide-shell[data-theme="light"] .tok-type{color:#953800;}
.ide-shell[data-theme="light"] .tok-builtin{color:#0550ae;}
.ide-shell[data-theme="light"] .tok-attr{color:#116329;}
.ide-shell[data-theme="light"] .tok-sel{color:#116329;}
.ide-shell[data-theme="light"] .tok-prop{color:#0550ae;}
.ide-shell[data-theme="light"] .tok-val{color:#0a3069;}
.ide-shell[data-theme="light"] .md-head{color:#0550ae;}
.ide-shell[data-theme="light"] .md-codeblock{color:#0a3069;}
.ide-shell[data-theme="light"] .md-inline-code{background:#eaeef2;color:#0a3069;}
.ide-shell[data-theme="light"] .csv-head{color:#116329;}
@media (max-width:720px){
  .ide-sidebar{position:absolute;inset:0 auto 0 0;z-index:30;width:min(82vw,300px);box-shadow:0 12px 40px rgba(0,0,0,.5);}
  .ide-shell.sidebar-collapsed .ide-sidebar{display:none;}
  .ide-toolbar{padding:2px 4px;}
  .ide-btn{min-width:40px;height:40px;}
  .ide-tab{max-width:145px;min-width:82px;}
  .ide-findbar{left:8px;right:8px;max-width:none;}
  .ide-palette{padding:8px;align-items:flex-start;}
  .ide-palette-box{max-height:80vh;}
}`;

  function ensureStyles() {
    if (document.getElementById('ide-styles-v2')) return;
    var style = document.createElement('style');
    style.id = 'ide-styles-v2';
    style.textContent = STYLES;
    (document.head || document.documentElement).appendChild(style);
  }

  SG.ide.styles = { STYLES: STYLES, ensureStyles: ensureStyles };
})(window.SG = window.SG || {});