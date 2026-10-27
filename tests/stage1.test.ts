import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type DB } from '../server/db/index.js';
import type { AiService } from '../server/ai/service.js';
import { AiError } from '../server/ai/openai.js';
import { answerText, chooseQuick, goBack, startOrResume } from '../server/onboarding/engine.js';
import { confirmProfile, getProfile, patchProfile, VersionConflict } from '../server/profile/store.js';
import { seedCatalog, getExercise, listExercises, plannableExercises } from '../server/catalog/store.js';
import { SEED } from '../server/catalog/seed.js';

let dir: string;
let db: DB;
let uid: number;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma1-'));
  db = openDb(dir);
  uid = Number(db.prepare("INSERT INTO users (telegram_id, created_at, last_seen_at) VALUES (1, 'x', 'x')").run().lastInsertRowid);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function fakeAi(responses: unknown[]): AiService & { calls: number } {
  const svc = {
    calls: 0,
    available: () => true,
    structured: async () => {
      const r = responses[svc.calls++];
      if (r instanceof Error) throw r;
      return r;
    }
  };
  return svc;
}
const empty = (u: Record<string, unknown> = {}) => ({ updates: u, dont_know: [], clarify: null, reply: 'Записал.' });
const ctx = { tz: 'Europe/Kaliningrad', today: '2026-10-27', model: 'gpt-6-luna' };

describe('беседа-знакомство', () => {
  it('начинается с имени, имя принимается без ИИ, затем вопрос о возрасте', async () => {
    const ai = fakeAi([]);
    const v0 = startOrResume(db, uid, ctx, ai);
    expect(v0.topic).toBe('name');
    const v1 = await answerText(db, uid, 'Артур', ctx, ai);
    expect(ai.calls).toBe(0);
    expect(getProfile(db, uid).data.name).toBe('Артур');
    expect(v1.topic).toBe('basics');
  });

  it('несколько параметров из одного ответа; уже известное не спрашивается повторно', async () => {
    const ai = fakeAi([
      empty({ age: 31, height_cm: 180, weight_kg: 78, max_minutes: 60, schedule: [{ day: 'mon', from: '19:00', to: '21:00' }] })
    ]);
    startOrResume(db, uid, ctx, ai);
    await answerText(db, uid, 'Артур', ctx, ai);
    const v = await answerText(db, uid, '31 год, 180, 78 кг, могу в понедельник вечером до часа', ctx, ai);
    expect(v.topic).toBe('sex');
    const p = getProfile(db, uid).data;
    expect(p).toMatchObject({ age: 31, height_cm: 180, weight_kg: 78, max_minutes: 60 });
    // Дойдём до расписания — оно уже заполнено, тема должна быть пропущена.
    chooseQuick(db, uid, 'no', ctx, ai); // пол не указывать
    expect(getProfile(db, uid).unknown).toContain('sex');
  });

  it('неправдоподобные значения не сохраняются, ничего не придумывается', async () => {
    const ai = fakeAi([empty({ age: 31, height_cm: 18, weight_kg: 78 })]);
    startOrResume(db, uid, ctx, ai);
    await answerText(db, uid, 'Артур', ctx, ai);
    const v = await answerText(db, uid, '31, 18, 78', ctx, ai);
    const p = getProfile(db, uid).data;
    expect(p.height_cm).toBeUndefined();
    expect(v.topic).toBe('basics');
    expect(v.messages.at(-1)!.text).toMatch(/не сохранил/);
  });

  it('уточняющий вопрос при неоднозначном ответе', async () => {
    const ai = fakeAi([empty(), { updates: {}, dont_know: [], clarify: 'Какая цель главная?', reply: 'Понял две цели.' }]);
    startOrResume(db, uid, ctx, ai);
    patchProfile(db, uid, { name: 'А', age: 31, height_cm: 180, weight_kg: 78, sex: 'male' }, { source: 'edit' });
    const v = startOrResume(db, uid, ctx, ai);
    expect(v.topic).toBe('name');
    const v2 = await answerText(db, uid, 'А', ctx, ai);
    expect(v2.topic).toBe('goals');
    await answerText(db, uid, 'что-то', ctx, ai);
    const v3 = await answerText(db, uid, 'Хочу подтягиваться и бегать', ctx, ai);
    expect(v3.topic).toBe('goals');
    expect(v3.messages.at(-1)!.text).toContain('Какая цель главная?');
  });

  it('ошибка ИИ не теряет ответ и не меняет профиль', async () => {
    const ai = fakeAi([new AiError('daily_limit', 'x')]);
    startOrResume(db, uid, ctx, ai);
    await answerText(db, uid, 'Артур', ctx, ai);
    const before = getProfile(db, uid);
    const v = await answerText(db, uid, '31 год', ctx, ai);
    expect(getProfile(db, uid).version).toBe(before.version);
    expect(v.messages.some((m) => m.role === 'user' && m.text === '31 год')).toBe(true);
    expect(v.messages.at(-1)!.text).toMatch(/лимит/);
  });

  it('продолжение после закрытия и возврат к предыдущему ответу', async () => {
    const ai = fakeAi([]);
    startOrResume(db, uid, ctx, ai);
    await answerText(db, uid, 'Артур', ctx, ai);
    const resumed = startOrResume(db, uid, ctx, ai);
    expect(resumed.topic).toBe('basics');
    const back = goBack(db, uid, ctx, ai);
    expect(back.topic).toBe('name');
  });
});

describe('профиль', () => {
  it('подтверждение требует обязательных полей и создаёт цели', () => {
    let p = getProfile(db, uid);
    const r1 = confirmProfile(db, uid, p.version);
    expect(r1.ok).toBe(false);
    patchProfile(
      db,
      uid,
      {
        name: 'Артур', age: 31, height_cm: 180, weight_kg: 78, timezone: 'Europe/Kaliningrad', experience: 'beginner', max_minutes: 60,
        schedule: [{ day: 'mon', from: '19:00', to: '20:30' }], places: ['home'], equipment: ['pullup_bar'],
        goals: [{ kind: 'standard', title: 'Подтягивания 18', metric: 'подтягивания', unit: 'повт', baseline: 9, target: 18, deadline: null, priority: 1 }]
      },
      { source: 'edit' }
    );
    p = getProfile(db, uid);
    const r2 = confirmProfile(db, uid, p.version);
    expect(r2.ok).toBe(true);
    expect((db.prepare("SELECT COUNT(*) AS n FROM goals WHERE status='active'").get() as { n: number }).n).toBe(1);
  });
  it('правка по устаревшей версии отклоняется', () => {
    const p = getProfile(db, uid);
    patchProfile(db, uid, { name: 'А' }, { source: 'edit', expectedVersion: p.version });
    expect(() => patchProfile(db, uid, { name: 'Б' }, { source: 'edit', expectedVersion: p.version })).toThrow(VersionConflict);
  });
  it('история изменений ведётся', () => {
    patchProfile(db, uid, { weight_kg: 78 }, { source: 'chat' });
    patchProfile(db, uid, { weight_kg: 77 }, { source: 'edit' });
    const rows = db.prepare("SELECT source, old_value, new_value FROM profile_changes WHERE field='weight_kg' ORDER BY id").all();
    expect(rows).toEqual([
      { source: 'chat', old_value: 'null', new_value: '78' },
      { source: 'edit', old_value: '78', new_value: '77' }
    ]);
  });
});

describe('каталог', () => {
  it('загружается, все карточки демонстрационные и ожидают проверки', () => {
    expect(seedCatalog(db)).toBe(SEED.length);
    const all = listExercises(db);
    expect(all.length).toBe(SEED.length);
    expect(all.every((e) => e.isDemo && e.status === 'review')).toBe(true);
    expect(plannableExercises(db, false)).toHaveLength(0);
    expect(plannableExercises(db, true).length).toBe(SEED.length);
  });
  it('проверенная специалистом карточка не перезаписывается демонстрационной', () => {
    seedCatalog(db);
    db.prepare("UPDATE exercises SET is_demo=0, status='published', name='Проверено', reviewed_by='Тренер' WHERE id='squat-bw'").run();
    db.prepare("DELETE FROM meta WHERE key='catalog_version'").run();
    seedCatalog(db);
    expect(getExercise(db, 'squat-bw')!.name).toBe('Проверено');
  });
  it('ссылки на замены указывают на существующие упражнения', () => {
    const ids = new Set(SEED.map((e) => e.id));
    for (const e of SEED) for (const r of [...e.card.easier, ...e.card.alternatives]) expect(ids.has(r), `${e.id} → ${r}`).toBe(true);
  });
  it('покрытие: дом без инвентаря, турник, гантели, зал, бег, разминка', () => {
    const has = (pred: (e: (typeof SEED)[number]) => boolean) => SEED.some(pred);
    expect(has((e) => e.places.includes('home') && e.equipment.includes('none') && e.category === 'strength')).toBe(true);
    expect(has((e) => e.equipment.includes('pullup_bar'))).toBe(true);
    expect(has((e) => e.equipment.includes('dumbbells'))).toBe(true);
    expect(has((e) => e.places.includes('gym') && e.equipment.includes('machines'))).toBe(true);
    expect(has((e) => e.pattern === 'run')).toBe(true);
    expect(has((e) => e.category === 'warmup' || e.category === 'mobility')).toBe(true);
  });
});
