'use strict';

// Results feed: 4dlivetoday.com free JSON API (CC BY 4.0, attribution shown in the footer).
const API = 'https://4dlivetoday.com/api/v1';
const MY_TZ = 'Asia/Kuala_Lumpur';
const ORDER = ['magnum', 'toto', 'damacai', 'sabah88', 'stc', 'cashsweep', 'sg', 'gd', 'perdana', 'perdana3pm', '9lotto'];
const SHORT = {
  magnum: 'Magnum', toto: 'Toto', damacai: 'Da Ma Cai', sabah88: 'Sabah 88', stc: 'Sandakan',
  cashsweep: 'Cash Sweep', sg: 'Singapore', gd: 'Grand Dragon', perdana: 'Perdana',
  perdana3pm: 'Perdana 3pm', '9lotto': '9 Lotto'
};
const COLOR = {
  magnum: '#f5c400', toto: '#e2231a', damacai: '#1f5fbf', sabah88: '#0a8f3d', stc: '#8e44ad',
  cashsweep: '#00a3b4', sg: '#d81b60', gd: '#c99700', perdana: '#5e35b1', perdana3pm: '#7e57c2', '9lotto': '#ef6c00'
};
const DEFAULT_ON = ['magnum', 'toto', 'damacai'];
const LIVE_START = 18 * 60 + 30, LIVE_END = 21 * 60 + 30; // Malaysia time, draw nights

const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = n => /^\d{4}$/.test(n || '');

let selected = store.get('ops', DEFAULT_ON);
let latestData = [];
let pollTimer = null;

// ---------- data ----------
async function api(path) {
  const key = 'api:' + path;
  try {
    const res = await fetch(API + path, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    store.set(key, { t: Date.now(), json });
    return { json, stale: false, t: Date.now() };
  } catch (err) {
    const cached = store.get(key, null);
    if (cached) return { json: cached.json, stale: true, t: cached.t };
    throw err;
  }
}

// ---------- dates (Malaysia time) ----------
function myToday(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function myMinutesNow() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: MY_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = t => +p.find(x => x.type === t).value;
  return get('hour') * 60 + get('minute');
}
function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' }).replace('Sept', 'Sep');
}
function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  return new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const sortOps = list => list.sort((a, b) => {
  const ia = ORDER.indexOf(a.operator), ib = ORDER.indexOf(b.operator);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});

// ---------- rendering ----------
function badge(status) {
  if (status === 'checked' || status === 'history') return '<span class="badge ok">Confirmed</span>';
  if (status === 'verifying') return '<span class="badge wait">Verifying</span>';
  if (status === 'single_source') return '<span class="badge ok">Official</span>';
  return '';
}
function numBtn(n) {
  return isNum(n) ? `<button class="n" data-n="${n}">${n}</button>` : '<span class="n blank">----</span>';
}
function grid(title, list) {
  const nums = Array.isArray(list) ? list : [];
  if (!nums.length) return '';
  return `<div class="grid-title">${title}</div><div class="grid">${nums.map(numBtn).join('')}</div>`;
}
function drawCard(d) {
  const top = [['1st', d.first, 'p1'], ['2nd', d.second, 'p2'], ['3rd', d.third, 'p3']];
  return `<article class="card op" data-op="${esc(d.operator)}" style="--op:${COLOR[d.operator] || 'var(--line)'}">
    <div class="card-head">
      <div><h2><span class="dot"></span>${esc(d.operator_name || SHORT[d.operator] || d.operator)}</h2>
        <div class="muted small">${fmtDate(d.date)}${d.draw_no ? ' · Draw ' + esc(d.draw_no) : ''}</div></div>
      <div class="card-actions">${badge(d.status)}
        <button class="icon-btn share" data-share="${esc(d.operator)}|${esc(d.date)}" aria-label="Share result">⤴</button></div>
    </div>
    <div class="top3">${top.map(([l, n, c]) => `<button class="prize ${c}" ${isNum(n) ? `data-n="${n}"` : ''}>
      <span class="lbl">${l}</span><span class="num">${isNum(n) ? n : '----'}</span></button>`).join('')}</div>
    ${grid('Special', d.special)}${grid('Consolation', d.consolation)}
  </article>`;
}
function errorBox(msg, retryFn) {
  const id = 'retry-' + Math.random().toString(36).slice(2);
  setTimeout(() => { const b = document.getElementById(id); if (b) b.onclick = retryFn; });
  return `<div class="error">${esc(msg)}<br><button id="${id}" class="btn ghost">Try again</button></div>`;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- results tab ----------
function renderChips() {
  const ops = latestData.map(d => d.operator);
  $('#chips').innerHTML = ops.map(op => {
    const name = SHORT[op] || latestData.find(d => d.operator === op)?.operator_name || op;
    return `<button class="chip" data-op="${esc(op)}" style="--op:${COLOR[op] || 'var(--muted)'}" aria-pressed="${selected.includes(op)}"><span class="dot"></span>${esc(name)}</button>`;
  }).join('');
}
function renderLatest() {
  const shown = latestData.filter(d => selected.includes(d.operator));
  $('#latest').innerHTML = shown.length ? shown.map(drawCard).join('')
    : '<div class="empty">Tap an operator above to show its results.</div>';
}
async function loadLatest(spin = false) {
  const btn = $('#refresh');
  if (spin) btn.classList.add('spin');
  try {
    const { json, stale, t } = await api('/latest');
    latestData = sortOps([...(json.data?.results || [])]);
    renderChips(); renderLatest();
    $('#updated').textContent = (stale ? 'Offline – showing results saved ' : 'Updated ') + timeAgo(t);
  } catch {
    $('#latest').innerHTML = errorBox("Couldn't load results. Check your connection.", () => loadLatest(true));
  } finally { btn.classList.remove('spin'); }
}

// ---------- past tab ----------
async function loadPast() {
  const date = $('#date').value;
  if (!date) return;
  $('#past').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const { json } = await api('/results/' + date);
    const all = sortOps([...(json.data?.results || [])]);
    const list = all.filter(d => selected.includes(d.operator));
    if (!all.length) {
      $('#past').innerHTML = `<div class="empty">No draws on ${fmtDate(date)}.</div>`;
    } else if (!list.length) {
      $('#past').innerHTML = `<div class="empty">No draws for your selected operators on ${fmtDate(date)}. Change them on the Results tab.</div>`;
    } else {
      $('#past').innerHTML = list.map(drawCard).join('');
    }
  } catch {
    $('#past').innerHTML = errorBox("Couldn't load that date.", loadPast);
  }
}

// ---------- check-number tab ----------
function permutations(n) {
  const out = new Set();
  const go = (pre, rest) => {
    if (!rest.length) { out.add(pre); return; }
    for (let i = 0; i < rest.length; i++) go(pre + rest[i], rest.slice(0, i) + rest.slice(i + 1));
  };
  go('', n);
  return [...out].sort();
}
const TIER_LABEL = { '1st': '1st', '2nd': '2nd', '3rd': '3rd', special: 'Special', consolation: 'Consolation' };
const TIER_CLASS = { '1st': 't1', '2nd': 't2', '3rd': 't3' };

async function checkNumber(n, { keepPerms = false } = {}) {
  if (!isNum(n)) { toast('Enter exactly 4 digits'); return; }
  $('#num').value = n;
  if (!keepPerms) renderPerms(n);
  document.querySelectorAll('#perms .perm-list .n').forEach(b => b.classList.toggle('on', b.dataset.n === n));
  $('#check').innerHTML = '<div class="loading">Checking ' + n + '…</div>';
  try {
    const { json } = await api('/numbers/' + n);
    const res = [...(json.data?.results || [])].sort((a, b) => b.date.localeCompare(a.date));
    const top3 = res.filter(r => ['1st', '2nd', '3rd'].includes(r.tier));
    const byOp = {};
    res.forEach(r => {
      const o = byOp[r.operator] ||= { name: SHORT[r.operator] || r.operator_name, total: 0, top: 0, first: 0 };
      o.total++; if (TIER_CLASS[r.tier]) o.top++; if (r.tier === '1st') o.first++;
    });
    const opRows = Object.entries(byOp).sort((a, b) => b[1].total - a[1].total)
      .map(([, o]) => `<tr><td>${esc(o.name)}</td><td class="r">${o.first}</td><td class="r">${o.top}</td><td class="r">${o.total}</td></tr>`).join('');
    const rows = res.slice(0, 60).map(r => `<tr><td>${fmtDate(r.date, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
      <td>${esc(SHORT[r.operator] || r.operator_name)}</td><td class="tier ${TIER_CLASS[r.tier] || ''}">${TIER_LABEL[r.tier] || esc(r.tier)}</td></tr>`).join('');
    $('#check').innerHTML = `<article class="card">
      <div class="card-head"><h2>${n}</h2></div>
      <div class="stats">
        <div class="stat"><b>${res.length}</b><span>Times won</span></div>
        <div class="stat"><b>${top3.length}</b><span>1st/2nd/3rd</span></div>
        <div class="stat"><b>${res.filter(r => r.tier === '1st').length}</b><span>1st prize</span></div>
      </div>
      ${res.length ? `<table><thead><tr><th>Operator</th><th class="r">1st</th><th class="r">Top 3</th><th class="r">All</th></tr></thead><tbody>${opRows}</tbody></table>
      <div class="grid-title" style="margin-top:16px">Every win${res.length > 60 ? ' (latest 60)' : ''}</div>
      <table><tbody>${rows}</tbody></table>` : '<p class="muted">This number has never won any prize.</p>'}
    </article>`;
  } catch {
    $('#check').innerHTML = errorBox("Couldn't check that number.", () => checkNumber(n, { keepPerms: true }));
  }
}
function renderPerms(n) {
  const perms = permutations(n);
  $('#perms').innerHTML = `<div class="perm-box">
    <div class="grid-title">${perms.length} combination${perms.length > 1 ? 's' : ''}</div>
    <div class="perm-list">${perms.map(p => `<button class="n${p === n ? ' on' : ''}" data-perm="${p}">${p}</button>`).join('')}</div>
    ${perms.length > 1 ? `<button id="check-all" class="btn ghost">Compare all ${perms.length}</button><div id="perm-table"></div>` : ''}
  </div>`;
  const all = $('#check-all');
  if (all) all.onclick = () => compareAll(perms);
}
async function compareAll(perms) {
  const box = $('#perm-table');
  box.innerHTML = '<div class="loading">Checking ' + perms.length + ' numbers…</div>';
  const rows = [];
  for (const p of perms) {
    try {
      const { json } = await api('/numbers/' + p);
      const r = json.data?.results || [];
      rows.push([p, r.filter(x => x.tier === '1st').length, r.filter(x => TIER_CLASS[x.tier]).length, r.length]);
    } catch { rows.push([p, '–', '–', '–']); }
  }
  box.innerHTML = `<table style="margin-top:10px"><thead><tr><th>Number</th><th class="r">1st</th><th class="r">Top 3</th><th class="r">All</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td><button class="n" data-perm="${r[0]}">${r[0]}</button></td><td class="r">${r[1]}</td><td class="r">${r[2]}</td><td class="r">${r[3]}</td></tr>`).join('')}</tbody></table>`;
}

// ---------- schedule tab ----------
async function loadSchedule() {
  try {
    const { json } = await api('/schedule');
    const list = json.data?.schedule || [];
    store.set('schedule-days', list.map(s => s.date));
    const today = myToday();
    $('#schedule').innerHTML = list.length ? list.map(s => `<article class="card sched-item${s.date === today ? ' today' : ''}">
      <div class="sched-date"><span>${fmtDate(s.date, { weekday: 'short' })}</span><b>${fmtDate(s.date, { day: 'numeric' })}</b><span>${fmtDate(s.date, { month: 'short' })}</span></div>
      <div><div><b>${s.date === today ? 'Today' : fmtDate(s.date, { weekday: 'long' })}</b>${s.kind === 'special' ? '<span class="pill special">Special draw</span>' : ''}</div>
      <div class="muted small">${(s.operators || []).map(o => esc(SHORT[o.id] || o.name)).join(' · ')}</div></div>
    </article>`).join('') + '<p class="muted small" style="text-align:center">Main Malaysian draws are at 7pm Malaysia time.</p>'
      : '<div class="empty">No upcoming draws listed.</div>';
  } catch {
    $('#schedule').innerHTML = errorBox("Couldn't load the schedule.", loadSchedule);
  }
}

// ---------- live polling on draw nights ----------
function isDrawNight() {
  const today = myToday();
  const days = store.get('schedule-days', null);
  const wd = new Date(today + 'T12:00:00Z').getUTCDay(); // 0 Sun, 3 Wed, 6 Sat
  const drawDay = days ? days.includes(today) : [0, 3, 6].includes(wd);
  const m = myMinutesNow();
  return drawDay && m >= LIVE_START && m <= LIVE_END;
}
function schedulePolling() {
  clearInterval(pollTimer);
  const live = isDrawNight();
  $('#live').hidden = !live;
  pollTimer = setInterval(() => {
    const nowLive = isDrawNight();
    $('#live').hidden = !nowLive;
    if (nowLive && !document.hidden && $('#view-results').classList.contains('active')) loadLatest();
  }, 60 * 1000);
}

// ---------- sharing ----------
async function shareDraw(op, date) {
  const d = [...latestData, ...(store.get('api:/results/' + date, { json: { data: { results: [] } } }).json.data.results || [])]
    .find(x => x.operator === op && x.date === date);
  if (!d) return;
  const text = `${d.operator_name} ${fmtDate(d.date)}${d.draw_no ? ' (' + d.draw_no + ')' : ''}
1st ${d.first}  2nd ${d.second}  3rd ${d.third}
Special: ${(d.special || []).join(' ')}
Consolation: ${(d.consolation || []).join(' ')}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  } catch { /* user cancelled */ }
}

// ---------- navigation & events ----------
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  store.set('tab', view);
  window.scrollTo(0, 0);
  if (view === 'past' && !$('#past').innerHTML) loadPast();
  if (view === 'schedule') loadSchedule();
  if (view === 'check') setTimeout(() => { if (!$('#num').value) $('#num').focus(); }, 50);
}

document.addEventListener('click', e => {
  const tab = e.target.closest('.tabs button');
  if (tab) return show(tab.dataset.view);
  const chip = e.target.closest('.chip');
  if (chip) {
    const op = chip.dataset.op;
    selected = selected.includes(op) ? selected.filter(o => o !== op) : [...selected, op];
    store.set('ops', selected);
    chip.setAttribute('aria-pressed', selected.includes(op));
    renderLatest();
    $('#past').innerHTML = '';
    return;
  }
  const share = e.target.closest('[data-share]');
  if (share) { const [op, date] = share.dataset.share.split('|'); return shareDraw(op, date); }
  const perm = e.target.closest('[data-perm]');
  if (perm) return checkNumber(perm.dataset.perm, { keepPerms: true });
  const num = e.target.closest('[data-n]');
  if (num && num.dataset.n) { show('check'); checkNumber(num.dataset.n); }
});

$('#refresh').onclick = () => {
  const view = store.get('tab', 'results');
  if (view === 'past') loadPast();
  else if (view === 'schedule') loadSchedule();
  else if (view === 'check' && isNum($('#num').value)) checkNumber($('#num').value, { keepPerms: true });
  else loadLatest(true);
};
$('#check-form').onsubmit = e => { e.preventDefault(); checkNumber($('#num').value.trim()); };
$('#num').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
$('#date').onchange = loadPast;
$('#prev-day').onclick = () => { $('#date').value = shiftDate($('#date').value, -1); loadPast(); };
$('#next-day').onclick = () => {
  const next = shiftDate($('#date').value, 1);
  if (next > myToday()) return toast('No results for future dates yet');
  $('#date').value = next; loadPast();
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) { schedulePolling(); loadLatest(); } });

// ---------- start ----------
$('#date').value = myToday();
$('#date').max = myToday();
loadLatest();
loadSchedule();
schedulePolling();
const startTab = store.get('tab', 'results');
if (startTab !== 'results') show(startTab);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
