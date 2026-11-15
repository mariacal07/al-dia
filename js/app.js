import { CONFIG } from './config.js';
import { createDB, DEFAULT_CATEGORIES } from './db.js';
import * as S from './schedule.js';
import { computeMetrics, backlogMetrics, WINDOW } from './metrics.js';

const COLORS = ['#ec4899', '#f43f5e', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#64748b'];
const EMOJIS = ['✨', '🧴', '🧼', '💅', '🧹', '🏠', '🛏️', '🧺', '🍳', '🛒', '💊', '💪', '🧘', '🦷', '🌿', '🪴', '🐶', '🐱', '🚗', '📚', '💰', '👗', '🎯', '❤️'];
const NO_CAT = { id: null, name: 'Sin categoría', icon: '•', color: '#94a3b8' };

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const key = (id, iso) => id + '|' + iso;
const pct = (r) => (r == null ? '—' : Math.round(r * 100) + '%');
const num = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

const app = $('#app');
const tabbar = $('#tabbar');
const sheetRoot = $('#sheet-root');
const EFFORT = {
  quick: { icon: '⚡', label: 'Rápida' },
  medium: { icon: '⏱️', label: 'Un rato' },
  big: { icon: '💪', label: 'Grande' },
};
const state = { view: 'hoy', date: S.today(), period: 30, categories: [], tasks: [], done: new Set(), backlog: [], pendFilter: 'all' };
let db;

/* ============ Arranque ============ */

async function boot() {
  try {
    db = await createDB(CONFIG);
  } catch (e) {
    app.innerHTML = errorBox('No se pudo conectar. Revisa tu conexión a internet.', e);
    return;
  }
  const session = await db.getSession();
  if (!session) return renderAuth('login');
  start();
}

async function start() {
  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    await loadAll();
  } catch (e) {
    app.innerHTML = errorBox('No se pudieron cargar tus datos.', e);
    return;
  }
  tabbar.hidden = false;
  render();
}

async function loadAll() {
  let [cats, tasks] = await Promise.all([db.listCategories(), db.listTasks()]);
  if (!cats.length && !tasks.length) {
    for (const [i, c] of DEFAULT_CATEGORIES.entries()) await db.saveCategory({ ...c, position: i });
    cats = await db.listCategories();
  }
  const t = S.today();
  const [comps, backlog] = await Promise.all([
    db.listCompletions(S.toISO(S.addDays(t, -WINDOW)), S.toISO(S.addDays(t, 60))),
    db.listBacklog(),
  ]);
  state.backlog = backlog;
  state.categories = cats;
  state.tasks = tasks;
  state.done = new Set(comps.map((c) => key(c.task_id, c.date)));
}

function errorBox(msg, e) {
  return `<div class="empty"><div class="empty-emoji">😕</div><p>${esc(msg)}</p>
    <p class="muted small">${esc(e?.message || '')}</p>
    <button class="btn primary" onclick="location.reload()">Reintentar</button></div>`;
}

/* ============ Login ============ */

function renderAuth(mode, msg = '') {
  tabbar.hidden = true;
  const login = mode === 'login';
  app.innerHTML = `
  <div class="auth">
    <img src="icons/icon.svg" class="auth-logo" alt="">
    <h1>Al día</h1>
    <p class="muted">Tus rutinas, sin agobios.</p>
    <form id="auth-form" class="card form">
      <label class="field"><span>Email</span><input class="input" type="email" name="email" required autocomplete="email"></label>
      <label class="field"><span>Contraseña</span><input class="input" type="password" name="password" required minlength="6" autocomplete="${login ? 'current-password' : 'new-password'}"></label>
      ${msg ? `<p class="form-msg">${esc(msg)}</p>` : ''}
      <button class="btn primary block" type="submit">${login ? 'Entrar' : 'Crear cuenta'}</button>
    </form>
    <button class="link" id="auth-switch">${login ? '¿Primera vez? Crea tu cuenta' : 'Ya tengo cuenta'}</button>
  </div>`;
  $('#auth-switch').onclick = () => renderAuth(login ? 'signup' : 'login');
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    e.target.querySelector('button[type=submit]').disabled = true;
    try {
      if (login) await db.signIn(f.get('email'), f.get('password'));
      else if (!(await db.signUp(f.get('email'), f.get('password'))))
        return renderAuth('login', 'Te hemos enviado un correo para confirmar la cuenta. Confírmala y vuelve para entrar.');
      start();
    } catch (err) {
      renderAuth(mode, authError(err));
    }
  };
}

function authError(err) {
  const m = err?.message || '';
  if (/invalid login/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/already registered/i.test(m)) return 'Ya existe una cuenta con ese email.';
  if (/not confirmed/i.test(m)) return 'Tienes que confirmar tu email antes de entrar.';
  if (/signups? not allowed/i.test(m)) return 'El registro de cuentas nuevas está desactivado.';
  return m || 'Algo ha fallado. Inténtalo de nuevo.';
}

/* ============ Render principal ============ */

function render() {
  if (state.view === 'hoy') renderHoy();
  else if (state.view === 'tareas') renderTareas();
  else if (state.view === 'pendientes') renderPendientes();
  else renderMetricas();
  tabbar.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
}

const catOf = (t) => state.categories.find((c) => c.id === t.category_id) || NO_CAT;
const dueOn = (d) => state.tasks.filter((t) => S.isDue(t, d));

function grouped(tasks) {
  const order = [...state.categories, NO_CAT];
  return order
    .map((c) => [c, tasks.filter((t) => (t.category_id ?? null) === c.id || (c === NO_CAT && !state.categories.some((x) => x.id === t.category_id)))])
    .filter(([, ts]) => ts.length);
}

function demoBanner() {
  return db.demo ? `<div class="demo-banner">Modo demo · datos de ejemplo guardados solo en este navegador</div>` : '';
}

/* ============ HOY ============ */

function ring(n, total) {
  const r = 24, c = 2 * Math.PI * r, p = total ? n / total : 0;
  return `<div class="ring ${total && n === total ? 'complete' : ''}">
    <svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="${r}" class="ring-bg"/>
    <circle cx="30" cy="30" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}"/></svg>
    <span>${total ? (n === total ? '✓' : `${n}/${total}`) : '·'}</span></div>`;
}

function renderHoy() {
  const today = S.today(), todayISO = S.toISO(today);
  const d = state.date, iso = S.toISO(d);
  const future = iso > todayISO;
  const due = dueOn(d);
  const doneN = due.filter((t) => state.done.has(key(t.id, iso))).length;
  const diff = S.diffDays(today, d);
  const rel = { 0: 'Hoy', '-1': 'Ayer', 1: 'Mañana' }[diff];
  const weekday = S.DOW_LONG[d.getDay()];

  const monday = S.startOfWeek(d);
  const strip = Array.from({ length: 7 }, (_, i) => {
    const w = S.addDays(monday, i), wi = S.toISO(w);
    const dd = dueOn(w), dn = dd.filter((t) => state.done.has(key(t.id, wi))).length;
    const cls = [wi === iso && 'sel', wi === todayISO && 'today', dd.length && dn === dd.length && 'full', !dd.length && 'free'].filter(Boolean).join(' ');
    return `<button class="day ${cls}" data-act="date" data-date="${wi}">
      <span class="dow">${S.DOW_LETTER[w.getDay()]}</span><span class="num">${w.getDate()}</span><span class="pip"></span></button>`;
  }).join('');

  const groups = grouped(due).map(([c, ts]) => {
    const n = ts.filter((t) => state.done.has(key(t.id, iso))).length;
    return `<section class="group" style="--c:${c.color}">
      <div class="group-head"><span class="cat-badge">${esc(c.icon)}</span><span>${esc(c.name)}</span><span class="group-count">${n}/${ts.length}</span></div>
      ${ts.map((t) => {
        const isDone = state.done.has(key(t.id, iso));
        return `<button class="task ${isDone ? 'done' : ''}" data-act="toggle" data-id="${t.id}" ${future ? 'disabled' : ''}>
          <span class="check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
          <span class="task-body"><span class="task-name">${esc(t.name)}</span>${t.notes ? `<span class="task-note">${esc(t.notes)}</span>` : ''}</span>
        </button>`;
      }).join('')}
    </section>`;
  }).join('');

  const empty = state.tasks.length
    ? `<div class="empty"><div class="empty-emoji">🌤️</div><p><b>Nada por aquí.</b></p><p class="muted">${future ? 'Ese día lo tienes libre.' : 'Día libre, disfrútalo.'}</p></div>`
    : `<div class="empty"><div class="empty-emoji">📝</div><p><b>Empieza añadiendo tus tareas</b></p><p class="muted">Rutina de skincare, cambiar sábanas, regar plantas…</p><button class="btn primary" data-act="new-task">Añadir tarea</button></div>`;

  app.innerHTML = `${demoBanner()}
  <header class="hoy-head">
    <div><div class="eyebrow">${rel ? `${rel} · ${weekday}` : weekday}</div><h1 class="date-title">${S.fmtLong(d)}</h1></div>
    ${due.length ? ring(doneN, due.length) : ''}
  </header>
  <div class="week">
    <button class="week-nav" data-act="week" data-dir="-1" aria-label="Semana anterior">‹</button>
    <div class="days">${strip}</div>
    <button class="week-nav" data-act="week" data-dir="1" aria-label="Semana siguiente">›</button>
  </div>
  ${iso !== todayISO ? '<div class="center"><button class="pill" data-act="today">Volver a hoy</button></div>' : ''}
  <div class="groups">${groups || empty}</div>
  ${iso === todayISO ? freeTimeCard() : ''}
  ${due.length && !future ? '<p class="hint">Marcar es opcional · sirve para tus métricas</p>' : ''}`;
}

/** Tarjeta en "Hoy" que recuerda la lista de pendientes, con una sugerencia distinta cada día */
function freeTimeCard() {
  const pending = pendingItems();
  if (!pending.length) return '';
  const pick = pending[S.diffDays(new Date(2024, 0, 1), S.today()) % pending.length];
  return `<button class="free-card" data-act="go-pend">
    <span class="free-emoji">🎲</span>
    <span class="free-text"><b>¿Tienes un rato libre?</b>
      <span>Tienes ${pending.length} ${pending.length === 1 ? 'pendiente' : 'pendientes'}. Por ejemplo: <i>${esc(pick.name)}</i></span></span>
    <span class="free-arrow">›</span></button>`;
}

async function toggle(id, iso) {
  const k = key(id, iso), was = state.done.has(k);
  was ? state.done.delete(k) : state.done.add(k);
  navigator.vibrate?.(8);
  render();
  try {
    await db.setDone(id, iso, !was);
  } catch {
    was ? state.done.add(k) : state.done.delete(k);
    render();
    toast('No se pudo guardar. ¿Tienes conexión?');
  }
}

/* ============ TAREAS ============ */

function renderTareas() {
  const today = S.today();
  const chips = state.categories.map((c) =>
    `<button class="chip" style="--c:${c.color}" data-act="edit-cat" data-id="${c.id}"><span>${esc(c.icon)}</span>${esc(c.name)}</button>`).join('')
    + '<button class="chip add" data-act="new-cat">＋ Nueva</button>';

  const groups = grouped(state.tasks).map(([c, ts]) => `
    <section class="tgroup" style="--c:${c.color}">
      <h3 class="tgroup-title"><span class="cat-badge">${esc(c.icon)}</span>${esc(c.name)}</h3>
      <div class="card list">${ts.map((t) => {
        const nd = S.nextDue(t, today);
        return `<button class="row" data-act="edit-task" data-id="${t.id}">
          <span class="row-main"><span class="row-title">${esc(t.name)}</span><span class="row-sub">${S.describe(t)}</span></span>
          <span class="row-next ${nd && S.diffDays(today, nd) === 0 ? 'now' : ''}">${nd ? S.relative(nd, today) : ''}</span></button>`;
      }).join('')}</div>
    </section>`).join('');

  app.innerHTML = `${demoBanner()}
  <header class="page-head"><h1>Tareas</h1></header>
  <div class="section-label">Categorías</div>
  <div class="chips">${chips}</div>
  ${groups || '<div class="empty card"><div class="empty-emoji">📝</div><p>Aún no tienes tareas.</p><button class="btn primary" data-act="new-task">Añadir la primera</button></div>'}
  <div class="footer-actions">
    <button class="link" data-act="export">Descargar copia de seguridad</button>
    ${db.demo ? '<button class="link" data-act="reset-demo">Reiniciar datos de ejemplo</button>' : '<button class="link danger" data-act="logout">Cerrar sesión</button>'}
  </div>
  <button class="fab" data-act="new-task" aria-label="Nueva tarea"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
}

/* ============ Hojas (formularios) ============ */

function openSheet(html) {
  sheetRoot.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
  sheetRoot.classList.add('open');
  document.body.classList.add('noscroll');
  $('.sheet-backdrop', sheetRoot).onclick = closeSheet;
  return $('.sheet', sheetRoot);
}
function closeSheet() {
  sheetRoot.classList.remove('open');
  sheetRoot.innerHTML = '';
  document.body.classList.remove('noscroll');
}

function catSheet(cat) {
  const isNew = !cat;
  cat = cat || { name: '', icon: '✨', color: COLORS[state.categories.length % COLORS.length] };
  let icon = cat.icon, color = cat.color;
  const el = openSheet(`
    <h2>${isNew ? 'Nueva categoría' : 'Editar categoría'}</h2>
    <form class="form" id="cat-form">
      <div class="cat-preview" style="--c:${color}"><span class="cat-badge big" id="cp-icon">${esc(icon)}</span>
        <input class="input" name="name" placeholder="Nombre de la categoría" value="${esc(cat.name)}" required maxlength="30"></div>
      <div class="field-label">Icono</div>
      <div class="emoji-grid">${EMOJIS.map((e) => `<button type="button" class="emoji ${e === icon ? 'sel' : ''}" data-emoji="${e}">${e}</button>`).join('')}</div>
      <div class="field-label">Color</div>
      <div class="swatches">${COLORS.map((c) => `<button type="button" class="swatch ${c === color ? 'sel' : ''}" style="--c:${c}" data-color="${c}" aria-label="Color ${c}"></button>`).join('')}</div>
      <div class="sheet-actions">
        ${isNew ? '' : '<button type="button" class="btn ghost danger" id="cat-del">Eliminar</button>'}
        <button type="button" class="btn ghost" id="cat-cancel">Cancelar</button>
        <button type="submit" class="btn primary">Guardar</button>
      </div>
    </form>`);

  el.addEventListener('click', (e) => {
    const em = e.target.closest('[data-emoji]');
    if (em) {
      icon = em.dataset.emoji;
      $('#cp-icon').textContent = icon;
      el.querySelectorAll('.emoji').forEach((b) => b.classList.toggle('sel', b === em));
    }
    const sw = e.target.closest('[data-color]');
    if (sw) {
      color = sw.dataset.color;
      $('.cat-preview', el).style.setProperty('--c', color);
      el.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('sel', b === sw));
    }
  });
  $('#cat-cancel').onclick = closeSheet;
  $('#cat-form').onsubmit = async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    if (!name) return;
    try {
      const saved = await db.saveCategory({ id: cat.id, name, icon, color, position: cat.position ?? state.categories.length });
      if (isNew) state.categories.push(saved);
      else Object.assign(state.categories.find((c) => c.id === cat.id), saved);
      closeSheet(); render();
    } catch (err) { toast('No se pudo guardar: ' + err.message); }
  };
  $('#cat-del')?.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar la categoría "${cat.name}"? Sus tareas no se borran: quedarán sin categoría.`)) return;
    try {
      await db.deleteCategory(cat.id);
      state.categories = state.categories.filter((c) => c.id !== cat.id);
      state.tasks.forEach((t) => { if (t.category_id === cat.id) t.category_id = null; });
      closeSheet(); render();
    } catch (err) { toast('No se pudo eliminar: ' + err.message); }
  });
}

function taskSheet(task) {
  const isNew = !task;
  const todayISO = S.toISO(S.today());
  const t = task
    ? { ...task, weekdays: [...(task.weekdays || [])] }
    : { name: '', category_id: state.categories[0]?.id ?? null, schedule_type: 'weekly', weekdays: [], interval_days: 7, day_of_month: 1, start_date: todayISO, notes: '' };
  const weeks = t.interval_days && t.interval_days % 7 === 0;
  let type = t.schedule_type, catId = t.category_id, wds = new Set(t.weekdays);

  const el = openSheet(`
    <h2>${isNew ? 'Nueva tarea' : 'Editar tarea'}</h2>
    <form class="form" id="task-form">
      <input class="input big" name="name" placeholder="¿Qué hay que hacer?" value="${esc(t.name)}" required maxlength="80" ${isNew ? 'autofocus' : ''}>
      <div class="field-label">Categoría</div>
      <div class="chips wrap" id="cat-pick">
        ${state.categories.map((c) => `<button type="button" class="chip pick ${c.id === catId ? 'sel' : ''}" style="--c:${c.color}" data-cat="${c.id}"><span>${esc(c.icon)}</span>${esc(c.name)}</button>`).join('')}
      </div>
      <div class="field-label">¿Cuándo toca?</div>
      <div class="seg" id="seg">
        <button type="button" data-type="weekly">Días fijos</button>
        <button type="button" data-type="interval">Cada X días</button>
        <button type="button" data-type="monthly">Al mes</button>
      </div>
      <div class="sched" data-for="weekly">
        <div class="weekdays">${S.WEEK_ORDER.map((d) => `<button type="button" class="wd ${wds.has(d) ? 'sel' : ''}" data-wd="${d}">${S.DOW_LETTER[d]}</button>`).join('')}</div>
        <button type="button" class="link small" id="wd-all">Todos los días</button>
      </div>
      <div class="sched" data-for="interval">
        <div class="inline">Cada <input class="input num" type="number" name="n" min="1" max="365" value="${weeks ? t.interval_days / 7 : t.interval_days || 7}">
          <select class="input" name="unit"><option value="d" ${weeks ? '' : 'selected'}>días</option><option value="w" ${weeks ? 'selected' : ''}>semanas</option></select></div>
        <label class="field"><span>Empezando el</span><input class="input" type="date" name="start" value="${t.start_date || todayISO}"></label>
      </div>
      <div class="sched" data-for="monthly">
        <div class="inline">El día <input class="input num" type="number" name="dom" min="1" max="31" value="${t.day_of_month || 1}"> de cada mes</div>
        <p class="muted small">Si el mes no tiene ese día, se pasa al último.</p>
      </div>
      <label class="field"><span>Nota (opcional)</span><input class="input" name="notes" value="${esc(t.notes)}" placeholder="Ej: solo por la noche" maxlength="120"></label>
      <div class="sheet-actions">
        ${isNew ? '' : '<button type="button" class="btn ghost danger" id="task-del">Eliminar</button>'}
        <button type="button" class="btn ghost" id="task-cancel">Cancelar</button>
        <button type="submit" class="btn primary">Guardar</button>
      </div>
    </form>`);

  const syncType = () => {
    el.querySelectorAll('#seg button').forEach((b) => b.classList.toggle('sel', b.dataset.type === type));
    el.querySelectorAll('.sched').forEach((s) => (s.hidden = s.dataset.for !== type));
  };
  syncType();

  el.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-type]');
    if (seg) { type = seg.dataset.type; syncType(); }
    const c = e.target.closest('[data-cat]');
    if (c) { catId = c.dataset.cat; el.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('sel', b === c)); }
    const w = e.target.closest('[data-wd]');
    if (w) { const d = +w.dataset.wd; wds.has(d) ? wds.delete(d) : wds.add(d); w.classList.toggle('sel', wds.has(d)); }
  });
  $('#wd-all').onclick = () => { wds = new Set([0, 1, 2, 3, 4, 5, 6]); el.querySelectorAll('.wd').forEach((b) => b.classList.add('sel')); };
  $('#task-cancel').onclick = closeSheet;

  $('#task-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = f.get('name').trim();
    if (!name) return;
    if (type === 'weekly' && !wds.size) return toast('Elige al menos un día');
    const n = Math.max(1, parseInt(f.get('n'), 10) || 1);
    const payload = {
      id: t.id,
      name,
      category_id: catId,
      schedule_type: type,
      weekdays: type === 'weekly' ? [...wds] : [],
      interval_days: type === 'interval' ? n * (f.get('unit') === 'w' ? 7 : 1) : null,
      day_of_month: type === 'monthly' ? Math.min(31, Math.max(1, parseInt(f.get('dom'), 10) || 1)) : null,
      start_date: type === 'interval' ? f.get('start') || todayISO : t.start_date || todayISO,
      notes: f.get('notes').trim() || null,
    };
    try {
      const saved = await db.saveTask(payload);
      if (isNew) state.tasks.push(saved);
      else Object.assign(state.tasks.find((x) => x.id === t.id), saved);
      closeSheet(); render();
      toast(isNew ? 'Tarea creada' : 'Cambios guardados');
    } catch (err) { toast('No se pudo guardar: ' + err.message); }
  };

  $('#task-del')?.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar "${t.name}"? También se borrará su historial.`)) return;
    try {
      await db.deleteTask(t.id);
      state.tasks = state.tasks.filter((x) => x.id !== t.id);
      closeSheet(); render();
    } catch (err) { toast('No se pudo eliminar: ' + err.message); }
  });
}

/* ============ PENDIENTES ============ */

const createdDay = (b) => S.parseISO(S.toISO(new Date(b.created_at)));
const pendingItems = () => state.backlog.filter((b) => !b.done_on).sort((a, b) => a.created_at.localeCompare(b.created_at));

function ageText(days) {
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 14) return `hace ${days} días`;
  if (days < 60) return `hace ${Math.round(days / 7)} semanas`;
  const m = Math.round(days / 30);
  return m === 1 ? 'hace un mes' : `hace ${m} meses`;
}

function renderPendientes() {
  const today = S.today();
  const all = pendingItems();
  const f = state.pendFilter;
  const pending = f === 'all' ? all : all.filter((b) => b.effort === f);
  const done = state.backlog.filter((b) => b.done_on).sort((a, b) => b.done_on.localeCompare(a.done_on));

  const filters = all.length > 2
    ? `<div class="pills">${[['all', `Todas · ${all.length}`], ...Object.entries(EFFORT).map(([k, e]) => [k, `${e.icon} ${e.label}`])]
        .map(([k, l]) => `<button class="pill ${k === f ? 'sel' : ''}" data-act="pend-filter" data-f="${k}">${l}</button>`).join('')}</div>`
    : '';

  const rows = pending.map((b) => {
    const age = S.diffDays(createdDay(b), today);
    const e = EFFORT[b.effort];
    return `<div class="brow">
      <button class="bcheck" data-act="b-done" data-id="${b.id}" aria-label="Marcar como hecha"></button>
      <button class="brow-main" data-act="b-edit" data-id="${b.id}">
        <span class="row-title">${esc(b.name)}</span>
        <span class="row-sub">${e ? `${e.icon} ${e.label} · ` : ''}<span class="${age >= 60 ? 'old' : ''}">apuntada ${ageText(age)}</span></span>
      </button></div>`;
  }).join('');

  const doneRows = done.map((b) => `
    <button class="brow-main done" data-act="b-edit" data-id="${b.id}">
      <span class="row-title">${esc(b.name)}</span><span class="row-date">${S.fmtShort(S.parseISO(b.done_on))}</span>
    </button>`).join('');

  app.innerHTML = `${demoBanner()}
  <header class="page-head"><h1>Pendientes</h1><p class="muted">Lo que siempre pospones, para cuando tengas un rato.</p></header>
  <form class="quick-add" id="quick-add">
    <input class="input" name="name" placeholder="Apunta algo pendiente…" maxlength="80" autocomplete="off" enterkeyhint="done">
    <button class="btn primary" type="submit" aria-label="Añadir"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
  </form>
  ${all.length ? '<button class="dice" data-act="pick">🎲 Elige una por mí</button>' : ''}
  ${filters}
  ${rows ? `<div class="card list">${rows}</div>`
    : all.length ? '<div class="empty card"><p class="muted">No hay pendientes de este tipo.</p></div>'
    : '<div class="empty card"><div class="empty-emoji">🗂️</div><p><b>Lista vacía</b></p><p class="muted">Apunta aquí eso que llevas tiempo posponiendo: ordenar el armario, revisar papeles…</p></div>'}
  ${done.length ? `<details class="done-list"><summary>Hechas · ${done.length}</summary><div class="card list">${doneRows}</div></details>` : ''}`;

  $('#quick-add').onsubmit = async (e) => {
    e.preventDefault();
    const name = e.target.querySelector('input').value.trim();
    if (!name) return;
    try {
      const saved = await db.saveBacklog({ name, effort: state.pendFilter === 'all' ? null : state.pendFilter, notes: null, done_on: null });
      state.backlog.push(saved);
      render();
      $('#quick-add input').focus();
    } catch (err) { toast('No se pudo guardar: ' + err.message); }
  };
}

async function setBacklogDone(b, date) {
  const prev = b.done_on;
  b.done_on = date;
  try {
    Object.assign(b, await db.saveBacklog({ id: b.id, done_on: date }));
    render();
  } catch (err) {
    b.done_on = prev;
    toast('No se pudo guardar: ' + err.message);
  }
}

function doneSheet(b) {
  const today = S.toISO(S.today()), yesterday = S.toISO(S.addDays(S.today(), -1));
  const el = openSheet(`
    <h2>¿Cuándo la hiciste?</h2>
    <p class="sheet-sub">${esc(b.name)}</p>
    <form class="form" id="done-form">
      <div class="seg two"><button type="button" class="sel" data-d="${today}">Hoy</button><button type="button" data-d="${yesterday}">Ayer</button></div>
      <label class="field"><span>Otra fecha</span><input class="input" type="date" name="date" value="${today}" max="${today}"></label>
      <div class="sheet-actions"><button type="button" class="btn ghost" id="done-cancel">Cancelar</button><button class="btn primary" type="submit">¡Hecha!</button></div>
    </form>`);
  const input = el.querySelector('[name=date]');
  const sync = () => el.querySelectorAll('[data-d]').forEach((x) => x.classList.toggle('sel', x.dataset.d === input.value));
  el.addEventListener('click', (e) => { const d = e.target.closest('[data-d]'); if (d) { input.value = d.dataset.d; sync(); } });
  input.addEventListener('input', sync);
  $('#done-cancel').onclick = closeSheet;
  $('#done-form').onsubmit = async (e) => {
    e.preventDefault();
    closeSheet();
    await setBacklogDone(b, input.value || today);
    toast('¡Una menos! 🎉');
  };
}

function backlogSheet(b) {
  let effort = b.effort || null;
  const el = openSheet(`
    <h2>${b.done_on ? 'Pendiente hecha' : 'Editar pendiente'}</h2>
    <form class="form" id="b-form">
      <input class="input big" name="name" value="${esc(b.name)}" required maxlength="80">
      <div class="field-label">Esfuerzo</div>
      <div class="seg four">
        <button type="button" data-effort="">Sin indicar</button>
        ${Object.entries(EFFORT).map(([k, e]) => `<button type="button" data-effort="${k}">${e.icon} ${e.label}</button>`).join('')}
      </div>
      <label class="field"><span>Nota (opcional)</span><input class="input" name="notes" value="${esc(b.notes)}" maxlength="120"></label>
      ${b.done_on ? `<label class="field"><span>Hecha el</span><input class="input" type="date" name="done_on" value="${b.done_on}" max="${S.toISO(S.today())}"></label>
        <button type="button" class="link" id="b-undo">Volver a ponerla como pendiente</button>` : ''}
      <p class="muted small">Apuntada el ${S.fmtLong(createdDay(b))}</p>
      <div class="sheet-actions">
        <button type="button" class="btn ghost danger" id="b-del">Eliminar</button>
        <button type="button" class="btn ghost" id="b-cancel">Cancelar</button>
        <button class="btn primary" type="submit">Guardar</button>
      </div>
    </form>`);
  const sync = () => el.querySelectorAll('[data-effort]').forEach((x) => x.classList.toggle('sel', (x.dataset.effort || null) === effort));
  sync();
  el.addEventListener('click', (e) => { const x = e.target.closest('[data-effort]'); if (x) { effort = x.dataset.effort || null; sync(); } });
  $('#b-cancel').onclick = closeSheet;
  $('#b-undo')?.addEventListener('click', async () => { closeSheet(); await setBacklogDone(b, null); });
  $('#b-del').onclick = async () => {
    if (!confirm(`¿Eliminar "${b.name}"?`)) return;
    try {
      await db.deleteBacklog(b.id);
      state.backlog = state.backlog.filter((x) => x.id !== b.id);
      closeSheet(); render();
    } catch (err) { toast('No se pudo eliminar: ' + err.message); }
  };
  $('#b-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = f.get('name').trim();
    if (!name) return;
    const payload = { id: b.id, name, effort, notes: f.get('notes').trim() || null };
    if (b.done_on) payload.done_on = f.get('done_on') || b.done_on;
    try {
      Object.assign(b, await db.saveBacklog(payload));
      closeSheet(); render();
    } catch (err) { toast('No se pudo guardar: ' + err.message); }
  };
}

function pickSheet(exclude) {
  const f = state.pendFilter;
  let pool = pendingItems().filter((b) => f === 'all' || b.effort === f);
  if (!pool.length) pool = pendingItems();
  const options = pool.length > 1 ? pool.filter((b) => b.id !== exclude) : pool;
  const b = options[Math.floor(Math.random() * options.length)];
  const e = EFFORT[b.effort];
  const age = S.diffDays(createdDay(b), S.today());
  openSheet(`
    <div class="pick">
      <div class="pick-emoji">🎲</div>
      <p class="muted">¿Qué tal si hoy haces…?</p>
      <h2>${esc(b.name)}</h2>
      ${b.notes ? `<p class="muted">${esc(b.notes)}</p>` : ''}
      <p class="pick-meta">${e ? `${e.icon} ${e.label} · ` : ''}Apuntada ${ageText(age)}</p>
    </div>
    <div class="sheet-actions">
      ${pool.length > 1 ? '<button class="btn ghost" id="pick-again">Otra</button>' : ''}
      <button class="btn primary" id="pick-done">Ya la he hecho ✓</button>
    </div>`);
  $('#pick-again')?.addEventListener('click', () => pickSheet(b.id));
  $('#pick-done').onclick = async () => { closeSheet(); await setBacklogDone(b, S.toISO(S.today())); toast('¡Una menos! 🎉'); };
}

/* ============ MÉTRICAS ============ */

const PERIODS = [[7, '7 días'], [30, '30 días'], [90, '3 meses'], [365, '1 año']];
const periodName = { 7: 'los 7 días', 30: 'los 30 días', 90: 'los 3 meses', 365: 'el año' };

function heatLevel(x) {
  if (x.future) return 'future';
  if (!x.sched) return 'none';
  const r = x.done / x.sched;
  return r === 0 ? 'l0' : r < 0.5 ? 'l1' : r < 0.8 ? 'l2' : r < 1 ? 'l3' : 'l4';
}

function insights(m) {
  const out = [];
  if (m.rate != null && m.prevRate != null) {
    const d = Math.round((m.rate - m.prevRate) * 100);
    if (d >= 3) out.push(['📈', `Has mejorado <b>${d} puntos</b> respecto a ${periodName[m.period]} anteriores.`]);
    else if (d <= -3) out.push(['📉', `Has bajado <b>${-d} puntos</b> respecto a ${periodName[m.period]} anteriores.`]);
    else out.push(['〰️', `Vas al mismo ritmo que en ${periodName[m.period]} anteriores.`]);
  }
  if (m.streak >= 3) out.push(['🔥', `Llevas <b>${m.streak} días seguidos</b> cumpliendo todo.`]);
  const wd = m.weekdays.filter((w) => w.sched >= 3);
  if (wd.length >= 3) {
    const sorted = [...wd].sort((a, b) => b.rate - a.rate);
    const hi = sorted[0], lo = sorted[sorted.length - 1];
    if (hi.rate - lo.rate >= 0.1)
      out.push(['📅', `Tu mejor día es el <b>${S.DOW_LONG[hi.day]}</b> (${pct(hi.rate)}) y el que más te cuesta, el <b>${S.DOW_LONG[lo.day]}</b> (${pct(lo.rate)}).`]);
  }
  const cats = m.cats.filter((c) => c.sched >= 3).sort((a, b) => b.rate - a.rate);
  if (cats.length >= 2 && cats[0].rate - cats[cats.length - 1].rate >= 0.1) {
    const name = (id) => esc((state.categories.find((c) => c.id === id) || NO_CAT).name);
    out.push(['🎯', `Lo que mejor llevas: <b>${name(cats[0].id)}</b>. Lo que más se resiste: <b>${name(cats[cats.length - 1].id)}</b>.`]);
  }
  return out;
}

function lastText(s) {
  if (s.daysSince == null) return 'Sin registros';
  if (s.daysSince === 0) return 'Hecha hoy';
  if (s.daysSince === 1) return 'Última vez: ayer';
  return `Última vez: hace ${s.daysSince} días`;
}

function renderMetricas() {
  const today = S.today();
  const head = `${demoBanner()}<header class="page-head"><h1>Métricas</h1></header>`;
  if (!state.tasks.length) {
    app.innerHTML = head + '<div class="empty card"><div class="empty-emoji">📊</div><p>Cuando tengas tareas y vayas marcándolas, aquí verás tus estadísticas.</p></div>' + backlogCard();
    return;
  }
  const m = computeMetrics(state.tasks, state.done, state.period, today);
  const delta = m.rate != null && m.prevRate != null ? Math.round((m.rate - m.prevRate) * 100) : null;

  const periods = PERIODS.map(([p, l]) => `<button class="pill ${p === state.period ? 'sel' : ''}" data-act="period" data-p="${p}">${l}</button>`).join('');

  const kpis = `
  <div class="kpis">
    <div class="kpi kpi-main">
      <div class="kpi-label">Cumplimiento</div>
      <div class="kpi-value">${pct(m.rate)}</div>
      ${delta != null ? `<div class="delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '▲' : delta < 0 ? '▼' : '='} ${Math.abs(delta)} pts</div>` : ''}
      <div class="bar"><span style="width:${(m.rate || 0) * 100}%"></span></div>
    </div>
    <div class="kpi"><div class="kpi-label">Hechas</div><div class="kpi-value sm">${m.done}<small>/${m.sched}</small></div></div>
    <div class="kpi"><div class="kpi-label">Racha actual</div><div class="kpi-value sm">${m.streak}<small> ${m.streak === 1 ? 'día' : 'días'}</small></div></div>
    <div class="kpi"><div class="kpi-label">Mejor racha</div><div class="kpi-value sm">${m.bestStreak}<small> ${m.bestStreak === 1 ? 'día' : 'días'}</small></div></div>
  </div>`;

  const ins = insights(m);
  const insightsHtml = ins.length ? `<div class="card pad insights">${ins.map(([e, t]) => `<div class="insight"><span>${e}</span><p>${t}</p></div>`).join('')}</div>` : '';

  const monthLabels = m.heat.map((col) => {
    const first = col.find((x) => x.date.getDate() === 1);
    return `<span>${first ? S.fmtShort(first.date).split(' ')[1] : ''}</span>`;
  }).join('');
  const heat = `
  <div class="card pad">
    <div class="card-title">Constancia <span class="muted">· últimas 20 semanas</span></div>
    <div class="heat-wrap">
      <div class="heat-days">${S.WEEK_ORDER.map((d, i) => `<span>${i % 2 === 0 ? S.DOW_LETTER[d] : ''}</span>`).join('')}</div>
      <div class="heat-main">
        <div class="heat-months">${monthLabels}</div>
        <div class="heat">${m.heat.map((col) => `<div class="heat-col">${col.map((x) =>
          `<span class="cell ${heatLevel(x)}" title="${S.fmtShort(x.date)}: ${x.sched ? `${x.done}/${x.sched}` : 'sin tareas'}"></span>`).join('')}</div>`).join('')}</div>
      </div>
    </div>
    <div class="legend"><span>Menos</span><i class="cell l0"></i><i class="cell l1"></i><i class="cell l2"></i><i class="cell l3"></i><i class="cell l4"></i><span>Más</span></div>
  </div>`;

  const trend = `
  <div class="card pad">
    <div class="card-title">Evolución semanal</div>
    <div class="vbars">${m.trend.map((w, i) => `
      <div class="vbar ${i === m.trend.length - 1 ? 'current' : ''}">
        <span class="vbar-val">${w.rate == null ? '' : Math.round(w.rate * 100)}</span>
        <div class="vbar-track"><span style="height:${(w.rate || 0) * 100}%"></span></div>
        <span class="vbar-label">${i % 3 === 0 || i === m.trend.length - 1 ? (i === m.trend.length - 1 ? 'Esta' : S.fmtShort(w.start)) : ''}</span>
      </div>`).join('')}</div>
  </div>`;

  const cats = [...m.cats].filter((c) => c.sched).sort((a, b) => b.rate - a.rate).map((c) => {
    const cat = state.categories.find((x) => x.id === c.id) || NO_CAT;
    return `<div class="hrow" style="--c:${cat.color}">
      <div class="hrow-head"><span><span class="cat-badge sm">${esc(cat.icon)}</span>${esc(cat.name)}</span><span><b>${pct(c.rate)}</b> <span class="muted small">${c.done}/${c.sched}</span></span></div>
      <div class="bar cat"><span style="width:${c.rate * 100}%"></span></div></div>`;
  }).join('');
  const catsHtml = cats ? `<div class="card pad"><div class="card-title">Por categoría</div>${cats}</div>` : '';

  const wdValid = m.weekdays.filter((w) => w.rate != null);
  const wdMax = wdValid.length ? Math.max(...wdValid.map((w) => w.rate)) : null;
  const wdMin = wdValid.length ? Math.min(...wdValid.map((w) => w.rate)) : null;
  const weekdays = `
  <div class="card pad">
    <div class="card-title">Por día de la semana</div>
    <div class="vbars daychart">${m.weekdays.map((w) => `
      <div class="vbar ${w.rate != null && w.rate === wdMax ? 'best' : ''} ${w.rate != null && w.rate === wdMin && wdMin !== wdMax ? 'worst' : ''}">
        <span class="vbar-val">${w.rate == null ? '' : Math.round(w.rate * 100)}</span>
        <div class="vbar-track"><span style="height:${(w.rate || 0) * 100}%"></span></div>
        <span class="vbar-label">${S.DOW_LETTER[w.day]}</span>
      </div>`).join('')}</div>
  </div>`;

  const taskLine = (s) => {
    const c = catOf(s.task);
    return `<div class="trow" style="--c:${c.color}">
      <span class="cat-badge sm">${esc(c.icon)}</span>
      <div class="trow-main"><div class="trow-title">${esc(s.task.name)}</div><div class="trow-sub">${s.done} de ${s.sched} veces · ${lastText(s)}</div></div>
      <div class="trow-pct">${pct(s.rate)}</div></div>`;
  };
  const attention = m.attention.length
    ? `<div class="card pad"><div class="card-title">⚠️ Necesita atención</div>${m.attention.map(taskLine).join('')}</div>` : '';
  const best = m.bestTasks.length
    ? `<div class="card pad"><div class="card-title">🌟 Lo que mejor llevas</div>${m.bestTasks.map(taskLine).join('')}</div>` : '';

  const all = m.taskStats.filter((s) => s.sched).sort((a, b) => b.rate - a.rate).map((s) => {
    const c = catOf(s.task);
    const freq = s.realGap != null && s.plannedGap
      ? `<span class="freq ${s.realGap > s.plannedGap * 1.25 ? 'warn' : ''}">Real: cada ~${num(Math.round(s.realGap * 10) / 10)} d · objetivo ${num(Math.round(s.plannedGap * 10) / 10)} d</span>` : '';
    return `<details class="tdetail" style="--c:${c.color}">
      <summary><span class="cat-badge sm">${esc(c.icon)}</span><span class="tdetail-name">${esc(s.task.name)}</span>
        <span class="mini-bar"><span style="width:${s.rate * 100}%"></span></span><b>${pct(s.rate)}</b></summary>
      <div class="tdetail-body"><span>${S.describe(s.task)}</span><span>${s.done} de ${s.sched} veces</span><span>${lastText(s)}</span>${freq}</div>
    </details>`;
  }).join('');
  const allHtml = all ? `<div class="card pad"><div class="card-title">Todas las tareas</div>${all}</div>` : '';

  app.innerHTML = `${head}
    <div class="pills">${periods}</div>
    ${m.sched ? kpis + insightsHtml : '<div class="empty card"><p>En este periodo aún no hay nada registrado.</p></div>'}
    ${heat}${trend}${catsHtml}${weekdays}${attention}${best}${backlogCard()}${allHtml}`;
}

function backlogCard() {
  if (!state.backlog.length) return '';
  const b = backlogMetrics(state.backlog, state.period, S.today());
  const days = (n) => (n == null ? '—' : `${Math.round(n)}<small> d</small>`);
  const max = Math.max(1, ...b.months.map((m) => Math.max(m.done, m.added)));
  const lines = [];
  if (b.addedInPeriod || b.doneInPeriod) {
    const msg = b.doneInPeriod > b.addedInPeriod ? 'La lista va menguando 💪'
      : b.doneInPeriod === b.addedInPeriod ? 'La lista se mantiene igual'
      : 'La lista crece más rápido de lo que la vacías';
    lines.push(['⚖️', `En ${periodName[state.period]} has apuntado <b>${b.addedInPeriod}</b> y has hecho <b>${b.doneInPeriod}</b>. ${msg}.`]);
  }
  if (b.oldest) lines.push(['🕸️', `La que más lleva esperando: <b>${esc(b.oldest.b.name)}</b> (${b.oldest.age} días).`]);
  const quickPending = b.byEffort.quick.pending;
  if (quickPending) lines.push(['⚡', `Tienes <b>${quickPending}</b> ${quickPending === 1 ? 'pendiente rápida' : 'pendientes rápidas'}: ideales para un rato muerto.`]);
  const effortWaits = Object.entries(b.byEffort).filter(([, v]) => v.avgWait != null);
  const effortRow = effortWaits.length >= 2
    ? `<div class="effort-row">${effortWaits.map(([k, v]) => `<span>${EFFORT[k].icon} ${EFFORT[k].label}: <b>${Math.round(v.avgWait)} d</b></span>`).join('')}</div>` : '';

  return `<div class="card pad">
    <div class="card-title">🗂️ Pendientes</div>
    <div class="mini-kpis">
      <div><b>${b.pending}</b><span>por hacer</span></div>
      <div><b>${b.doneInPeriod}</b><span>hechas en ${PERIODS.find(([p]) => p === state.period)[1]}</span></div>
      <div><b>${days(b.avgWait)}</b><span>tardas de media</span></div>
    </div>
    ${lines.length ? `<div class="insights small-gap">${lines.map(([e, t]) => `<div class="insight"><span>${e}</span><p>${t}</p></div>`).join('')}</div>` : ''}
    ${effortRow ? `<div class="sub-title">Lo que tardas según el esfuerzo</div>${effortRow}` : ''}
    <div class="sub-title">Hechas y apuntadas por mes</div>
    <div class="vbars months">${b.months.map((m) => `
      <div class="vbar">
        <span class="vbar-val">${m.done || ''}</span>
        <div class="vbar-track pair"><span class="added" style="height:${(m.added / max) * 100}%"></span><span style="height:${(m.done / max) * 100}%"></span></div>
        <span class="vbar-label">${m.label}</span>
      </div>`).join('')}</div>
    <div class="legend"><i class="key added"></i><span>Apuntadas</span><i class="key"></i><span>Hechas</span></div>
  </div>`;
}

/* ============ Utilidades ============ */

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function exportData() {
  const data = {
    exportado: new Date().toISOString(),
    categories: state.categories,
    tasks: state.tasks,
    backlog: state.backlog,
    completions: [...state.done].map((k) => { const [task_id, date] = k.split('|'); return { task_id, date }; }),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `al-dia-copia-${S.toISO(S.today())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ============ Eventos ============ */

app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'toggle') toggle(b.dataset.id, S.toISO(state.date));
  else if (act === 'date') { state.date = S.parseISO(b.dataset.date); render(); }
  else if (act === 'week') { state.date = S.addDays(state.date, 7 * +b.dataset.dir); render(); }
  else if (act === 'today') { state.date = S.today(); render(); }
  else if (act === 'new-task') taskSheet();
  else if (act === 'edit-task') taskSheet(state.tasks.find((t) => t.id === b.dataset.id));
  else if (act === 'new-cat') catSheet();
  else if (act === 'edit-cat') catSheet(state.categories.find((c) => c.id === b.dataset.id));
  else if (act === 'period') { state.period = +b.dataset.p; render(); }
  else if (act === 'go-pend') { state.view = 'pendientes'; render(); window.scrollTo(0, 0); }
  else if (act === 'pend-filter') { state.pendFilter = b.dataset.f; render(); }
  else if (act === 'pick') pickSheet();
  else if (act === 'b-done') doneSheet(state.backlog.find((x) => x.id === b.dataset.id));
  else if (act === 'b-edit') backlogSheet(state.backlog.find((x) => x.id === b.dataset.id));
  else if (act === 'export') exportData();
  else if (act === 'reset-demo') { if (confirm('¿Volver a generar los datos de ejemplo?')) { await db.reset(); await loadAll(); render(); } }
  else if (act === 'logout') { if (confirm('¿Cerrar sesión?')) { await db.signOut(); renderAuth('login'); } }
});

tabbar.addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  if (state.view === b.dataset.view && b.dataset.view === 'hoy') state.date = S.today();
  state.view = b.dataset.view;
  render();
  window.scrollTo(0, 0);
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetRoot.classList.contains('open')) closeSheet(); });

// Si la app se queda abierta y cambia el día, vuelve a "hoy"
let lastDay = S.toISO(S.today());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = S.toISO(S.today());
  if (now !== lastDay) { lastDay = now; state.date = S.today(); if (!tabbar.hidden) render(); }
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
