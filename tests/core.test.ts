import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb, type DB } from '../server/db/index.js';
import { signInitData, verifyInitData } from '../server/auth/telegram.js';
import { buildApp, idempotent } from '../server/http/app.js';
import { loadConfig } from '../server/config.js';
import { Scheduler, enqueue } from '../server/jobs/scheduler.js';
import { createBackup, pruneBackups, restoreFromBackup, listBackups } from '../server/backup/backup.js';
import { reserve, settle, spentThisMonth, AiError, callStructured } from '../server/ai/openai.js';
import { CASES } from '../server/ai/eval.js';

const TOKEN = '123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz';
const OWNER = 111222333;
const silent = { info: () => {}, warn: () => {}, error: () => {} };

let dir: string;
let db: DB;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-'));
  db = openDb(dir);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function initData(userId: number, authDate = Math.floor(Date.now() / 1000)) {
  return signInitData({ auth_date: String(authDate), query_id: 'AAH', user: JSON.stringify({ id: userId, first_name: 'Артур' }) }, TOKEN);
}

describe('initData', () => {
  it('принимает подлинную подпись', () => {
    const r = verifyInitData(initData(OWNER), TOKEN, 86400);
    expect(r.ok).toBe(true);
  });
  it('отклоняет подделку, чужой токен и просроченные данные', () => {
    const good = initData(OWNER);
    const forged = good.replace(encodeURIComponent(String(OWNER)), encodeURIComponent('999'));
    expect(verifyInitData(forged, TOKEN, 86400)).toMatchObject({ ok: false, reason: 'bad_hash' });
    expect(verifyInitData(good, TOKEN + 'x', 86400)).toMatchObject({ ok: false, reason: 'bad_hash' });
    expect(verifyInitData(initData(OWNER, 1000), TOKEN, 86400)).toMatchObject({ ok: false, reason: 'expired' });
    expect(verifyInitData(undefined, TOKEN, 86400)).toMatchObject({ ok: false, reason: 'missing' });
  });
});

describe('API и доступ', () => {
  function app() {
    const cfg = loadConfig({ TELEGRAM_BOT_TOKEN: TOKEN, OWNER_TELEGRAM_ID: String(OWNER), DATA_DIR: dir, NODE_ENV: 'test' });
    return buildApp({ cfg, db, version: 'test', webDir: null, startedAt: new Date() }, { logger: false });
  }
  it('без initData — 401, чужой аккаунт — 403, владелец — 200', async () => {
    const a = app();
    expect((await a.inject({ url: '/api/me' })).statusCode).toBe(401);
    expect((await a.inject({ url: '/api/me', headers: { 'x-telegram-init-data': initData(42) } })).statusCode).toBe(403);
    const ok = await a.inject({ url: '/api/me', headers: { 'x-telegram-init-data': initData(OWNER) } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.telegramId).toBe(OWNER);
  });
  it('повтор запроса с тем же opId не создаёт вторую запись', async () => {
    const a = app();
    const opId = crypto.randomUUID();
    const h = { 'x-telegram-init-data': initData(OWNER) };
    const r1 = await a.inject({ method: 'POST', url: '/api/pilot/notes', headers: h, payload: { opId, text: 'до обновления' } });
    const r2 = await a.inject({ method: 'POST', url: '/api/pilot/notes', headers: h, payload: { opId, text: 'до обновления' } });
    expect(r1.json()).toMatchObject({ saved: true, replay: false });
    expect(r2.json()).toMatchObject({ saved: true, replay: true, id: r1.json().id });
    expect((db.prepare('SELECT COUNT(*) AS n FROM pilot_notes').get() as { n: number }).n).toBe(1);
  });
  it('healthz открыт без авторизации и не раскрывает конфигурацию', async () => {
    const r = await app().inject({ url: '/healthz' });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(TOKEN);
    expect(Object.keys(r.json())).toEqual(['ok', 'version', 'schema']);
  });
});

describe('планировщик', () => {
  it('повторная постановка и повторный проход не дублируют задачу', async () => {
    const sent: string[] = [];
    const s = new Scheduler(db, { log: silent, maxLatenessMs: () => 30 * 60_000 });
    s.on('notify', async (_j, p) => void sent.push((p as { text: string }).text));
    const at = new Date(Date.now() - 1000);
    expect(enqueue(db, 'notify', 'workout:2026-10-27', at, { text: 'тренировка' })).toBe(true);
    expect(enqueue(db, 'notify', 'workout:2026-10-27', at, { text: 'тренировка' })).toBe(false);
    await s.tick();
    await s.tick();
    expect(sent).toEqual(['тренировка']);
  });
  it('устаревшее напоминание не отправляется пачкой после простоя', async () => {
    const sent: string[] = [];
    const s = new Scheduler(db, { log: silent, maxLatenessMs: () => 30 * 60_000 });
    s.on('notify', async () => void sent.push('x'));
    enqueue(db, 'notify', 'old', new Date(Date.now() - 3 * 3600_000));
    await s.tick();
    expect(sent).toEqual([]);
    expect((db.prepare("SELECT status FROM jobs WHERE dedupe_key='old'").get() as { status: string }).status).toBe('skipped');
  });
});

describe('резервные копии', () => {
  it('копия создаётся штатным механизмом, проверяется и восстанавливается', async () => {
    db.prepare("INSERT INTO users (telegram_id, created_at, last_seen_at) VALUES (1, 'x', 'x')").run();
    db.prepare("INSERT INTO pilot_notes (user_id, text, created_at) VALUES (1, 'запись до копии', 'x')").run();
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'files', 'photo.jpg'), 'binary');
    const b = await createBackup(db, dir, '2026-10-27');
    expect(b.verified).toBe(true);
    expect(b.tables.pilot_notes).toBe(1);

    db.prepare("INSERT INTO pilot_notes (user_id, text, created_at) VALUES (1, 'после копии', 'x')").run();
    db.close();
    const r = restoreFromBackup(dir, '2026-10-27');
    expect(r.tables.pilot_notes).toBe(1);
    db = openDb(dir);
    const rows = db.prepare('SELECT text FROM pilot_notes').all() as { text: string }[];
    expect(rows.map((x) => x.text)).toEqual(['запись до копии']);
    expect(fs.readFileSync(path.join(dir, 'files', 'photo.jpg'), 'utf8')).toBe('binary');
  });
  it('копии старше срока хранения удаляются', async () => {
    await createBackup(db, dir, '2026-09-01');
    await createBackup(db, dir, '2026-10-27');
    const removed = pruneBackups(dir, 30, new Date('2026-10-27T12:00:00Z'));
    expect(removed).toEqual(['2026-09-01']);
    expect(listBackups(dir)).toEqual(['2026-10-27']);
  });
});

describe('бюджет ИИ', () => {
  const b = { monthlyUsd: 5, dailyText: 2, dailyImage: 1 };
  it('резерв не выпускает за месячный бюджет', () => {
    const id = reserve(db, b, 'chat', 'gpt-6-luna', 'text', 4.5);
    settle(db, id, { ok: true, cost: 4.9, input: 1, cached: 0, output: 1, latencyMs: 1 });
    expect(spentThisMonth(db)).toBeCloseTo(4.9);
    expect(() => reserve(db, b, 'chat', 'gpt-6-luna', 'text', 0.2)).toThrowError(AiError);
  });
  it('дневной лимит обращений', () => {
    reserve(db, b, 'chat', 'gpt-6-luna', 'text', 0.001);
    reserve(db, b, 'chat', 'gpt-6-luna', 'text', 0.001);
    expect(() => reserve(db, b, 'chat', 'gpt-6-luna', 'text', 0.001)).toThrowError(/Дневной/);
  });
  it('ошибки провайдера превращаются в понятные коды, ключ не утекает в сообщение', async () => {
    const fake = (async () => new Response(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-abc123' } }), { status: 401 })) as typeof fetch;
    await expect(callStructured({ apiKey: 'sk-abc123', baseUrl: 'http://x', timeoutMs: 1000, fetchImpl: fake }, 'gpt-6-luna', 's', 'u', CASES[3]!.schema)).rejects.toMatchObject({ code: 'auth' });
    try {
      await callStructured({ apiKey: 'sk-abc123', baseUrl: 'http://x', timeoutMs: 1000, fetchImpl: fake }, 'gpt-6-luna', 's', 'u', CASES[3]!.schema);
    } catch (e) {
      expect((e as Error).message).not.toContain('sk-abc123');
    }
  });
  it('структурированный ответ разбирается и стоимость считается по токенам', async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ output_text: '{"text":"Объём не повышаем: сон 6,8 ч."}', usage: { input_tokens: 1000, output_tokens: 100 } }), { status: 200 })) as typeof fetch;
    const r = await callStructured({ apiKey: 'k', baseUrl: 'http://x', timeoutMs: 1000, fetchImpl: fake }, 'gpt-6-luna', 's', 'u', CASES[3]!.schema);
    expect(r.json).toEqual({ text: 'Объём не повышаем: сон 6,8 ч.' });
    expect(r.costUsd).toBeCloseTo((1000 * 0.1 + 100 * 0.5) / 1e6);
    expect(CASES[3]!.check(r.json).every((c) => c.ok)).toBe(true);
  });
});
