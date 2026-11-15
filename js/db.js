// Capa de datos: Supabase (real) o localStorage (modo demo)
import { today, addDays, toISO, isDue } from './schedule.js';

export const DEFAULT_CATEGORIES = [
  { name: 'Skincare', icon: '🧴', color: '#ec4899' },
  { name: 'Limpieza', icon: '🧹', color: '#3b82f6' },
  { name: 'Cocina y compra', icon: '🍳', color: '#f97316' },
  { name: 'Salud', icon: '💊', color: '#8b5cf6' },
];

export async function createDB(config) {
  if (config.SUPABASE_URL && config.SUPABASE_ANON_KEY) return createSupabaseDB(config);
  return createLocalDB();
}

/* ---------------- Supabase ---------------- */

async function createSupabaseDB({ SUPABASE_URL, SUPABASE_ANON_KEY }) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const q = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
  const save = (table, obj) => {
    const { id, ...rest } = obj;
    return id
      ? q(sb.from(table).update(rest).eq('id', id).select().single())
      : q(sb.from(table).insert(rest).select().single());
  };

  return {
    demo: false,
    async getSession() { const { data } = await sb.auth.getSession(); return data.session; },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; },
    async signUp(email, password) { const { data, error } = await sb.auth.signUp({ email, password }); if (error) throw error; return data.session; },
    async signOut() { await sb.auth.signOut(); },

    listCategories: () => q(sb.from('categories').select('*').order('position').order('created_at')),
    saveCategory: (c) => save('categories', c),
    deleteCategory: (id) => q(sb.from('categories').delete().eq('id', id)),

    listTasks: () => q(sb.from('tasks').select('*').order('created_at')),
    saveTask: (t) => save('tasks', t),
    deleteTask: (id) => q(sb.from('tasks').delete().eq('id', id)),

    listBacklog: () => q(sb.from('backlog').select('*').order('created_at')),
    saveBacklog: (b) => save('backlog', b),
    deleteBacklog: (id) => q(sb.from('backlog').delete().eq('id', id)),

    async listCompletions(from, to) {
      const out = [];
      for (let i = 0; ; i += 1000) {
        const rows = await q(sb.from('completions').select('task_id,date').gte('date', from).lte('date', to).order('date').range(i, i + 999));
        out.push(...rows);
        if (rows.length < 1000) break;
      }
      return out;
    },
    async setDone(task_id, date, done) {
      if (done) await q(sb.from('completions').upsert({ task_id, date }, { onConflict: 'task_id,date', ignoreDuplicates: true }));
      else await q(sb.from('completions').delete().eq('task_id', task_id).eq('date', date));
    },
  };
}

/* ---------------- Modo demo (solo este navegador) ---------------- */

const KEY = 'aldia-demo-v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function persist(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* sin almacenamiento */ } }

function seedDemo() {
  const t0 = today();
  const start = toISO(addDays(t0, -150));
  const categories = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, id: uid(), position: i }));
  const C = (i) => categories[i].id;
  const base = { notes: null, weekdays: [], interval_days: null, day_of_month: null, start_date: start };
  const defs = [
    [{ name: 'Retinol', category_id: C(0), schedule_type: 'weekly', weekdays: [1, 4], notes: 'Solo por la noche' }, 0.9],
    [{ name: 'Exfoliante', category_id: C(0), schedule_type: 'weekly', weekdays: [3] }, 0.75],
    [{ name: 'Mascarilla hidratante', category_id: C(0), schedule_type: 'weekly', weekdays: [0] }, 0.55],
    [{ name: 'Cambiar sábanas', category_id: C(1), schedule_type: 'interval', interval_days: 7 }, 0.8],
    [{ name: 'Limpieza a fondo del baño', category_id: C(1), schedule_type: 'interval', interval_days: 14 }, 0.45],
    [{ name: 'Aspirar la casa', category_id: C(1), schedule_type: 'weekly', weekdays: [2, 6] }, 0.7],
    [{ name: 'Hacer la compra', category_id: C(2), schedule_type: 'weekly', weekdays: [6] }, 0.9],
    [{ name: 'Cocinar para la semana', category_id: C(2), schedule_type: 'weekly', weekdays: [0], notes: 'Táperes para lunes a miércoles' }, 0.65],
    [{ name: 'Revisar la despensa y la nevera', category_id: C(2), schedule_type: 'interval', interval_days: 14 }, 0.6],
    [{ name: 'Vitaminas', category_id: C(3), schedule_type: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] }, 0.85],
    [{ name: 'Cambiar el cepillo de dientes', category_id: C(3), schedule_type: 'interval', interval_days: 84 }, 0.7],
  ];
  const tasks = defs.map(([t]) => ({ ...base, ...t, id: uid(), created_at: new Date().toISOString() }));
  const completions = [];
  for (let i = 150; i >= 1; i--) {
    const d = addDays(t0, -i), iso = toISO(d);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const trend = 0.85 + 0.15 * (1 - i / 150); // mejora poco a poco
    tasks.forEach((t, j) => {
      if (isDue(t, d, iso) && Math.random() < defs[j][1] * trend * (weekend ? 0.85 : 1.05)) completions.push({ task_id: t.id, date: iso });
    });
  }
  const ago = (n) => new Date(addDays(t0, -n).getTime() + 10 * 3600e3).toISOString();
  const backlog = [
    ['Ordenar el armario', 'big', 95, null, 'Sacar la ropa de verano'],
    ['Organizar las fotos del móvil', 'medium', 70, null],
    ['Arreglar el cajón que se atasca', 'quick', 40, null],
    ['Limpiar el horno a fondo', 'medium', 28, null],
    ['Devolver el pedido de Zara', 'quick', 6, null],
    ['Vaciar el trastero', 'big', 140, null],
    ['Cambiar las bombillas fundidas', 'quick', 60, 52],
    ['Ordenar el cajón de papeles', 'medium', 120, 75],
    ['Limpiar los cristales', 'medium', 45, 20],
    ['Coser el botón del abrigo', 'quick', 30, 9],
    ['Organizar el botiquín', 'quick', 90, 33],
  ].map(([name, effort, created, doneAgo, notes]) => ({
    id: uid(), name, effort, notes: notes || null, created_at: ago(created), done_on: doneAgo == null ? null : toISO(addDays(t0, -doneAgo)),
  }));
  return { categories, tasks, completions, backlog };
}

function createLocalDB() {
  let data = load() || seedDemo();
  if (!data.backlog) data.backlog = seedDemo().backlog; // demos guardadas antes de existir "Pendientes"
  persist(data);
  const commit = () => persist(data);
  const upsert = (list, obj) => {
    if (obj.id) { const cur = list.find((x) => x.id === obj.id); Object.assign(cur, obj); return { ...cur }; }
    const created = { ...obj, id: uid(), created_at: new Date().toISOString() };
    list.push(created);
    return { ...created };
  };

  return {
    demo: true,
    async getSession() { return { demo: true }; },
    async signOut() {},
    async reset() { data = seedDemo(); commit(); },

    async listCategories() { return data.categories.map((c) => ({ ...c })).sort((a, b) => a.position - b.position); },
    async saveCategory(c) { const r = upsert(data.categories, c); commit(); return r; },
    async deleteCategory(id) {
      data.categories = data.categories.filter((c) => c.id !== id);
      data.tasks.forEach((t) => { if (t.category_id === id) t.category_id = null; });
      commit();
    },

    async listTasks() { return data.tasks.map((t) => ({ ...t, weekdays: [...(t.weekdays || [])] })); },
    async saveTask(t) { const r = upsert(data.tasks, t); commit(); return r; },
    async deleteTask(id) {
      data.tasks = data.tasks.filter((t) => t.id !== id);
      data.completions = data.completions.filter((c) => c.task_id !== id);
      commit();
    },

    async listBacklog() { return data.backlog.map((b) => ({ ...b })).sort((a, b) => a.created_at.localeCompare(b.created_at)); },
    async saveBacklog(b) { const r = upsert(data.backlog, b); commit(); return r; },
    async deleteBacklog(id) { data.backlog = data.backlog.filter((b) => b.id !== id); commit(); },

    async listCompletions(from, to) { return data.completions.filter((c) => c.date >= from && c.date <= to); },
    async setDone(task_id, date, done) {
      data.completions = data.completions.filter((c) => !(c.task_id === task_id && c.date === date));
      if (done) data.completions.push({ task_id, date });
      commit();
    },
  };
}
