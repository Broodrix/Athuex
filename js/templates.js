/* Project templates — plain files, no build */
(function (SG) {
  'use strict';

  const T = {
    landing: {
      label: 'Landing page',
      files: {
        'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Welcome</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="hero">
    <h1>Ship something great</h1>
    <p>A clean mobile-first landing page.</p>
    <a class="btn" href="#cta">Get started</a>
  </header>
  <main id="cta">
    <h2>Why us</h2>
    <ul>
      <li>Fast</li>
      <li>Simple</li>
      <li>Yours</li>
    </ul>
  </main>
  <script src="app.js"></script>
</body>
</html>`,
        'styles.css': `*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#0a0a0c;color:#e8e8ec;line-height:1.5}
.hero{padding:3rem 1.25rem;text-align:center;background:linear-gradient(160deg,#1a1530,#0a0a0c)}
h1{font-size:1.75rem;margin:0 0 .5rem}
.btn{display:inline-block;margin-top:1rem;padding:.75rem 1.25rem;background:#6c5ce7;color:#fff;text-decoration:none;border-radius:8px;font-weight:600}
main{padding:1.5rem 1.25rem;max-width:40rem;margin:0 auto}`,
        'app.js': `document.querySelectorAll('a[href^="#"]').forEach(a=>{
  a.addEventListener('click',e=>{const id=a.getAttribute('href').slice(1);const el=document.getElementById(id);if(el){e.preventDefault();el.scrollIntoView({behavior:'smooth'})}});
});`
      }
    },
    pwa: {
      label: 'PWA starter',
      files: {
        'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#0a0a0c">
  <link rel="manifest" href="manifest.webmanifest">
  <title>My PWA</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <h1>My PWA</h1>
  <p id="status">Ready</p>
  <button id="btn">Ping</button>
  <script src="app.js"></script>
</body>
</html>`,
        'styles.css': `body{font-family:system-ui,sans-serif;background:#0a0a0c;color:#eee;padding:1.5rem}
button{padding:.6rem 1rem;border:0;border-radius:8px;background:#6c5ce7;color:#fff;font-weight:600}`,
        'app.js': `document.getElementById('btn').onclick=()=>{document.getElementById('status').textContent='Clicked at '+new Date().toLocaleTimeString()};
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js').catch(()=>{})}`,
        'manifest.webmanifest': `{"name":"My PWA","short_name":"PWA","start_url":"./","display":"standalone","background_color":"#0a0a0c","theme_color":"#0a0a0c","icons":[]}`,
        'sw.js': `self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('fetch',e=>{e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)))});`
      }
    },
    game: {
      label: 'Tap game',
      files: {
        'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
  <title>Tap</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="score">0</div>
  <div id="target"></div>
  <script src="app.js"></script>
</body>
</html>`,
        'styles.css': `html,body{margin:0;height:100%;background:#111;overflow:hidden;touch-action:manipulation}
#score{position:fixed;top:12px;left:12px;color:#fff;font:700 1.25rem system-ui}
#target{position:absolute;width:56px;height:56px;border-radius:50%;background:#6c5ce7;transform:translate(-50%,-50%)}`,
        'app.js': `let s=0;const t=document.getElementById('target');const sc=document.getElementById('score');
function place(){t.style.left=(10+Math.random()*80)+'%';t.style.top=(10+Math.random()*80)+'%'}
t.onclick=()=>{s++;sc.textContent=s;place()};place();`
      }
    }
  };

  function list() {
    return Object.keys(T).map((id) => ({ id, label: T[id].label }));
  }

  function get(id) {
    return T[id] ? { id, label: T[id].label, files: Object.assign({}, T[id].files) } : null;
  }

  SG.templates = { list, get };
})(window.SG = window.SG || {});
