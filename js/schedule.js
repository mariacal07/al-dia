// Fechas y reglas de repetición

export const DOW_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const DOW_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DOW_LETTER = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // lunes primero
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const diffDays = (a, b) =>
  Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);
export const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7));

export function isDue(t, d, iso = toISO(d)) {
  if (t.start_date && iso < t.start_date) return false;
  switch (t.schedule_type) {
    case 'weekly':
      return (t.weekdays || []).includes(d.getDay());
    case 'interval': {
      const n = diffDays(parseISO(t.start_date), d);
      return t.interval_days > 0 && n >= 0 && n % t.interval_days === 0;
    }
    case 'monthly': {
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return d.getDate() === Math.min(t.day_of_month || 1, last);
    }
    default:
      return false;
  }
}

export function nextDue(t, from) {
  for (let i = 0; i < 400; i++) {
    const d = addDays(from, i);
    if (isDue(t, d)) return d;
  }
  return null;
}

/** Días que separan, de media, dos veces seguidas que toca la tarea */
export function plannedGap(t) {
  if (t.schedule_type === 'weekly') return t.weekdays?.length ? 7 / t.weekdays.length : null;
  if (t.schedule_type === 'interval') return t.interval_days;
  if (t.schedule_type === 'monthly') return 30.4;
  return null;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function describe(t) {
  if (t.schedule_type === 'weekly') {
    const w = [...(t.weekdays || [])].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b));
    const key = w.join(',');
    if (w.length === 7) return 'Todos los días';
    if (key === '1,2,3,4,5') return 'De lunes a viernes';
    if (key === '6,0') return 'Fines de semana';
    if (w.length === 1) return `Cada ${DOW_LONG[w[0]]}`;
    return w.map((d) => cap(DOW_SHORT[d])).join(', ');
  }
  if (t.schedule_type === 'interval') {
    const n = t.interval_days;
    if (n === 1) return 'Todos los días';
    if (n % 7 === 0) return n === 7 ? 'Cada semana' : `Cada ${n / 7} semanas`;
    return `Cada ${n} días`;
  }
  if (t.schedule_type === 'monthly') return `El día ${t.day_of_month} de cada mes`;
  return '';
}

export const fmtLong = (d) => `${d.getDate()} de ${MONTHS[d.getMonth()]}`;
export const fmtShort = (d) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;

export function relative(d, ref) {
  const n = diffDays(ref, d);
  if (n === 0) return 'Hoy';
  if (n === 1) return 'Mañana';
  if (n === -1) return 'Ayer';
  if (n > 1 && n < 7) return `En ${n} días`;
  return fmtShort(d);
}
