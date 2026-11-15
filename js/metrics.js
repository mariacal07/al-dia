// Cálculo de métricas a partir de las tareas y lo marcado como hecho
import { isDue, toISO, parseISO, addDays, startOfWeek, diffDays, plannedGap, WEEK_ORDER } from './schedule.js';

export const WINDOW = 400; // días de historial que se analizan

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Métricas de la lista de pendientes */
export function backlogMetrics(items, period, today) {
  const from = toISO(addDays(today, -(period - 1)));
  const created = (b) => toISO(new Date(b.created_at));
  const pending = items.filter((b) => !b.done_on);
  const done = items.filter((b) => b.done_on);
  const waits = done.map((b) => Math.max(0, diffDays(parseISO(created(b)), parseISO(b.done_on))));
  const ages = pending.map((b) => ({ b, age: diffDays(parseISO(created(b)), today) })).sort((a, b) => b.age - a.age);

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const m = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const prefix = toISO(m).slice(0, 7);
    months.push({
      label: MONTHS_SHORT[m.getMonth()],
      done: done.filter((b) => b.done_on.startsWith(prefix)).length,
      added: items.filter((b) => created(b).startsWith(prefix)).length,
    });
  }

  const byEffort = {};
  for (const k of ['quick', 'medium', 'big']) {
    const w = done.filter((b) => b.effort === k).map((b) => diffDays(parseISO(created(b)), parseISO(b.done_on)));
    byEffort[k] = { pending: pending.filter((b) => b.effort === k).length, avgWait: w.length ? w.reduce((a, c) => a + c, 0) / w.length : null };
  }

  return {
    pending: pending.length,
    doneTotal: done.length,
    doneInPeriod: done.filter((b) => b.done_on >= from).length,
    addedInPeriod: items.filter((b) => created(b) >= from).length,
    avgWait: waits.length ? waits.reduce((a, c) => a + c, 0) / waits.length : null,
    avgAge: ages.length ? ages.reduce((a, c) => a + c.age, 0) / ages.length : null,
    oldest: ages[0] || null,
    months,
    byEffort,
  };
}

/**
 * Regla: una tarea que tocaba un día cuenta como "programada".
 * Si ese día es hoy y aún no está hecha, no cuenta (el día no ha terminado).
 */
export function computeMetrics(tasks, done, period, today) {
  const tISO = toISO(today);
  const start = addDays(today, -(WINDOW - 1));
  const pFrom = toISO(addDays(today, -(period - 1)));
  const hasPrev = period * 2 <= WINDOW;
  const prevFrom = toISO(addDays(today, -(period * 2 - 1)));

  const daily = [];
  const byTask = new Map(tasks.map((t) => [t.id, { task: t, sched: 0, done: 0, dates: [], lastDone: null }]));
  const byWeekday = Array.from({ length: 7 }, () => ({ sched: 0, done: 0 }));
  const byCat = new Map();
  const P = { sched: 0, done: 0 }, Prev = { sched: 0, done: 0 };

  for (let i = 0; i < WINDOW; i++) {
    const d = addDays(start, i), iso = toISO(d);
    const inP = iso >= pFrom;
    const inPrev = hasPrev && iso >= prevFrom && iso < pFrom;
    let ds = 0, dn = 0;
    for (const t of tasks) {
      const isDone = done.has(t.id + '|' + iso);
      const st = byTask.get(t.id);
      if (isDone) { st.lastDone = iso; if (inP) st.dates.push(iso); }
      if (!isDue(t, d, iso)) continue;
      if (iso === tISO && !isDone) continue;
      ds++; if (isDone) dn++;
      if (inP) {
        st.sched++; if (isDone) st.done++;
        const w = byWeekday[d.getDay()]; w.sched++; if (isDone) w.done++;
        const c = byCat.get(t.category_id ?? null) || { sched: 0, done: 0 };
        c.sched++; if (isDone) c.done++;
        byCat.set(t.category_id ?? null, c);
      }
      if (inPrev) { Prev.sched++; if (isDone) Prev.done++; }
    }
    if (inP) { P.sched += ds; P.done += dn; }
    daily.push({ iso, date: d, sched: ds, done: dn });
  }

  // Rachas: días seguidos con todo hecho (los días sin tareas no rompen la racha)
  let current = 0;
  for (let i = daily.length - 1; i >= 0; i--) {
    const x = daily[i];
    if (!x.sched) continue;
    if (x.done === x.sched) current++; else break;
  }
  let best = 0, run = 0;
  for (const x of daily) {
    if (!x.sched) continue;
    if (x.done === x.sched) { run++; best = Math.max(best, run); } else run = 0;
  }

  const byIso = new Map(daily.map((x) => [x.iso, x]));

  // Mapa de calor: 20 semanas (columnas = semanas, filas = lunes..domingo)
  const HEAT_WEEKS = 20;
  const hmStart = addDays(startOfWeek(today), -7 * (HEAT_WEEKS - 1));
  const heat = [];
  for (let w = 0; w < HEAT_WEEKS; w++) {
    const col = [];
    for (let j = 0; j < 7; j++) {
      const d = addDays(hmStart, w * 7 + j), iso = toISO(d), x = byIso.get(iso);
      col.push({ iso, date: d, future: iso > tISO, sched: x?.sched || 0, done: x?.done || 0 });
    }
    heat.push(col);
  }

  // Evolución semanal: 12 semanas
  const trend = [];
  const ws = startOfWeek(today);
  for (let w = 11; w >= 0; w--) {
    const s = addDays(ws, -7 * w);
    let sc = 0, dn = 0;
    for (let j = 0; j < 7; j++) { const x = byIso.get(toISO(addDays(s, j))); if (x) { sc += x.sched; dn += x.done; } }
    trend.push({ start: s, sched: sc, done: dn, rate: sc ? dn / sc : null });
  }

  // Por tarea
  const taskStats = [...byTask.values()].map((s) => {
    const gaps = [];
    for (let i = 1; i < s.dates.length; i++) gaps.push(diffDays(parseISO(s.dates[i - 1]), parseISO(s.dates[i])));
    return {
      ...s,
      rate: s.sched ? s.done / s.sched : null,
      realGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
      plannedGap: plannedGap(s.task),
      daysSince: s.lastDone ? diffDays(parseISO(s.lastDone), today) : null,
    };
  });

  const ranked = taskStats.filter((x) => x.sched >= 2);
  const attention = ranked.filter((x) => x.rate < 0.7).sort((a, b) => a.rate - b.rate).slice(0, 4);
  const bestTasks = ranked.filter((x) => x.rate >= 0.8).sort((a, b) => b.rate - a.rate || b.sched - a.sched).slice(0, 3);

  const weekdays = WEEK_ORDER.map((d) => ({ day: d, ...byWeekday[d], rate: byWeekday[d].sched ? byWeekday[d].done / byWeekday[d].sched : null }));
  const cats = [...byCat.entries()].map(([id, v]) => ({ id, ...v, rate: v.sched ? v.done / v.sched : null }));

  return {
    period,
    sched: P.sched, done: P.done, rate: P.sched ? P.done / P.sched : null,
    prevRate: hasPrev && Prev.sched ? Prev.done / Prev.sched : null,
    streak: current, bestStreak: best,
    heat, trend, weekdays, cats, taskStats, attention, bestTasks,
  };
}
