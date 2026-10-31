'use strict';

// Posts come straight from the Blogger feed of bclowychinese.blogspot.com (JSONP, no server needed).
const BLOG = 'https://bclowychinese.blogspot.com';
const PAGE = 150;
const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } }
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let posts = [];
let section = '最新';
let shown = 20;
let current = null;
let saved = store.get('saved', []);
let fontSize = store.get('font', 18);

// ---------- feed ----------
function jsonp(path) {
  return new Promise((resolve, reject) => {
    const cb = 'bc' + Date.now() + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const done = () => { clearTimeout(timer); delete window[cb]; s.remove(); };
    const timer = setTimeout(() => { done(); reject(new Error('timeout')); }, 15000);
    window[cb] = data => { done(); resolve(data); };
    s.onerror = () => { done(); reject(new Error('network')); };
    s.src = `${BLOG}${path}${path.includes('?') ? '&' : '?'}alt=json-in-script&callback=${cb}`;
    document.head.appendChild(s);
  });
}
function firstImg(html) { const m = /<img[^>]+src="([^"]+)"/i.exec(html); return m ? m[1] : ''; }
function sized(url, w) {
  if (!url) return '';
  return url.replace(/\/s\d+(-c)?\//, `/w${w}/`).replace(/\/w\d+-h\d+(-[a-z]+)*\//, `/w${w}/`)
    .replace(/=s\d+(-c)?$/, `=w${w}`).replace(/=w\d+-h\d+(-[a-z]+)*$/, `=w${w}`);
}
function toText(html) { const d = document.createElement('div'); d.innerHTML = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ''); return (d.textContent || '').replace(/\s+/g, ' ').trim(); }
function parse(e) {
  const html = e.content?.$t || e.summary?.$t || '';
  return {
    id: e.id.$t,
    title: e.title?.$t || '（無標題）',
    url: (e.link || []).find(l => l.rel === 'alternate')?.href || BLOG,
    date: e.published.$t,
    labels: (e.category || []).map(c => c.term),
    thumb: e.media$thumbnail?.url || firstImg(html),
    html,
    text: toText(html).slice(0, 4000)
  };
}
async function loadPosts() {
  const all = [];
  let start = 1, total = Infinity;
  while (start <= total) {
    const data = await jsonp(`/feeds/posts/default?max-results=${PAGE}&start-index=${start}`);
    const f = data.feed;
    total = +(f.openSearch$totalResults?.$t || 0);
    const entries = f.entry || [];
    all.push(...entries.map(parse));
    if (!entries.length) break;
    start += entries.length;
  }
  return all.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- time ----------
function ago(iso) {
  const t = new Date(iso), s = (Date.now() - t) / 1000;
  if (s < 60) return '剛剛';
  if (s < 3600) return Math.floor(s / 60) + ' 分鐘前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小時前';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' 天前';
  return `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日`;
}

// ---------- rendering ----------
function labelCounts() {
  const c = {};
  posts.forEach(p => p.labels.forEach(l => { c[l] = (c[l] || 0) + 1; }));
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
}
function renderSections() {
  const names = ['最新', ...labelCounts().map(([l]) => l)];
  $('#sections').innerHTML = names.map(n => `<button class="sec${n === section ? ' active' : ''}" data-sec="${esc(n)}">${esc(n)}</button>`).join('');
}
function itemHtml(p) {
  const i = posts.indexOf(p);
  return `<button class="item" data-post="${i}">
    <span class="txt"><h3>${esc(p.title)}</h3>
      <span class="meta">${p.labels[0] ? `<span class="tag">${esc(p.labels[0])}</span>` : ''}<span>${ago(p.date)}</span></span></span>
    ${p.thumb ? `<img src="${esc(sized(p.thumb, 320))}" alt="" loading="lazy">` : ''}
  </button>`;
}
function renderFeed() {
  const list = section === '最新' ? posts : posts.filter(p => p.labels.includes(section));
  if (!list.length) { $('#feed').innerHTML = '<div class="empty">這個分類還沒有文章。</div>'; return; }
  const [top, ...rest] = list;
  const heroImg = top.thumb ? sized(top.thumb, 960) : '';
  $('#feed').innerHTML = (heroImg ? `<button class="hero" data-post="${posts.indexOf(top)}"><img src="${esc(heroImg)}" alt="">
      <span class="cap"><h2>${esc(top.title)}</h2><span class="meta">${top.labels[0] ? esc(top.labels[0]) + ' · ' : ''}${ago(top.date)}</span></span></button>`
      : `<div class="list">${itemHtml(top)}</div><div style="height:10px"></div>`)
    + (rest.length ? `<div class="list">${rest.slice(0, shown).map(itemHtml).join('')}</div>` : '')
    + (rest.length > shown ? '<button class="more" id="more">載入更多</button>' : '');
}
function renderCats() {
  $('#cats').innerHTML = labelCounts().map(([l, n]) => `<button class="cat" data-cat="${esc(l)}">${esc(l)}<span>${n} 篇</span></button>`).join('')
    || '<div class="empty">還沒有分類。</div>';
}
function renderSaved() {
  const list = posts.filter(p => saved.includes(p.id));
  $('#saved').innerHTML = list.length ? `<div class="list">${list.map(itemHtml).join('')}</div>`
    : '<div class="empty">還沒有收藏。打開文章，按 ☆ 收藏。</div>';
}
function runSearch() {
  const q = $('#q').value.trim().toLowerCase();
  if (!q) { $('#results').innerHTML = ''; return; }
  const list = posts.filter(p => p.title.toLowerCase().includes(q) || p.text.toLowerCase().includes(q) || p.labels.some(l => l.toLowerCase().includes(q)));
  $('#results').innerHTML = list.length ? `<p class="meta" style="margin:0 4px 8px">找到 ${list.length} 篇</p><div class="list">${list.map(itemHtml).join('')}</div>`
    : '<div class="empty">找不到相關文章。</div>';
}

// ---------- article ----------
const EMBED_OK = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.bilibili\.com|www\.facebook\.com|player\.vimeo\.com)\//;
function clean(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,link,meta,form,object,embed').forEach(n => n.remove());
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(a => {
      if (/^on/i.test(a.name)) el.removeAttribute(a.name);
      else if (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    });
    if (el.tagName === 'A') { el.target = '_blank'; el.rel = 'noopener'; }
    if (el.tagName === 'IMG') { el.loading = 'lazy'; el.removeAttribute('width'); el.removeAttribute('height'); el.src = sized(el.getAttribute('src'), 1200); }
    if (el.tagName === 'IFRAME') {
      if (!EMBED_OK.test(el.getAttribute('src') || '')) el.remove();
      else { el.removeAttribute('width'); el.removeAttribute('height'); el.classList.add('embed'); el.setAttribute('allowfullscreen', ''); }
    }
  });
  return doc.body.innerHTML;
}
function openPost(i, push = true) {
  const p = posts[i]; if (!p) return;
  current = p;
  $('#reader-body').innerHTML = `<h1>${esc(p.title)}</h1>
    <div class="meta">${p.labels.map(l => `<span class="tag">${esc(l)}</span>`).join('')}<span>${ago(p.date)}</span></div>
    <div class="content">${clean(p.html)}</div>
    <a class="orig" href="${esc(p.url)}" target="_blank" rel="noopener">在部落格開啟原文 ›</a>`;
  $('#save').classList.toggle('on', saved.includes(p.id));
  $('#save').textContent = saved.includes(p.id) ? '★' : '☆';
  $('#reader').hidden = false; $('#reader').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  if (push) history.pushState({ post: i }, '', '#post-' + i);
}
function closePost() {
  $('#reader').hidden = true; document.body.style.overflow = ''; current = null;
}
window.addEventListener('popstate', e => {
  if (e.state && Number.isInteger(e.state.post)) openPost(e.state.post, false); else closePost();
});
function setFont(px) {
  fontSize = Math.max(14, Math.min(26, px)); store.set('font', fontSize);
  document.documentElement.style.setProperty('--font', fontSize + 'px');
}

// ---------- navigation ----------
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#sections').hidden = view !== 'home';
  if (view === 'cats') renderCats();
  if (view === 'saved') renderSaved();
  if (view === 'search') setTimeout(() => $('#q').focus(), 50);
  window.scrollTo(0, 0);
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2200);
}

document.addEventListener('click', e => {
  const t = e.target;
  const tab = t.closest('.tabs button'); if (tab) return show(tab.dataset.view);
  const sec = t.closest('[data-sec]');
  if (sec) { section = sec.dataset.sec; shown = 20; renderSections(); renderFeed(); sec.scrollIntoView({ inline: 'center', block: 'nearest' }); window.scrollTo(0, 0); return; }
  const cat = t.closest('[data-cat]');
  if (cat) { section = cat.dataset.cat; shown = 20; show('home'); renderSections(); renderFeed(); return; }
  const post = t.closest('[data-post]'); if (post) return openPost(+post.dataset.post);
  if (t.closest('#more')) { shown += 20; return renderFeed(); }
});
$('#close').onclick = () => history.back();
$('#font-up').onclick = () => setFont(fontSize + 2);
$('#font-down').onclick = () => setFont(fontSize - 2);
$('#save').onclick = () => {
  if (!current) return;
  const on = !saved.includes(current.id);
  saved = on ? [current.id, ...saved] : saved.filter(id => id !== current.id);
  store.set('saved', saved);
  $('#save').classList.toggle('on', on); $('#save').textContent = on ? '★' : '☆';
  toast(on ? '已收藏' : '已取消收藏');
};
$('#share').onclick = async () => {
  if (!current) return;
  try {
    if (navigator.share) await navigator.share({ title: current.title, url: current.url });
    else { await navigator.clipboard.writeText(current.url); toast('已複製連結'); }
  } catch { /* cancelled */ }
};
$('#q').addEventListener('input', runSearch);
$('#search-form').onsubmit = e => { e.preventDefault(); runSearch(); $('#q').blur(); };

async function refresh(spin = false) {
  if (spin) $('#refresh').classList.add('spin');
  try {
    posts = await loadPosts();
    store.set('posts', posts);
    renderSections(); renderFeed();
  } catch {
    if (!posts.length) $('#feed').innerHTML = '<div class="error">無法載入文章，請檢查網路連線後再試。</div>';
    else toast('離線中，顯示上次載入的文章');
  } finally { $('#refresh').classList.remove('spin'); }
}
$('#refresh').onclick = () => refresh(true);

// ---------- start ----------
setFont(fontSize);
history.replaceState(null, '', location.pathname);
posts = store.get('posts', []);
if (posts.length) { renderSections(); renderFeed(); }
refresh();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
