import type { PlanItem } from './types';

export const STATUS_RU: Record<string, string> = {
  planned: 'План', started: 'Начато', done: 'Выполнено', partial: 'Частично', skipped: 'Пропущено', moved: 'Перенесено', cancelled: 'Отменено'
};

export function mmss(totalSec: number) {
  const s = Math.max(0, Math.round(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function planValue(it: Pick<PlanItem, 'reps' | 'seconds' | 'meters'>) {
  if (it.reps != null) return `${it.reps} повт`;
  if (it.seconds != null) return it.seconds >= 120 ? `${Math.round(it.seconds / 60)} мин` : `${it.seconds} с`;
  if (it.meters != null) return it.meters >= 1000 ? `${(it.meters / 1000).toLocaleString('ru-RU')} км` : `${it.meters} м`;
  return '—';
}

export function itemLine(it: PlanItem) {
  const base = it.sets > 1 ? `${it.sets} × ${planValue(it)}` : planValue(it);
  return it.rest_s && it.sets > 1 ? `${base} · отдых ${it.rest_s >= 60 ? mmss(it.rest_s) : `${it.rest_s} с`}` : base;
}

const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export function dayLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return { wd: WD[dt.getUTCDay()]!, day: d, long: dt.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) };
}

export function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
