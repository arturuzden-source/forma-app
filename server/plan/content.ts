import { z } from 'zod';
import type { Exercise } from '../catalog/store.js';
import type { Profile } from '../profile/schema.js';

export const itemSchema = z.object({
  exercise_id: z.string().min(1).max(60),
  sets: z.number().int().min(1).max(10),
  reps: z.number().int().min(1).max(100).nullable(),
  seconds: z.number().int().min(5).max(7200).nullable(),
  meters: z.number().int().min(50).max(42195).nullable(),
  rest_s: z.number().int().min(0).max(600),
  note: z.string().max(200).nullable()
});
export type Item = z.infer<typeof itemSchema>;

export const contentSchema = z.object({
  warmup_min: z.number().int().min(0).max(30),
  cooldown_min: z.number().int().min(0).max(20),
  items: z.array(itemSchema).min(1).max(12)
});
export type Content = z.infer<typeof contentSchema>;

/** Сколько секунд занимает рабочая часть одного подхода. */
export function workSeconds(it: Item): number {
  if (it.reps) return it.reps * 3;
  if (it.seconds) return it.seconds;
  if (it.meters) return Math.round(it.meters * 0.36); // 6 мин/км — осторожная оценка
  return 30;
}

const TRANSITION_S = 45;

/** Полная длительность занятия: разминка, все подходы, отдых между ними, переходы и заминка. */
export function durationMinutes(c: Content): number {
  let s = c.warmup_min * 60 + c.cooldown_min * 60;
  for (const it of c.items) s += it.sets * workSeconds(it) + Math.max(0, it.sets - 1) * it.rest_s + TRANSITION_S;
  return Math.ceil(s / 60);
}

/** Сократить занятие до лимита: сначала меньше подходов, затем меньше упражнений с конца. */
export function shorten(c: Content, maxMin: number): Content | null {
  const x: Content = JSON.parse(JSON.stringify(c));
  x.warmup_min = Math.min(x.warmup_min, maxMin <= 25 ? 4 : x.warmup_min);
  x.cooldown_min = Math.min(x.cooldown_min, maxMin <= 25 ? 2 : x.cooldown_min);
  let guard = 50;
  while (durationMinutes(x) > maxMin && guard-- > 0) {
    const biggest = x.items.reduce((bi, it, i, arr) => (it.sets > arr[bi]!.sets ? i : bi), 0);
    if (x.items[biggest]!.sets > 2) {
      x.items[biggest]!.sets--;
      continue;
    }
    const long = x.items.findIndex((it) => it.seconds && it.seconds > 600);
    if (long >= 0) {
      x.items[long]!.seconds = Math.max(300, Math.floor(x.items[long]!.seconds! * 0.75));
      continue;
    }
    if (x.items.length > 1) {
      x.items.pop();
      continue;
    }
    if (x.items[0]!.sets > 1) {
      x.items[0]!.sets--;
      continue;
    }
    break;
  }
  return durationMinutes(x) <= maxMin ? x : null;
}

/** Уменьшить объём на долю (0.3 = −30%), не меняя набор упражнений. */
export function reduceVolume(c: Content, share: number): Content {
  const x: Content = JSON.parse(JSON.stringify(c));
  for (const it of x.items) {
    it.sets = Math.max(1, Math.round(it.sets * (1 - share)));
    if (it.seconds && it.seconds > 600) it.seconds = Math.round(it.seconds * (1 - share));
  }
  return x;
}

// ——— Допустимость упражнений для пользователя ———

const IMPACT_RISK = /колен|голеност|стоп|прыж|ахилл|мениск|связк/i;

export function healthText(p: Profile) {
  return [...(p.pains ?? []), ...(p.injuries ?? []), p.doctor_notes ?? '', ...(p.discomfort_exercises ?? [])].join(' ');
}

export function exerciseAllowed(e: Exercise, p: Profile): { ok: true } | { ok: false; reason: string } {
  const places = p.places ?? [];
  if (!e.places.some((pl) => places.includes(pl as never))) return { ok: false, reason: 'место недоступно' };
  const eq = new Set<string>([...(p.equipment ?? []), 'none']);
  if (!e.equipment.every((x) => eq.has(x))) return { ok: false, reason: 'нет оборудования' };
  if (e.pattern === 'run' && p.can_run === false) return { ok: false, reason: 'бег недоступен' };
  if (e.tags.some((t) => t === 'impact' || t === 'jumps') && IMPACT_RISK.test(healthText(p))) return { ok: false, reason: 'ударная нагрузка при ограничении' };
  const disc = (p.discomfort_exercises ?? []).map((s) => s.toLowerCase().trim()).filter((s) => s.length >= 4);
  if (disc.some((d) => e.name.toLowerCase().includes(d) || d.includes(e.name.toLowerCase()))) return { ok: false, reason: 'вызывает дискомфорт' };
  if ((p.experience === 'none' || p.experience === 'beginner') && e.level >= 3) return { ok: false, reason: 'слишком сложно для старта' };
  return { ok: true };
}

/** Мера упражнения должна совпадать с заданными полями. */
export function itemMatchesMeasure(it: Item, e: Exercise): boolean {
  if (e.measure === 'reps') return it.reps != null;
  if (e.measure === 'time') return it.seconds != null;
  return it.meters != null || it.seconds != null;
}
