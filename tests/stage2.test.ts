import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type DB } from '../server/db/index.js';
import type { AiService } from '../server/ai/service.js';
import { patchProfile, confirmProfile, getProfile } from '../server/profile/store.js';
import { seedCatalog, plannableExercises } from '../server/catalog/store.js';
import { allowedExercises, candidateWindows, rulesPlan, validatePlan, type Proposed } from '../server/plan/planner.js';
import { durationMinutes, shorten } from '../server/plan/content.js';
import { generateWeek, getSession, weekView } from '../server/plan/store.js';
import { checkinOptions, chooseOption, finishSession, recordSet, saveCheckin, abandonSession } from '../server/plan/workout.js';
import { weekStartOf, zonedToUtc, localParts } from '../server/plan/time.js';
import type { Profile } from '../server/profile/schema.js';

let dir: string;
let db: DB;
let uid: number;

const PROFILE: Profile = {
  name: 'Артур', age: 31, height_cm: 180, weight_kg: 78, timezone: 'Europe/Kaliningrad', experience: 'beginner',
  goals: [{ kind: 'standard', title: 'Подтягивания 18', metric: 'подтягивания', unit: 'повт', baseline: 9, target: 18, deadline: null, priority: 1 }],
  schedule: [
    { day: 'mon', from: '19:00', to: '20:30' },
    { day: 'tue', from: '19:00', to: '20:30' },
    { day: 'wed', from: '19:00', to: '20:30' },
    { day: 'thu', from: '19:00', to: '20:30' },
    { day: 'fri', from: '19:00', to: '20:30' },
    { day: 'sat', from: '10:00', to: '12:00' }
  ],
  max_minutes: 60, sessions_per_week: 3, places: ['home', 'outdoor'], equipment: ['pullup_bar'], can_run: true,
  pains: ['колено при прыжках'], injuries: [], doctor_notes: '', discomfort_exercises: []
};
// Понедельник 26.10.2026, 09:00 по Калининграду (UTC+2)
const MONDAY_MORNING = new Date('2026-10-26T07:00:00Z');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma2-'));
  db = openDb(dir);
  seedCatalog(db);
  uid = Number(db.prepare("INSERT INTO users (telegram_id, created_at, last_seen_at) VALUES (1, 'x', 'x')").run().lastInsertRowid);
  patchProfile(db, uid, PROFILE, { source: 'edit' });
  confirmProfile(db, uid, getProfile(db, uid).version);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const noAi: AiService = { available: () => false, structured: async () => { throw new Error('no'); } };
function aiReturning(...answers: unknown[]): AiService & { calls: number } {
  const s = { calls: 0, available: () => true, structured: async () => answers[s.calls++] };
  return s;
}
const ctx = (ai: AiService) => ({ db, ai, planModel: 'gpt-6.1-sol', allowDemo: true, now: MONDAY_MORNING });

describe('время и неделя', () => {
  it('неделя с понедельника, перевод местного времени в UTC', () => {
    expect(weekStartOf('2026-10-29')).toBe('2026-10-26');
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26');
    expect(zonedToUtc('2026-10-26', '19:00', 'Europe/Kaliningrad')).toBe('2026-10-26T17:00:00.000Z');
    expect(localParts(new Date('2026-10-25T23:30:00Z'), 'Europe/Kaliningrad').date).toBe('2026-10-26');
  });
});

describe('правила плана', () => {
  const allowed = () => allowedExercises(plannableExercises(db, true), PROFILE);
  it('без оборудования и с ограничением по колену прыжки и зал исключены', () => {
    const a = allowed();
    expect(a.has('jump-squat')).toBe(false);
    expect(a.has('bench-press')).toBe(false);
    expect(a.has('pullup')).toBe(true);
  });
  it('резервный план укладывается в окна, лимит и правила', () => {
    const w = candidateWindows(PROFILE, '2026-10-26', '2026-10-26', '09:00', new Set());
    const plan = rulesPlan(PROFILE, allowed(), w);
    expect(plan).toHaveLength(3);
    expect(validatePlan(plan, PROFILE, allowed(), w)).toEqual([]);
    for (const s of plan) expect(durationMinutes(s.content)).toBeLessThanOrEqual(60);
  });
  it('проверка ловит выдуманное упражнение, выход за окно и превышение длительности', () => {
    const w = candidateWindows(PROFILE, '2026-10-26', '2026-10-26', '09:00', new Set());
    const bad: Proposed[] = [
      { date: '2026-10-27', start_time: '20:00', title: 'Т', purpose: 'п', content: { warmup_min: 10, cooldown_min: 5, items: [{ exercise_id: 'magic-move', sets: 3, reps: 10, seconds: null, meters: null, rest_s: 60, note: null }, { exercise_id: 'pullup', sets: 10, reps: 10, seconds: null, meters: null, rest_s: 300, note: null }] } }
    ];
    const errs = validatePlan(bad, PROFILE, allowed(), w).join(' ');
    expect(errs).toMatch(/magic-move/);
    expect(errs).toMatch(/не помещаются/);
    expect(errs).toMatch(/больше лимита/);
  });
  it('сокращение до доступного времени', () => {
    const w = candidateWindows(PROFILE, '2026-10-26', '2026-10-26', '09:00', new Set());
    const c = rulesPlan(PROFILE, allowed(), w)[0]!.content;
    const s = shorten(c, 20)!;
    expect(durationMinutes(s)).toBeLessThanOrEqual(20);
    expect(s.items.length).toBeGreaterThan(0);
  });
  it('сегодня не предлагается время, которое уже прошло', () => {
    const w = candidateWindows(PROFILE, '2026-10-26', '2026-10-26', '19:40', new Set());
    const today = w.find((x) => x.date === '2026-10-26');
    expect(today?.earliest).toBe('20:15');
  });
});

describe('генерация недели', () => {
  it('без ИИ — план по правилам с объяснением', async () => {
    const r = await generateWeek(ctx(noAi), uid, 'тест');
    expect(r.source).toBe('rules');
    const v = weekView(db, uid, MONDAY_MORNING);
    expect(v.sessions.length).toBe(3);
    expect(v.plan?.version).toBe(1);
  });
  it('план ИИ с нарушением отклоняется, повтор с замечаниями, затем резервный план; старый план не трогается до успеха', async () => {
    await generateWeek(ctx(noAi), uid, 'первый');
    const bad = { sessions: [{ date: '2026-10-27', start_time: '19:00', title: 'Т', purpose: 'п', warmup_min: 5, cooldown_min: 5, items: [{ exercise_id: 'jump-squat', sets: 3, reps: 10, seconds: null, meters: null, rest_s: 60, note: null }] }], explanation: 'x' };
    const ai = aiReturning(bad, bad);
    const r = await generateWeek(ctx(ai), uid, 'второй');
    expect(ai.calls).toBe(2);
    expect(r.source).toBe('rules');
    expect(r.warnings.join(' ')).toMatch(/не прошёл проверку/);
    expect(weekView(db, uid, MONDAY_MORNING).plan?.version).toBe(2);
  });
  it('допустимый план ИИ принимается', async () => {
    const good = {
      sessions: [
        { date: '2026-10-27', start_time: '19:00', title: 'Турник и ноги', purpose: 'Сила', warmup_min: 7, cooldown_min: 3, items: [
          { exercise_id: 'pullup-negative', sets: 3, reps: 4, seconds: null, meters: null, rest_s: 120, note: 'медленно' },
          { exercise_id: 'squat-bw', sets: 3, reps: 12, seconds: null, meters: null, rest_s: 90, note: null }
        ] }
      ],
      explanation: 'Записанных результатов пока нет, нагрузка стартовая.'
    };
    const r = await generateWeek(ctx(aiReturning(good)), uid, 'тест');
    expect(r.source).toBe('ai');
    expect(weekView(db, uid, MONDAY_MORNING).sessions[0]!.title).toBe('Турник и ноги');
  });
});

describe('чек-ин и тренировка', () => {
  async function firstSession() {
    await generateWeek(ctx(noAi), uid, 'тест');
    const v = weekView(db, uid, MONDAY_MORNING);
    return getSession(db, uid, v.sessions[0]!.id)!;
  }
  const allowed = () => allowedExercises(plannableExercises(db, true), PROFILE);

  it('тревожные симптомы — только остановка', async () => {
    const s = await firstSession();
    const r = checkinOptions({ wellbeing: 4, sleep: 'ok', fatigue: 'low', pain: 'none', alarm: ['chest_pain'], minutes: null }, JSON.parse(s.content), allowed());
    expect(r.options.map((o) => o.id)).toEqual(['stop']);
    expect(r.message).toMatch(/112/);
  });
  it('мало времени — сокращение; плохое самочувствие — облегчение и восстановление', async () => {
    const s = await firstSession();
    const r1 = checkinOptions({ wellbeing: 4, sleep: 'ok', fatigue: 'low', pain: 'none', alarm: [], minutes: 25 }, JSON.parse(s.content), allowed());
    expect(r1.options.find((o) => o.id === 'short')!.durationMin!).toBeLessThanOrEqual(25);
    const r2 = checkinOptions({ wellbeing: 2, sleep: 'poor', fatigue: 'high', pain: 'none', alarm: [], minutes: null }, JSON.parse(s.content), allowed());
    expect(r2.options.find((o) => o.recommended)!.id).toBe('recovery');
  });
  it('старт фиксирует версию, повтор выбора не меняет данные, подходы записываются без дублей', async () => {
    const s = await firstSession();
    const r = checkinOptions({ wellbeing: 4, sleep: 'ok', fatigue: 'low', pain: 'none', alarm: [], minutes: null }, JSON.parse(s.content), allowed());
    const ck = saveCheckin(db, s, uid, { wellbeing: 4, sleep: 'ok', fatigue: 'low', pain: 'none', alarm: [], minutes: null }, r);
    expect(chooseOption(db, uid, s.id, ck, 'keep', s.content_version).status).toBe('started');
    expect(chooseOption(db, uid, s.id, ck, 'keep', s.content_version).replay).toBe(true);
    const started = getSession(db, uid, s.id)!;
    expect(started.started_content).toBeTruthy();

    const set = { item_index: 0, set_index: 0, reps: 8, seconds: null, meters: null, weight_kg: null, rpe: 7, pain: false, note: null };
    recordSet(db, uid, s.id, set);
    expect(recordSet(db, uid, s.id, set).replay).toBe(true);
    expect((db.prepare('SELECT COUNT(*) AS n FROM set_results').get() as { n: number }).n).toBe(1);
    const f = finishSession(db, uid, s.id);
    expect(f.status).toBe('partial');
    // Исправление после завершения учитывается.
    expect(recordSet(db, uid, s.id, { ...set, reps: 9 }).corrected).toBe(true);
  });
  it('отдых по самочувствию отменяет занятие, а не помечает пропуском', async () => {
    const s = await firstSession();
    const a = { wellbeing: 2, sleep: 'poor' as const, fatigue: 'high' as const, pain: 'none' as const, alarm: [], minutes: null };
    const ck = saveCheckin(db, s, uid, a, checkinOptions(a, JSON.parse(s.content), allowed()));
    expect(chooseOption(db, uid, s.id, ck, 'rest', s.content_version).status).toBe('cancelled');
  });
  it('выход без записей возвращает занятие в план; пересоставление не трогает начатое', async () => {
    const s = await firstSession();
    const a = { wellbeing: 4, sleep: 'ok' as const, fatigue: 'low' as const, pain: 'none' as const, alarm: [], minutes: null };
    const ck = saveCheckin(db, s, uid, a, checkinOptions(a, JSON.parse(s.content), allowed()));
    chooseOption(db, uid, s.id, ck, 'keep', s.content_version);
    expect(abandonSession(db, uid, s.id).status).toBe('planned');
    const ck2 = saveCheckin(db, s, uid, a, checkinOptions(a, JSON.parse(s.content), allowed()));
    chooseOption(db, uid, s.id, ck2, 'keep', getSession(db, uid, s.id)!.content_version);
    recordSet(db, uid, s.id, { item_index: 0, set_index: 0, reps: 8, seconds: null, meters: null, weight_kg: null, rpe: null, pain: false, note: null });
    await generateWeek(ctx(noAi), uid, 'пересоставить');
    const v = weekView(db, uid, MONDAY_MORNING);
    const kept = v.sessions.find((x) => x.id === s.id);
    expect(kept?.status).toBe('started');
    expect(v.sessions.filter((x) => x.date === s.local_date)).toHaveLength(1);
  });
});
