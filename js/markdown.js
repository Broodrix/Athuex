/* Lightweight markdown → safe DOM — images with resilient loading */
(function (SG) {
  'use strict';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isSafeImgUrl(url) {
    if (!url) return false;
    var u = String(url).trim();
    if (/^https?:\/\//i.test(u)) return true;
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(u)) return true;
    if (/^blob:/i.test(u)) return true;
    if (/^[\w./\-]+\.(png|jpe?g|gif|webp|svg)$/i.test(u)) return true;
    // pollinations / common CDN path forms without scheme slip-through
    if (/^image\.pollinations\.ai\//i.test(u)) return true;
    return false;
  }

  function normalizeImgUrl(url) {
    var u = String(url || '').trim().replace(/&amp;/g, '&');
    if (/^image\.pollinations\.ai\//i.test(u)) u = 'https://' + u;
    return u;
  }

  function makeImgEl(alt, url) {
    var src = normalizeImgUrl(url);
    var wrap = document.createElement('figure');
    wrap.className = 'md-figure';
    var img = document.createElement('img');
    img.alt = alt || '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.className = 'md-img';
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.borderRadius = '10px';
    img.style.display = 'block';
    img.style.margin = '8px 0';
    img.style.background = '#161b22';
    var caption = document.createElement('figcaption');
    caption.className = 'md-figcaption';
    caption.textContent = alt || '';
    img.onerror = function () {
      img.style.display = 'none';
      caption.textContent = (alt ? alt + ' — ' : '') + 'image failed to load';
      caption.style.color = '#f85149';
      // Offer open link if http
      if (/^https?:\/\//i.test(src)) {
        var a = document.createElement('a');
        a.href = src;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = 'Open image URL';
        a.style.display = 'inline-block';
        a.style.marginTop = '4px';
        a.style.color = '#58a6ff';
        wrap.appendChild(a);
      }
    };
    img.onload = function () {
      if (caption && !alt) caption.style.display = 'none';
    };
    img.src = src;
    wrap.appendChild(img);
    if (alt) wrap.appendChild(caption);
    return wrap;
  }

  function inlineFormat(text) {
    var s = escapeHtml(text);
    // images ![alt](url) — before links; keep as placeholder markers replaced later via DOM path when possible
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, url) {
      var raw = normalizeImgUrl(String(url).replace(/&amp;/g, '&'));
      if (!isSafeImgUrl(raw)) return escapeHtml('![' + alt + '](' + url + ')');
      return '<img src="' + raw.replace(/"/g, '&quot;') + '" alt="' + escapeHtml(alt) +
        '" loading="lazy" referrerpolicy="no-referrer" class="md-img" style="max-width:100%;height:auto;border-radius:10px;display:block;margin:8px 0;background:#161b22">';
    });
    // code
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    // bold
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // italic
    s = s.replace(/(^|[^*\w])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
    // links [text](https://...)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s;
  }

  function render(text) {
    const root = document.createElement('div');
    root.className = 'md';
    const src = String(text == null ? '' : text);
    const parts = src.split(/(```[\s\S]*?```)/g);

    parts.forEach((part) => {
      if (part.startsWith('```')) {
        const m = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        if (m && m[1]) code.className = 'lang-' + m[1];
        code.textContent = m ? m[2].replace(/\n$/, '') : part.slice(3);
        pre.appendChild(code);
        const wrap = document.createElement('div');
        wrap.className = 'code-block';
        wrap.appendChild(pre);
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'code-copy';
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = () => {
          const t = code.textContent || '';
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t).then(() => {
              copyBtn.textContent = 'Copied';
              setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
            }).catch(() => fallbackCopy(t, copyBtn));
          } else fallbackCopy(t, copyBtn);
        };
        wrap.appendChild(copyBtn);
        root.appendChild(wrap);
        return;
      }
      const lines = part.split('\n');
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        // standalone image line
        var imgOnly = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
        if (imgOnly && isSafeImgUrl(normalizeImgUrl(imgOnly[2]))) {
          root.appendChild(makeImgEl(imgOnly[1], imgOnly[2]));
          i++;
          continue;
        }
        if (/^#{1,3}\s/.test(line)) {
          const level = line.match(/^(#{1,3})\s/)[1].length;
          const h = document.createElement('h' + (level + 2));
          h.innerHTML = inlineFormat(line.replace(/^#{1,3}\s+/, ''));
          root.appendChild(h);
          i++;
          continue;
        }
        if (/^[-*]\s+/.test(line)) {
          const ul = document.createElement('ul');
          while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
            const li = document.createElement('li');
            li.innerHTML = inlineFormat(lines[i].replace(/^[-*]\s+/, ''));
            ul.appendChild(li);
            i++;
          }
          root.appendChild(ul);
          continue;
        }
        if (/^\d+\.\s+/.test(line)) {
          const ol = document.createElement('ol');
          while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
            const li = document.createElement('li');
            li.innerHTML = inlineFormat(lines[i].replace(/^\d+\.\s+/, ''));
            ol.appendChild(li);
            i++;
          }
          root.appendChild(ol);
          continue;
        }
        if (line.trim() === '') { i++; continue; }
        const buf = [];
        while (i < lines.length && lines[i].trim() !== '' &&
               !/^#{1,3}\s/.test(lines[i]) && !/^[-*]\s+/.test(lines[i]) &&
               !/^\d+\.\s+/.test(lines[i]) &&
               !/^!\[[^\]]*\]\([^)\s]+\)$/.test(lines[i].trim())) {
          buf.push(lines[i]);
          i++;
        }
        if (buf.length) {
          const p = document.createElement('p');
          p.innerHTML = inlineFormat(buf.join('\n'));
          // Attach onerror to any imgs produced via inlineFormat
          p.querySelectorAll('img').forEach(function (img) {
            img.onerror = function () {
              var alt = img.alt || 'image';
              var note = document.createElement('span');
              note.className = 'img-fallback';
              note.textContent = alt + ' (failed to load)';
              note.style.color = '#f85149';
              note.style.fontSize = '12px';
              if (img.parentNode) img.parentNode.replaceChild(note, img);
            };
          });
          root.appendChild(p);
        }
      }
    });
    return root;
  }

  function fallbackCopy(t, btn) {
    const ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); btn.textContent = 'Copied'; }
    catch (_) { btn.textContent = 'Fail'; }
    document.body.removeChild(ta);
    setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
  }

  /**
   * If the model described an image without a usable markdown URL,
   * synthesize a pollinations markdown image.
   */
  function ensureImageMarkdown(text) {
    var s = String(text == null ? '' : text);
    if (/!\[[^\]]*\]\([^)\s]+\)/.test(s)) return s; // already has image markdown
    // Common model patterns: "here's an image of X" without URL
    var m = s.match(/(?:image|picture|photo|illustration)\s+(?:of\s+)?[:「"']?(.{8,120})/i);
    if (m) {
      var prompt = m[1].replace(/["'\n].*$/, '').trim();
      if (prompt.length > 6) {
        var url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) + '?width=768&height=768&nologo=true';
        return s + '\n\n![' + prompt.replace(/[\[\]]/g, '') + '](' + url + ')';
      }
    }
    return s;
  }

  SG.markdown = {
    render: render,
    escapeHtml: escapeHtml,
    isSafeImgUrl: isSafeImgUrl,
    ensureImageMarkdown: ensureImageMarkdown
  };
})(window.SG = window.SG || {});
