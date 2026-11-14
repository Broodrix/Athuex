/* run_code in opaque sandboxed iframe (no same-origin access) */
(function (SG) {
  'use strict';

  function runJS(code, timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;border:0;opacity:0';
      document.body.appendChild(iframe);

      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        try { document.body.removeChild(iframe); } catch (_) {}
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({ ok: false, text: 'Timed out after ' + timeoutMs + ' ms' });
      }, timeoutMs);

      function onMsg(e) {
        if (e.source !== iframe.contentWindow) return;
        const d = e.data;
        if (!d || d.source !== 'sg-runner') return;
        const parts = [];
        if (d.out) parts.push('stdout:\n' + d.out);
        if (d.ret !== undefined && d.ret !== '') parts.push('return: ' + d.ret);
        if (d.err) parts.push('error:\n' + d.err);
        finish({ ok: !!d.ok, text: (parts.join('\n') || '(no output)').slice(0, 6000) });
      }
      window.addEventListener('message', onMsg);

      const src =
        '<!DOCTYPE html><html><head><meta charset="utf-8"><script>(function(){' +
        'var L=[];function fmt(a){return a.map(function(x){if(typeof x==="string")return x;try{return JSON.stringify(x)}catch(e){return String(x)}}).join(" ")}' +
        'var con={log:function(){L.push(fmt([].slice.call(arguments)))},info:function(){L.push(fmt([].slice.call(arguments)))},' +
        'warn:function(){L.push(fmt([].slice.call(arguments)))},error:function(){L.push(fmt([].slice.call(arguments)))},debug:function(){L.push(fmt([].slice.call(arguments)))}};' +
        'window.console=con;' +
        'window.onerror=function(m,s,l,c,e){parent.postMessage({source:"sg-runner",ok:false,out:L.join("\\n"),err:String(m)+(l?" @"+l:"" )},"*");return true};' +
        'try{' +
        'var AF=Object.getPrototypeOf(async function(){}).constructor;' +
        'var p=new AF("console",' + JSON.stringify(String(code)) + ')(con);' +
        'Promise.resolve(p).then(function(r){' +
        'parent.postMessage({source:"sg-runner",ok:true,out:L.join("\\n"),ret:r===undefined?"":(typeof r==="string"?r:fmt([r]))},"*");' +
        '}).catch(function(e){' +
        'parent.postMessage({source:"sg-runner",ok:false,out:L.join("\\n"),err:String((e&&e.stack)||e).slice(0,1500)},"*");' +
        '});' +
        '}catch(e){parent.postMessage({source:"sg-runner",ok:false,out:L.join("\\n"),err:String((e&&e.stack)||e).slice(0,1500)},"*")}' +
        '})();<\/script></head><body></body></html>';

      iframe.srcdoc = src;
    });
  }

  SG.runner = { runJS };
})(window.SG = window.SG || {});
