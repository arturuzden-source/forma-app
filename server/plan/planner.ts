import type { Exercise } from '../catalog/store.js';
import type { Profile } from '../profile/schema.js';
import { contentSchema, durationMinutes, exerciseAllowed, itemMatchesMeasure, shorten, type Content, type Item } from './content.js';
import { addDays, minutesOf, timeOf, weekdayOf } from './time.js';

export type Window = { date: string; from: string; to: string; earliest: string };
export type Proposed = { date: string; start_time: string; title: string; purpose: string; content: Content };

/**
 * Свободные окна недели: только дни из расписания пользователя, начиная с сегодня,
 * без дней, где уже есть начатое или выполненное занятие.
 */
export function candidateWindows(p: Profile, weekStart: string, today: string, nowTime: string, busyDates: Set<string>): Window[] {
  const out: Window[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    if (date < today || busyDates.has(date)) continue;
    const wd = weekdayOf(date);
    for (const s of (p.schedule ?? []).filter((x) => x.day === wd)) {
      let earliest = s.from;
      if (date === today) {
        const soon = Math.ceil((minutesOf(nowTime) + 30) / 15) * 15;
        if (soon > minutesOf(earliest)) earliest = timeOf(Math.min(soon, 24 * 60 - 1));
      }
      if (minutesOf(s.to) - minutesOf(earliest) >= 15) out.push({ date, from: s.from, to: s.to, earliest });
    }
  }
  return out;
}

export function targetSessions(p: Profile, windows: Window[]) {
  const days = new Set(windows.map((w) => w.date)).size;
  return Math.max(0, Math.min(p.sessions_per_week ?? 3, days));
}

/** Серверная проверка плана. Возвращает список нарушений на русском; пустой — план допустим. */
export function validatePlan(plan: Proposed[], p: Profile, allowed: Map<string, Exercise>, windows: Window[]): string[] {
  const errs: string[] = [];
  const max = p.max_minutes ?? 60;
  const limit = targetSessions(p, windows);
  if (plan.length === 0 && windows.length > 0) errs.push('В плане нет ни одного занятия.');
  if (plan.length > limit) errs.push(`Занятий ${plan.length}, допустимо не больше ${limit}.`);
  const dates = plan.map((s) => s.date).sort();
  if (new Set(dates).size !== dates.length) errs.push('Два занятия в один день.');
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    run = addDays(dates[i - 1]!, 1) === dates[i] ? run + 1 : 1;
    if (run > 2) errs.push(`Больше двух тренировочных дней подряд (до ${dates[i]}): нужен день восстановления.`);
  }
  for (const s of plan) {
    const tag = `${s.date} «${s.title}»`;
    const parsed = contentSchema.safeParse(s.content);
    if (!parsed.success) {
      errs.push(`${tag}: неверная структура занятия.`);
      continue;
    }
    if (!s.title.trim() || !s.purpose.trim()) errs.push(`${tag}: нет названия или задачи занятия.`);
    const ws = windows.filter((w) => w.date === s.date);
    const dur = durationMinutes(s.content);
    if (ws.length === 0) errs.push(`${tag}: дата вне доступных дней расписания.`);
    else {
      const st = minutesOf(s.start_time);
      const fits = ws.some((w) => st >= minutesOf(w.earliest) && st + dur <= minutesOf(w.to));
      if (!fits) errs.push(`${tag}: начало ${s.start_time} и длительность ${dur} мин не помещаются в окно ${ws.map((w) => `${w.earliest}–${w.to}`).join(', ')}.`);
    }
    if (dur > max) errs.push(`${tag}: длительность ${dur} мин больше лимита ${max} мин (с разминкой, отдыхом и заминкой).`);
    const seen = new Set<string>();
    for (const it of s.content.items) {
      const e = allowed.get(it.exercise_id);
      if (!e) errs.push(`${tag}: упражнение «${it.exercise_id}» не из списка допустимых.`);
      else if (!itemMatchesMeasure(it, e)) errs.push(`${tag}: для «${e.name}» нужно ${e.measure === 'reps' ? 'число повторений' : e.measure === 'time' ? 'время в секундах' : 'дистанция или время'}.`);
      if (seen.has(it.exercise_id)) errs.push(`${tag}: упражнение «${it.exercise_id}» повторяется.`);
      seen.add(it.exercise_id);
    }
  }
  return errs;
}

export function allowedExercises(catalog: Exercise[], p: Profile): Map<string, Exercise> {
  return new Map(catalog.filter((e) => exerciseAllowed(e, p).ok).map((e) => [e.id, e]));
}

// ——— Резервный план по правилам (без ИИ) ———

function pickDays(windows: Window[], n: number): Window[] {
  const byDate = new Map<string, Window>();
  for (const w of windows) if (!byDate.has(w.date)) byDate.set(w.date, w);
  const dates = [...byDate.keys()].sort();
  const chosen: string[] = [];
  // Сначала дни через один, потом добираем оставшиеся.
  for (const d of dates) if (chosen.length < n && !chosen.some((c) => addDays(c, 1) === d)) chosen.push(d);
  for (const d of dates) if (chosen.length < n && !chosen.includes(d)) chosen.push(d);
  return chosen.sort().map((d) => byDate.get(d)!);
}

function firstOf(allowed: Map<string, Exercise>, ids: string[]) {
  return ids.find((id) => allowed.has(id));
}

function strengthItem(e: Exercise, beginner: boolean): Item {
  if (e.measure === 'time') return { exercise_id: e.id, sets: 3, reps: null, seconds: beginner ? 25 : 40, meters: null, rest_s: 60, note: null };
  return { exercise_id: e.id, sets: 3, reps: beginner ? 8 : 10, seconds: null, meters: null, rest_s: 90, note: 'с запасом 2–3 повтора' };
}

export function rulesPlan(p: Profile, allowed: Map<string, Exercise>, windows: Window[]): Proposed[] {
  const n = targetSessions(p, windows);
  const days = pickDays(windows, n);
  const beginner = p.experience === 'none' || p.experience === 'beginner' || (p.break_weeks ?? 0) >= 8;
  const wantsRun = (p.goals ?? []).some((g) => g.kind === 'endurance' || /бег|км|run/i.test(`${g.title} ${g.metric ?? ''}`)) && p.can_run !== false;
  const max = p.max_minutes ?? 60;

  const slots = {
    squat: firstOf(allowed, beginner ? ['squat-chair', 'squat-bw', 'db-goblet-squat', 'leg-press'] : ['db-goblet-squat', 'squat-bw', 'leg-press', 'lunge-back']),
    lunge: firstOf(allowed, ['lunge-back']),
    push: firstOf(allowed, beginner ? ['pushup-incline', 'pushup-knee', 'pushup', 'bench-press'] : ['pushup', 'bench-press', 'dips', 'pushup-incline']),
    pull: firstOf(allowed, beginner ? ['australian-row', 'pullup-negative', 'db-row', 'lat-pulldown'] : ['pullup', 'lat-pulldown', 'db-row', 'australian-row']),
    pull2: firstOf(allowed, ['db-row', 'australian-row', 'bar-hang']),
    hinge: firstOf(allowed, ['glute-bridge', 'db-rdl']),
    press: firstOf(allowed, ['db-press']),
    core: firstOf(allowed, ['plank', 'dead-bug', 'hanging-knee-raise'])
  };
  const A = [slots.squat, slots.push, slots.pull, slots.core].filter(Boolean) as string[];
  const B = [slots.lunge ?? slots.hinge, slots.pull2 ?? slots.pull, slots.press ?? slots.push, slots.hinge, slots.core].filter((x, i, a) => x && a.indexOf(x) === i) as string[];
  const runId = firstOf(allowed, beginner ? ['run-walk', 'run-easy'] : ['run-easy', 'run-walk']);

  return days.map((w, i) => {
    const isRun = wantsRun && runId && i % 2 === 1;
    let content: Content;
    let title: string;
    let purpose: string;
    if (isRun) {
      const minutes = Math.max(10, Math.min(30, max - 10));
      content = { warmup_min: 5, cooldown_min: 5, items: [{ exercise_id: runId!, sets: 1, reps: null, seconds: minutes * 60, meters: null, rest_s: 0, note: 'разговорный темп' }] };
      title = 'Лёгкий бег';
      purpose = 'Аэробная база без перегрузки';
    } else {
      const ids = i % 2 === 0 || !wantsRun ? (i % 4 < 2 ? A : B.length >= 3 ? B : A) : A;
      content = { warmup_min: 7, cooldown_min: 3, items: ids.map((id) => strengthItem(allowed.get(id)!, beginner)) };
      title = 'Сила: всё тело';
      purpose = beginner ? 'Освоить технику и задать стартовую нагрузку' : 'Базовая силовая нагрузка на всё тело';
    }
    const fitTo = Math.min(max, minutesOf(w.to) - minutesOf(w.earliest));
    const fitted = shorten(content, fitTo) ?? content;
    return { date: w.date, start_time: w.earliest, title, purpose, content: fitted };
  });
}

/** Занятие восстановления для чек-ина: подвижность и лёгкая разминка. */
export function recoveryContent(allowed: Map<string, Exercise>): Content {
  const items: Item[] = [];
  if (allowed.has('warmup-joint')) items.push({ exercise_id: 'warmup-joint', sets: 1, reps: null, seconds: 300, meters: null, rest_s: 0, note: 'медленно' });
  if (allowed.has('cat-cow')) items.push({ exercise_id: 'cat-cow', sets: 2, reps: 8, seconds: null, meters: null, rest_s: 30, note: null });
  if (allowed.has('stretch-hamstring')) items.push({ exercise_id: 'stretch-hamstring', sets: 2, reps: null, seconds: 30, meters: null, rest_s: 20, note: null });
  if (allowed.has('glute-bridge')) items.push({ exercise_id: 'glute-bridge', sets: 2, reps: 10, seconds: null, meters: null, rest_s: 45, note: 'без отягощения' });
  return { warmup_min: 0, cooldown_min: 0, items: items.length ? items : [{ exercise_id: 'warmup-joint', sets: 1, reps: null, seconds: 600, meters: null, rest_s: 0, note: null }] };
}
