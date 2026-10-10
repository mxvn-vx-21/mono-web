/* MONO web — vanilla JS, no build step. Data lives in your Postgres via /api. */
const USER_NAME = '$uf1';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const parts = (s) => s.split('-').map(Number);
const dayNum = (s) => { const [y, m, d] = parts(s); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const fmtDay = (s, year = true) => { const [y, m, d] = parts(s); return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }); };
const fmtTime = (min) => new Date(2000, 0, 1, Math.floor(min / 60), min % 60).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const toMin = (v) => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };
const fromMin = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
const stamp = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const greeting = (h) => (h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : h >= 17 && h < 22 ? 'Good evening' : 'Good night');
const dueLabel = (d, tm, today) => {
  if (!d) return 'No date';
  const n = dayNum(d) - dayNum(today);
  const base = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : fmtDay(d, false);
  return tm != null ? `${base}, ${fmtTime(tm)}` : base;
};

const ICONS = {
  home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10',
  done: 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3',
  memo: 'M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',
  settings: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  plus: 'M12 5v14 M5 12h14', x: 'M18 6L6 18 M6 6l12 12', check: 'M20 6L9 17l-5-5',
  more: 'M12 5h.01 M12 12h.01 M12 19h.01', back: 'M19 12H5 M12 19l-7-7 7-7',
  trash: 'M3 6h18 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6 M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  cal: 'M3 4h18v18H3z M16 2v4 M8 2v4 M3 10h18', edit: 'M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
};
const ico = (n, extra = '') => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" ${extra}><path d="${ICONS[n]}"/></svg>`;
const icoSearch = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>';

/* ---------- state & API ---------- */
const S = { authed: null, loginError: '', tasks: [], notes: [], folders: [], countdowns: [], tab: 'today', filter: 'all', showDone: true, q: '', folder: null, allCd: false, animate: false };

async function api(method, path, body) {
  const r = await fetch('/api/' + path, {
    method, credentials: 'same-origin', keepalive: method !== 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'auth/login') { S.authed = false; closeEditorDom(); render(); throw new Error('Please sign in again.'); }
  if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
  return d;
}
function toast(msg) {
  $('.toast')?.remove();
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), 3500);
}
const upsert = (list, row) => { const i = list.findIndex((x) => x.id === row.id); if (i >= 0) list[i] = row; else list.push(row); };
async function loadState() { Object.assign(S, await api('GET', 'state')); }

/* ---------- task logic ---------- */
const pendingCmp = (a, b) =>
  (a.due_date ? dayNum(a.due_date) : 1e9) - (b.due_date ? dayNum(b.due_date) : 1e9) || (a.due_time ?? 1e9) - (b.due_time ?? 1e9) || b.priority - a.priority || a.id - b.id;
function sections(tasks, today, f) {
  const vis = tasks.filter((t) => f === 'all' || (f === 'today' && t.due_date === today) || (f === 'upcoming' && !t.is_completed && t.due_date && t.due_date > today) || (f === 'completed' && t.is_completed));
  const open = vis.filter((t) => !t.is_completed);
  const od = (t) => t.due_date && t.due_date < today;
  return {
    overdue: open.filter(od).sort(pendingCmp), pending: open.filter((t) => !od(t)).sort(pendingCmp),
    completed: vis.filter((t) => t.is_completed).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
  };
}
const todayList = (tasks, today) => tasks.filter((t) => t.due_date === today).sort((a, b) => a.is_completed - b.is_completed || (a.due_time ?? 1e9) - (b.due_time ?? 1e9) || b.priority - a.priority);
function dayStats(tasks, today) { const t = tasks.filter((x) => x.due_date === today); const done = t.filter((x) => x.is_completed).length; return { done, total: t.length, pct: t.length ? Math.floor((done * 100) / t.length) : 0 }; }

/* ---------- rich content ---------- */
const blankBlock = () => ({ t: 'P', x: '', c: false, b: false, i: false });
function blocksFrom(c) {
  try {
    const o = typeof c === 'string' ? JSON.parse(c) : c;
    if (o && Array.isArray(o.blocks) && o.blocks.length) return o.blocks.map((b) => ({ t: 'PBNC'.includes(b.t) && b.t ? b.t : 'P', x: String(b.x ?? ''), c: !!b.c, b: !!b.b, i: !!b.i }));
  } catch { if (typeof c === 'string' && c) return c.split('\n').map((x) => ({ ...blankBlock(), x })); }
  return [blankBlock()];
}

/* ---------- views ---------- */
const prio = (p) => `<span class="prio" role="img" aria-label="Priority ${['low', 'medium', 'high'][p]}">${[0, 1, 2].map((i) => `<i class="${i <= p ? 'on' : ''}" style="height:${6 + i * 4}px"></i>`).join('')}</span>`;
function taskRow(t, today, menu) {
  const od = !t.is_completed && t.due_date && t.due_date < today;
  return `<div class="trow" data-act="editTask" data-id="${t.id}">
    <button class="check ${t.is_completed ? 'on' : ''}" data-act="toggleTask" data-id="${t.id}" role="checkbox" aria-checked="${t.is_completed}" aria-label="${t.is_completed ? 'Mark incomplete' : 'Mark complete'}: ${esc(t.title)}"><span>${ico('check')}</span></button>
    <div class="tmain"><div class="ttitle ${t.is_completed ? 'done' : ''}">${esc(t.title)}</div><div class="tsub ${od ? 'od' : ''}">${od ? 'Overdue · ' : ''}${esc(dueLabel(t.due_date, t.due_time, today))}</div></div>
    ${t.is_completed ? '' : prio(t.priority)}
    ${menu ? `<button class="icon-btn" data-act="taskMenu" data-id="${t.id}" aria-label="Task options">${ico('more')}</button>` : ''}</div>`;
}
const empty = (title, body, label, act) => `<div class="empty"><img src="/logo.png" alt=""><h3>${esc(title)}</h3><p>${esc(body)}</p>${label ? `<button class="btn" data-act="${act}">${esc(label)}</button>` : ''}</div>`;
const sec = (title, links = []) => `<div class="sec"><h2>${esc(title)}</h2>${links.map(([l, a]) => `<button class="link" data-act="${a}">${esc(l)}</button>`).join('')}</div>`;

function viewToday() {
  const now = new Date(), today = (S.day = ymd(now)), list = todayList(S.tasks, today), st = dayStats(S.tasks, today);
  const C = 2 * Math.PI * 30;
  const [up, past] = [S.countdowns.filter((c) => c.target_date >= today), S.countdowns.filter((c) => c.target_date < today)];
  const cds = [...up.sort((a, b) => a.target_date.localeCompare(b.target_date)), ...past.sort((a, b) => b.target_date.localeCompare(a.target_date))];
  const shown = S.allCd ? cds : cds.slice(0, 3);
  return `<div class="today-hd"><div><h1 class="up">MONO</h1><div class="sub label">${esc(greeting(now.getHours()))}, ${esc(USER_NAME)}.</div>
    <div class="date" id="date">${esc(now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</div>
    <div class="clock" id="clock" aria-label="Current time">${clockHtml(now)}</div></div><img src="/logo.png" alt="MONO mascot"></div>
  <section class="card"><h2>Your day</h2><div class="day">
    <div class="ring"><svg viewBox="0 0 72 72"><circle class="tr" cx="36" cy="36" r="30"/><circle class="pr" cx="36" cy="36" r="30" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - st.pct / 100)}"/></svg><b>${st.pct}%</b></div>
    <div><div class="big">${st.done} / ${st.total}</div><div class="label">${st.total ? 'Tasks completed' : 'No tasks today'}</div></div></div>
    <div class="bar"><i style="width:${st.pct}%"></i></div></section>
  ${sec("Today's tasks", [['Add', 'addTask'], ['See all', 'seeAll']])}
  ${S.loaded && !list.length ? empty('Nothing planned', 'Tasks due today show up here. Add one to start your day.', 'Add task', 'addTask') : list.map((t) => taskRow(t, today, false)).join('')}
  ${sec('Countdowns', [['Add', 'addCd'], ...(cds.length > 3 ? [[S.allCd ? 'Less' : `All ${cds.length}`, 'toggleCd']] : [])])}
  ${S.loaded && !cds.length ? empty('No countdowns yet', 'Track a birthday, a deadline or any date worth looking forward to.', 'Add countdown', 'addCd') : ''}
  ${shown.map((c) => { const n = dayNum(c.target_date) - dayNum(today); const lab = n === 0 ? 'TODAY' : n === 1 ? '1 DAY' : n > 1 ? `${n} DAYS` : n === -1 ? '1 DAY AGO' : `${-n} DAYS AGO`;
    return `<button class="card cd" data-act="editCd" data-id="${c.id}"><span class="ic">${ico('cal')}</span><span><div class="t">${esc(c.title)}</div><div class="d"><b ${n < 0 ? 'class="muted"' : ''}>${lab}</b><span>${esc(fmtDay(c.target_date).toUpperCase())}</span></div></span></button>`; }).join('')}`;
}
const clockHtml = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}<small>:${pad(d.getSeconds())}</small>`;

function viewDone() {
  const today = todayStr(), s = sections(S.tasks, today, S.filter), none = !s.overdue.length && !s.pending.length && !s.completed.length;
  const filters = [['all', 'All'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['completed', 'Completed']];
  const emp = { all: ['No tasks yet', 'Add your first task and give your day some shape.', 'Add task', 'addTask'], today: ['Nothing due today', 'Enjoy the quiet, or plan something.'], upcoming: ['Nothing upcoming', 'Tasks with a future due date appear here.'], completed: ['Nothing completed yet', 'Finished tasks will collect here.'] }[S.filter];
  return `<div class="hd"><div><h1>Done</h1><div class="sub">Get things done.</div></div><button class="round" data-act="addTask" aria-label="Add task">${ico('plus')}</button></div>
  <div class="chips">${filters.map(([k, l]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-act="filter" data-k="${k}">${l}</button>`).join('')}</div>
  ${S.loaded && none ? empty(...emp) : ''}
  ${s.overdue.length ? sec(`Overdue (${s.overdue.length})`) + s.overdue.map((t) => taskRow(t, today, true)).join('') : ''}
  ${s.pending.length ? sec(`Pending (${s.pending.length})`) + s.pending.map((t) => taskRow(t, today, true)).join('') : ''}
  ${s.completed.length ? `<div class="sec" data-act="toggleDone" style="cursor:pointer"><h2>Completed (${s.completed.length})</h2><span style="transition:transform var(--t);transform:rotate(${S.showDone ? 0 : -90}deg)">${ico('check').replace(ICONS.check, 'M6 9l6 6 6-6')}</span></div>
    ${S.showDone ? s.completed.map((t) => taskRow(t, today, true)).join('') : ''}` : ''}`;
}

function notePreview(n) {
  return blocksFrom(n.content).filter((b) => b.x.trim()).slice(0, 5).map((b, idx, arr) => {
    let pre = '';
    if (b.t === 'B') pre = '<span>•</span>';
    if (b.t === 'N') { let k = 1, j = idx - 1; while (j >= 0 && arr[j].t === 'N') { k++; j--; } pre = `<span>${k}.</span>`; }
    if (b.t === 'C') pre = `<span class="cb ${b.c ? 'on' : ''}">${b.c ? ico('check') : ''}</span>`;
    const st = `${b.b ? 'font-weight:700;' : ''}${b.i ? 'font-style:italic;' : ''}`;
    return `<div class="pl">${pre}<span class="${b.t === 'C' && b.c ? 'done' : ''}" style="${st}">${esc(b.x)}</span></div>`;
  }).join('');
}
function filteredNotes() {
  const q = S.q.trim().toLowerCase();
  return S.notes.filter((n) => (S.folder == null || n.folder_id === S.folder) && (!q || n.title.toLowerCase().includes(q) || blocksFrom(n.content).some((b) => b.x.toLowerCase().includes(q))))
    .sort((a, b) => b.is_pinned - a.is_pinned || new Date(b.updated_at) - new Date(a.updated_at));
}
function gridHtml() {
  const list = filteredNotes();
  if (!list.length && S.loaded) {
    if (!S.notes.length) return empty('No notes yet', 'Capture an idea, a list or a thought.', 'New note', 'newNote');
    return S.q.trim() ? empty('No matches', `Nothing found for "${S.q.trim()}".`) : empty('This folder is empty', 'Open a note and choose this folder to file it here.');
  }
  return `<div class="grid">${list.map((n) => `<article class="card note" data-act="openNote" data-id="${n.id}">
    <div class="nh"><div class="nt ${n.title ? '' : 'u'}">${esc(n.title || 'Untitled')}</div>${n.is_pinned ? `<svg class="ico pin" viewBox="0 0 24 24" aria-label="Pinned"><path d="${ICONS.star}"/></svg>` : ''}
    <button class="icon-btn" data-act="noteMenu" data-id="${n.id}" aria-label="Note options" style="width:36px;height:36px">${ico('more')}</button></div>
    <div class="nb">${notePreview(n)}</div><div class="nd">${esc(stamp(n.updated_at))}</div>
    ${n.folder_id ? `<div class="nf">${esc(S.folders.find((f) => f.id === n.folder_id)?.name || '')}</div>` : ''}</article>`).join('')}</div>`;
}
function viewMemo() {
  const sel = S.folders.find((f) => f.id === S.folder);
  return `<div class="hd"><div><h1>Memo</h1><div class="sub">Capture your thoughts.</div></div><button class="round" data-act="newNote" aria-label="New note">${ico('plus')}</button></div>
  <label class="search">${icoSearch}<input id="q" type="search" placeholder="Search notes" value="${esc(S.q)}" autocomplete="off" aria-label="Search notes"></label>
  <div class="chips"><button class="chip ${S.folder == null ? 'on' : ''}" data-act="folderSel" data-id="">All</button>
  ${S.folders.map((f) => `<button class="chip ${S.folder === f.id ? 'on' : ''}" data-act="folderSel" data-id="${f.id}">${esc(f.name)}</button>`).join('')}
  <button class="chip" data-act="addFolder">+ Folder</button></div>
  ${sel ? `<div><button class="link" data-act="renameFolder">Rename folder</button><button class="link" data-act="delFolder">Delete folder</button></div>` : ''}
  <div id="grid">${gridHtml()}</div>`;
}
function viewSettings() {
  return `<div class="hd"><div><h1>Settings</h1><div class="sub">Make it yours.</div></div></div>
  <section class="card brand"><img src="/logo.png" alt="MONO mascot"><div><h2 class="up">MONO</h2><div class="label">A simple place for a better you.</div><div class="label" style="margin-top:6px">v1.0.0 · web</div></div></section>
  <section class="card"><h2>About</h2><p class="body">MONO brings your day, your tasks and your notes together in one calm, monochrome place.</p></section>
  <section class="card"><h2>Storage</h2><p class="body">Your data is stored in your own Postgres database and is only reachable after you sign in with your passcode. There are no trackers or third-party services.</p>
  <div class="stats"><div><b>${S.tasks.length}</b><span class="label">Tasks</span></div><div><b>${S.notes.length}</b><span class="label">Notes</span></div><div><b>${S.countdowns.length}</b><span class="label">Countdowns</span></div></div></section>
  <button class="card setrow" data-act="clearAll">${ico('trash')}<span><div class="t">Clear all data</div><div class="s">Delete all tasks, notes, folders and countdowns</div></span></button>
  <button class="card setrow" data-act="logout">${ico('out')}<span><div class="t">Sign out</div><div class="s">End this session on this device</div></span></button>`;
}
function loginView() {
  if (S.authed === null) return '';
  return `<div class="login"><form id="login"><img src="/logo.png" alt="MONO mascot"><h1>MONO</h1><div class="label">Enter your passcode</div>
  <input class="field ${S.loginError ? 'err' : ''}" id="pw" type="password" autocomplete="current-password" placeholder="Passcode" aria-label="Passcode" autofocus>
  ${S.loginError ? `<div class="errmsg" role="alert">${esc(S.loginError)}</div>` : ''}<button class="btn" type="submit">Enter</button></form></div>`;
}
const NAV = [['today', 'Today', 'home'], ['done', 'Done', 'done'], null, ['memo', 'Memo', 'memo'], ['settings', 'Settings', 'settings']];
const navHtml = () => `<nav class="nav" aria-label="Main"><div class="nav-in"><div class="pill">${NAV.map((n) => n
  ? `<button class="nav-item ${S.tab === n[0] ? 'on' : ''}" data-act="tab" data-tab="${n[0]}" aria-label="${n[1]}" aria-current="${S.tab === n[0] ? 'page' : 'false'}">${ico(n[2])}<span>${n[1]}</span><i></i></button>` : '<span></span>').join('')}</div>
  <button class="center" id="center" data-act="center" aria-label="Quick add"><img src="/logo.png" alt=""></button></div></nav>`;

function render() {
  const app = $('#app');
  if (S.authed !== true) { app.innerHTML = loginView(); return; }
  const v = { today: viewToday, done: viewDone, memo: viewMemo, settings: viewSettings }[S.tab]();
  app.innerHTML = `<main class="view ${S.animate ? 'enter' : ''}">${v}</main>${navHtml()}`;
  S.animate = false;
}

/* ---------- overlays ---------- */
function sheet(html, mount) {
  const o = document.createElement('div'); o.className = 'scrim';
  o.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.append(o); requestAnimationFrame(() => o.classList.add('open'));
  const close = () => { o.classList.remove('open'); setTimeout(() => o.remove(), 260); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  o.addEventListener('mousedown', (e) => { if (e.target === o) close(); });
  mount(o.querySelector('.sheet'), close); return close;
}
function modal(html, mount) {
  const o = document.createElement('div'); o.className = 'scrim center open';
  o.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">${html}</div>`;
  document.body.append(o);
  const close = () => o.remove();
  o.addEventListener('mousedown', (e) => { if (e.target === o) close(); });
  mount(o.querySelector('.dialog'), close); return close;
}
const confirmBox = (title, text, ok = 'Delete') => new Promise((res) => {
  modal(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="drow"><button class="tbtn" data-v="0">Cancel</button><button class="tbtn strong" data-v="1">${esc(ok)}</button></div>`, (root, close) => {
    root.addEventListener('click', (e) => { const v = e.target.closest('[data-v]')?.dataset.v; if (v !== undefined) { close(); res(v === '1'); } });
  });
});
const menuSheet = (items) => sheet(`<div>${items.map((m, i) => `<button class="mi" data-i="${i}" style="width:100%">${esc(m.label)}</button>`).join('')}</div>`, (root, close) => {
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { close(); items[+b.dataset.i].fn(); } });
});

async function saveTask(id, payload) {
  const row = await api(id ? 'PUT' : 'POST', id ? `tasks/${id}` : 'tasks', payload);
  upsert(S.tasks, row); render();
}
function taskSheet(t) {
  const d = { priority: t?.priority ?? 1 };
  sheet(`<h2>${t ? 'Edit task' : 'Add task'}</h2>
    <input class="field" id="f-title" placeholder="Task title" maxlength="300" value="${esc(t?.title || '')}" aria-label="Task title">
    <div class="errmsg" id="f-err" hidden>Please give your task a title.</div>
    <textarea class="field" id="f-desc" rows="2" placeholder="Description (optional)" aria-label="Description">${esc(t?.description || '')}</textarea>
    <div class="row"><label class="datebox">Due date<input type="date" id="f-date" value="${t?.due_date || ''}"></label>
    <label class="datebox">Time<input type="time" id="f-time" value="${t?.due_time != null ? fromMin(t.due_time) : ''}" ${t?.due_date ? '' : 'disabled'}></label></div>
    <div class="label" style="margin-top:4px">Priority</div>
    <div class="row" id="f-prio">${['Low', 'Medium', 'High'].map((p, i) => `<button type="button" class="chip ${d.priority === i ? 'on' : ''}" data-p="${i}">${p}</button>`).join('')}</div>
    ${t ? `<label class="check-row"><input type="checkbox" id="f-done" ${t.is_completed ? 'checked' : ''}> Completed</label>` : ''}
    <button class="btn" id="f-save" style="margin-top:8px">${t ? 'Save' : 'Create'}</button>${t ? '<button class="btn ghost" id="f-del">Delete task</button>' : ''}`,
  (root, close) => {
    const title = $('#f-title', root), date = $('#f-date', root), time = $('#f-time', root);
    date.addEventListener('input', () => { time.disabled = !date.value; if (!date.value) time.value = ''; });
    $('#f-prio', root).addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (!b) return; d.priority = +b.dataset.p; $$('#f-prio .chip', root).forEach((c) => c.classList.toggle('on', c === b)); });
    title.addEventListener('input', () => { title.classList.remove('err'); $('#f-err', root).hidden = true; });
    $('#f-save', root).addEventListener('click', async (e) => {
      if (!title.value.trim()) { title.classList.add('err'); $('#f-err', root).hidden = false; title.focus(); return; }
      e.target.disabled = true;
      try {
        await saveTask(t?.id, { title: title.value, description: $('#f-desc', root).value, due_date: date.value || null, due_time: date.value && time.value ? toMin(time.value) : null, priority: d.priority, is_completed: t ? $('#f-done', root).checked : false });
        close();
      } catch (err) { toast(err.message); e.target.disabled = false; }
    });
    $('#f-del', root)?.addEventListener('click', () => { close(); deleteTask(t); });
    if (!t) setTimeout(() => title.focus(), 280);
  });
}
async function deleteTask(t) {
  if (!(await confirmBox('Delete this task?', `"${t.title}" will be removed permanently.`))) return;
  try { await api('DELETE', `tasks/${t.id}`); S.tasks = S.tasks.filter((x) => x.id !== t.id); render(); } catch (e) { toast(e.message); }
}
function cdSheet(c) {
  sheet(`<h2>${c ? 'Edit countdown' : 'Add countdown'}</h2>
    <input class="field" id="c-title" placeholder="Event title" maxlength="300" value="${esc(c?.title || '')}" aria-label="Event title">
    <label class="datebox">Date<input type="date" id="c-date" value="${c?.target_date || ''}"></label>
    <div class="errmsg" id="c-err" hidden>Add a title and pick a date.</div>
    <button class="btn" id="c-save" style="margin-top:8px">${c ? 'Save' : 'Create'}</button>${c ? '<button class="btn ghost" id="c-del">Delete countdown</button>' : ''}`,
  (root, close) => {
    $('#c-save', root).addEventListener('click', async (e) => {
      const title = $('#c-title', root).value.trim(), date = $('#c-date', root).value;
      if (!title || !date) { $('#c-err', root).hidden = false; return; }
      e.target.disabled = true;
      try { const row = await api(c ? 'PUT' : 'POST', c ? `countdowns/${c.id}` : 'countdowns', { title, target_date: date }); upsert(S.countdowns, row); render(); close(); }
      catch (err) { toast(err.message); e.target.disabled = false; }
    });
    $('#c-del', root)?.addEventListener('click', async () => {
      close(); if (!(await confirmBox('Delete this countdown?', 'This can\'t be undone.'))) return;
      try { await api('DELETE', `countdowns/${c.id}`); S.countdowns = S.countdowns.filter((x) => x.id !== c.id); render(); } catch (err) { toast(err.message); }
    });
  });
}
function folderDialog(f) {
  modal(`<h3>${f ? 'Rename folder' : 'New folder'}</h3><input class="field" id="fn" maxlength="80" placeholder="Folder name" value="${esc(f?.name || '')}" aria-label="Folder name"><div class="errmsg" id="fe" hidden></div>
    <div class="drow"><button class="tbtn" data-v="0">Cancel</button><button class="tbtn strong" data-v="1">Save</button></div>`, (root, close) => {
    const input = $('#fn', root); setTimeout(() => input.focus(), 50);
    root.addEventListener('click', async (e) => {
      const v = e.target.closest('[data-v]')?.dataset.v; if (v === undefined) return;
      if (v === '0') return close();
      try { const row = await api(f ? 'PUT' : 'POST', f ? `folders/${f.id}` : 'folders', { name: input.value }); upsert(S.folders, row); S.folders.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())); render(); close(); }
      catch (err) { const m = $('#fe', root); m.textContent = err.message; m.hidden = false; }
    });
  });
}
function quickAdd() {
  if ($('.qa')) return closeQuick();
  $('#center')?.classList.add('open');
  const s = document.createElement('div'); s.className = 'qa-scrim'; s.onclick = closeQuick;
  const q = document.createElement('div'); q.className = 'qa';
  q.innerHTML = `<div class="label">Quick add</div><div class="row"><button data-q="task">${ico('done')}Add task</button><button data-q="note">${ico('memo')}Create note</button></div>`;
  q.onclick = (e) => { const k = e.target.closest('[data-q]')?.dataset.q; if (!k) return; closeQuick(); if (k === 'task') taskSheet(); else openEditor(0); };
  document.body.append(s, q);
}
function closeQuick() { $$('.qa,.qa-scrim').forEach((e) => e.remove()); $('#center')?.classList.remove('open'); }

/* ---------- note editor ---------- */
const E = { open: false, id: 0, title: '', pinned: false, folder: null, blocks: [], focus: 0, lastSaved: '', timer: null, chain: Promise.resolve(true) };
const snap = () => JSON.stringify([E.title, E.pinned, E.folder, E.blocks]);
const eBlank = () => !E.title.trim() && E.blocks.every((b) => !b.x.trim());
const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
const tas = () => $$('#ed-blocks textarea');

function openEditor(id) {
  closeQuick();
  const n = id ? S.notes.find((x) => x.id === id) : null;
  Object.assign(E, { open: true, id: n ? n.id : 0, title: n?.title || '', pinned: !!n?.is_pinned, folder: n?.folder_id ?? null, blocks: blocksFrom(n?.content), focus: 0 });
  E.lastSaved = snap();
  const ed = document.createElement('div'); ed.className = 'editor'; ed.id = 'editor';
  ed.innerHTML = `<div class="ed-top"><button class="icon-btn" data-ed="back" aria-label="Save and go back">${ico('back')}</button>
    <select id="ed-folder" aria-label="Folder"><option value="">No folder</option>${S.folders.map((f) => `<option value="${f.id}" ${E.folder === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
    <button class="icon-btn" data-ed="pin" aria-label="Pin note">${ico('star')}</button><button class="icon-btn" data-ed="del" aria-label="Delete note" ${E.id ? '' : 'hidden'}>${ico('trash')}</button></div>
    <div class="ed-scroll"><input class="ed-title" id="ed-title" placeholder="Title" maxlength="300" value="${esc(E.title)}" aria-label="Title"><div id="ed-blocks"></div><div class="ed-tail" data-ed="tail"></div></div>
    <div class="fmt">${[['b', '<b>B</b>', 'Bold'], ['i', '<i>I</i>', 'Italic'], ['B', '•', 'Bullet list'], ['N', '1.', 'Numbered list'], ['C', '☑', 'Checklist']].map(([k, l, a]) => `<button data-fmt="${k}" aria-label="${a}">${l}</button>`).join('')}</div>`;
  document.body.append(ed);
  history.pushState({ ed: 1 }, '');
  drawBlocks(0, 0); updateFmt();
  if (!n) tas()[0]?.focus();
}
function drawBlocks(focusIdx, pos) {
  const host = $('#ed-blocks'); if (!host) return;
  let k = 0;
  host.innerHTML = E.blocks.map((b, i) => {
    k = b.t === 'N' ? k + 1 : 0;
    const pre = b.t === 'B' ? '<span class="pre">•</span>' : b.t === 'N' ? `<span class="pre">${k}.</span>` : b.t === 'C' ? `<button class="cbox ${b.c ? 'on' : ''}" data-chk="${i}" role="checkbox" aria-checked="${b.c}" aria-label="Checklist item">${ico('check')}</button>` : '';
    return `<div class="blk">${pre}<textarea rows="1" data-i="${i}" class="${b.b ? 'b' : ''} ${b.i ? 'it' : ''} ${b.t === 'C' && b.c ? 'done' : ''}" placeholder="${i === 0 && E.blocks.length === 1 ? 'Start writing…' : ''}">${esc(b.x)}</textarea></div>`;
  }).join('');
  tas().forEach(autosize);
  if (focusIdx != null) { const ta = tas()[focusIdx]; if (ta) { ta.focus(); ta.setSelectionRange(pos, pos); E.focus = focusIdx; } }
  updateFmt();
}
function updateFmt() {
  const b = E.blocks[E.focus] || {};
  $$('.fmt [data-fmt]').forEach((x) => { const k = x.dataset.fmt; x.classList.toggle('on', k === 'b' ? !!b.b : k === 'i' ? !!b.i : b.t === k); });
  const pin = $('[data-ed="pin"]'); if (pin) { pin.querySelector('path').setAttribute('fill', E.pinned ? 'currentColor' : 'none'); pin.setAttribute('aria-label', E.pinned ? 'Unpin note' : 'Pin note'); }
}
function scheduleSave() { clearTimeout(E.timer); E.timer = setTimeout(saveNote, 600); }
function saveNote() {
  clearTimeout(E.timer);
  E.chain = E.chain.then(async () => {
    if (!E.id && eBlank()) return true;
    const s = snap(); if (s === E.lastSaved) return true;
    try {
      const body = { title: E.title, content: { v: 1, blocks: E.blocks }, is_pinned: E.pinned, folder_id: E.folder };
      const row = await api(E.id ? 'PUT' : 'POST', E.id ? `notes/${E.id}` : 'notes', body);
      E.id = row.id; E.lastSaved = s; upsert(S.notes, row); $('[data-ed="del"]')?.removeAttribute('hidden'); return true;
    } catch (e) { toast('Couldn\'t save the note. ' + e.message); return false; }
  });
  return E.chain;
}
function closeEditorDom() { clearTimeout(E.timer); $('#editor')?.remove(); E.open = false; }
async function leaveEditor() {
  if (!E.open) return;
  if (!(await saveNote())) { history.pushState({ ed: 1 }, ''); return; } // never drop unsaved text
  closeEditorDom(); render();
}
function splitBlock(i, v) {
  const b = E.blocks[i], ps = v.split('\n');
  if (ps.length === 2 && !ps[0] && !ps[1] && b.t !== 'P') { b.t = 'P'; b.x = ''; drawBlocks(i, 0); return; } // Enter on empty list item exits the list
  b.x = ps[0];
  const added = ps.slice(1).map((x) => ({ t: b.t, x, c: false, b: b.b, i: b.i }));
  E.blocks.splice(i + 1, 0, ...added);
  const last = i + added.length;
  drawBlocks(last, ps.length === 2 ? 0 : ps[ps.length - 1].length);
}
function backspaceStart(i) {
  const b = E.blocks[i];
  if (b.t !== 'P') { b.t = 'P'; drawBlocks(i, 0); return; }
  if (i === 0) return;
  const prev = E.blocks[i - 1], at = prev.x.length;
  prev.x += b.x; E.blocks.splice(i, 1); drawBlocks(i - 1, at);
}
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'ed-title') { E.title = t.value; scheduleSave(); }
  else if (t.matches?.('#ed-blocks textarea')) {
    const i = +t.dataset.i; if (t.value.includes('\n')) splitBlock(i, t.value); else { E.blocks[i].x = t.value; autosize(t); }
    scheduleSave();
  } else if (t.id === 'ed-folder') { E.folder = t.value ? +t.value : null; scheduleSave(); }
  else if (t.id === 'q') { S.q = t.value; $('#grid').innerHTML = gridHtml(); }
});
document.addEventListener('beforeinput', (e) => {
  const t = e.target;
  if (e.inputType === 'deleteContentBackward' && t.matches?.('#ed-blocks textarea') && t.selectionStart === 0 && t.selectionEnd === 0) {
    const i = +t.dataset.i; if (E.blocks[i].t !== 'P' || i > 0) { e.preventDefault(); backspaceStart(i); scheduleSave(); }
  }
});
document.addEventListener('focusin', (e) => { if (e.target.matches?.('#ed-blocks textarea')) { E.focus = +e.target.dataset.i; updateFmt(); } });
document.addEventListener('pointerdown', (e) => { if (e.target.closest?.('.fmt button')) e.preventDefault(); }); // keep keyboard open
function editorClick(e) {
  const chk = e.target.closest('[data-chk]');
  if (chk) { const b = E.blocks[+chk.dataset.chk]; b.c = !b.c; drawBlocks(null); scheduleSave(); return true; }
  const f = e.target.closest('[data-fmt]');
  if (f) {
    const i = E.focus, b = E.blocks[i], ta = tas()[i], pos = ta ? ta.selectionStart : 0, k = f.dataset.fmt;
    if (k === 'b') b.b = !b.b; else if (k === 'i') b.i = !b.i; else b.t = b.t === k ? 'P' : k;
    drawBlocks(i, pos); scheduleSave(); return true;
  }
  const a = e.target.closest('[data-ed]')?.dataset.ed;
  if (!a) return false;
  if (a === 'back') history.back();
  if (a === 'pin') { E.pinned = !E.pinned; updateFmt(); scheduleSave(); }
  if (a === 'tail') { const l = E.blocks[E.blocks.length - 1]; if (l.x || l.t !== 'P') E.blocks.push(blankBlock()); drawBlocks(E.blocks.length - 1, 0); }
  if (a === 'del') confirmBox('Delete this note?', 'This can\'t be undone.').then(async (ok) => {
    if (!ok) return;
    try { clearTimeout(E.timer); await E.chain; if (E.id) { await api('DELETE', `notes/${E.id}`); S.notes = S.notes.filter((n) => n.id !== E.id); } E.lastSaved = snap(); closeEditorDom(); history.back(); render(); }
    catch (err) { toast(err.message); }
  });
  return true;
}
window.addEventListener('popstate', () => { if (E.open) leaveEditor(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && E.open) saveNote(); });
window.addEventListener('pagehide', () => { if (E.open) saveNote(); });

/* ---------- actions ---------- */
const byId = (list, el) => list.find((x) => x.id === +el.dataset.id);
const ACTS = {
  tab(el) { S.tab = el.dataset.tab; S.animate = true; closeQuick(); render(); scrollTo(0, 0); },
  center: quickAdd,
  seeAll() { ACTS.tab({ dataset: { tab: 'done' } }); },
  addTask: () => taskSheet(), addCd: () => cdSheet(), toggleCd() { S.allCd = !S.allCd; render(); },
  editTask(el) { taskSheet(byId(S.tasks, el)); }, editCd(el) { cdSheet(byId(S.countdowns, el)); },
  async toggleTask(el) {
    const t = byId(S.tasks, el), prev = t.is_completed; t.is_completed = !prev; render();
    try { upsert(S.tasks, await api('PUT', `tasks/${t.id}`, { is_completed: t.is_completed })); render(); }
    catch (e) { t.is_completed = prev; render(); toast('Couldn\'t update the task. ' + e.message); }
  },
  taskMenu(el) { const t = byId(S.tasks, el); menuSheet([{ label: 'Edit', fn: () => taskSheet(t) }, { label: 'Delete', fn: () => deleteTask(t) }]); },
  filter(el) { S.filter = el.dataset.k; render(); }, toggleDone() { S.showDone = !S.showDone; render(); },
  newNote: () => openEditor(0), openNote(el) { openEditor(+el.dataset.id); },
  noteMenu(el) {
    const n = byId(S.notes, el);
    menuSheet([{ label: n.is_pinned ? 'Unpin' : 'Pin', async fn() {
      try { upsert(S.notes, await api('PUT', `notes/${n.id}`, { is_pinned: !n.is_pinned })); render(); } catch (e) { toast(e.message); } } },
    { label: 'Delete', async fn() {
      if (!(await confirmBox('Delete this note?', 'This can\'t be undone.'))) return;
      try { await api('DELETE', `notes/${n.id}`); S.notes = S.notes.filter((x) => x.id !== n.id); render(); } catch (e) { toast(e.message); } } }]);
  },
  folderSel(el) { S.folder = el.dataset.id ? +el.dataset.id : null; render(); },
  addFolder: () => folderDialog(), renameFolder() { folderDialog(S.folders.find((f) => f.id === S.folder)); },
  async delFolder() {
    const f = S.folders.find((x) => x.id === S.folder); if (!f) return;
    if (!(await confirmBox(`Delete "${f.name}"?`, 'Notes in this folder are kept. They\'ll simply have no folder.'))) return;
    try { await api('DELETE', `folders/${f.id}`); S.folders = S.folders.filter((x) => x.id !== f.id); S.notes.forEach((n) => { if (n.folder_id === f.id) n.folder_id = null; }); S.folder = null; render(); } catch (e) { toast(e.message); }
  },
  async clearAll() {
    if (!(await confirmBox('Delete everything?', 'All tasks, notes, folders and countdowns will be permanently erased. This can\'t be undone.', 'Delete all'))) return;
    try { await api('DELETE', 'all'); Object.assign(S, { tasks: [], notes: [], folders: [], countdowns: [], folder: null }); render(); toast('All data deleted'); } catch (e) { toast(e.message); }
  },
  async logout() { try { await api('POST', 'auth/logout', {}); } catch {} S.authed = false; S.loginError = ''; render(); },
};
document.addEventListener('click', (e) => {
  if (E.open && e.target.closest('#editor')) { editorClick(e); return; }
  const el = e.target.closest('[data-act]');
  if (el && ACTS[el.dataset.act]) ACTS[el.dataset.act](el);
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'login') return;
  e.preventDefault();
  try { await api('POST', 'auth/login', { passcode: $('#pw').value }); await boot(); }
  catch (err) { S.loginError = err.message; render(); $('#pw')?.focus(); }
});

/* Live clock: only ticks while the Today tab is visible. */
setInterval(() => {
  if (document.hidden || S.tab !== 'today' || E.open || S.authed !== true) return;
  const c = $('#clock'); if (!c) return;
  const now = new Date(); c.innerHTML = clockHtml(now);
  if (ymd(now) !== S.day) render();
}, 1000);

async function boot() {
  try {
    const s = await api('GET', 'auth/session');
    S.authed = !!s.authed;
    if (S.authed) { S.loginError = ''; await loadState(); S.loaded = true; }
  } catch (e) { S.authed = false; S.loginError = e.message; }
  render();
}
boot();
