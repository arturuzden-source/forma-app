import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import { schemaVersion, withTx } from '../db/index.js';
import { verifyInitData } from '../auth/telegram.js';

type Ctx = { cfg: Config; db: DB; version: string; webDir: string | null; startedAt: Date };

declare module 'fastify' {
  interface FastifyRequest {
    userId?: number;
  }
}

const REDACT = ['req.headers.authorization', 'req.headers["x-telegram-init-data"]', 'req.headers.cookie'];

export function buildApp(ctx: Ctx, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: 'info', redact: { paths: REDACT, censor: '***' } },
    trustProxy: true,
    bodyLimit: 1_000_000
  });

  // Интерфейс и API на одном адресе: CORS не нужен, чужие сайты запросы делать не могут.
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    return payload;
  });

  app.get('/healthz', { logLevel: 'warn' }, async () => {
    ctx.db.prepare('SELECT 1').get();
    return { ok: true, version: ctx.version, schema: schemaVersion(ctx.db) };
  });

  app.register(async (api) => {
    api.addHook('preHandler', async (req, reply) => {
      const user = authenticate(ctx, req);
      if (!user.ok) return reply.code(user.code).send({ error: user.error });
      req.userId = user.userId;
    });

    api.get('/api/me', async (req) => {
      const u = ctx.db.prepare('SELECT telegram_id, first_name, created_at FROM users WHERE id=?').get(req.userId) as {
        telegram_id: number;
        first_name: string | null;
        created_at: string;
      };
      return { user: { telegramId: u.telegram_id, firstName: u.first_name, since: u.created_at }, server: { version: ctx.version, schema: schemaVersion(ctx.db) } };
    });

    api.get('/api/pilot/notes', async (req) => {
      const notes = ctx.db.prepare('SELECT id, text, created_at FROM pilot_notes WHERE user_id=? ORDER BY id DESC LIMIT 20').all(req.userId);
      return { notes };
    });

    const noteBody = z.object({ opId: z.string().uuid(), text: z.string().trim().min(1).max(500) });
    api.post('/api/pilot/notes', async (req, reply) => {
      const body = noteBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'bad_request' });
      const result = idempotent(ctx.db, req.userId!, body.data.opId, 'pilot_note', () => {
        const r = ctx.db
          .prepare('INSERT INTO pilot_notes (user_id, text, created_at) VALUES (?, ?, ?)')
          .run(req.userId, body.data.text, new Date().toISOString());
        return { id: Number(r.lastInsertRowid) };
      });
      return { saved: true, ...result };
    });
  });

  if (ctx.webDir && fs.existsSync(ctx.webDir)) {
    app.register(fastifyStatic, { root: ctx.webDir, prefix: '/', index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      return reply.type('text/html').send(fs.createReadStream(path.join(ctx.webDir!, 'index.html')));
    });
  }
  return app;
}

function authenticate(ctx: Ctx, req: FastifyRequest): { ok: true; userId: number } | { ok: false; code: number; error: string } {
  const { cfg, db } = ctx;
  if (!cfg.TELEGRAM_BOT_TOKEN || !cfg.OWNER_TELEGRAM_ID) return { ok: false, code: 503, error: 'not_configured' };
  const initData = req.headers['x-telegram-init-data'];
  const r = verifyInitData(typeof initData === 'string' ? initData : undefined, cfg.TELEGRAM_BOT_TOKEN, cfg.INIT_DATA_MAX_AGE_SEC);
  if (!r.ok) return { ok: false, code: 401, error: r.reason };
  // Личный пилот: только подтверждённый аккаунт владельца.
  if (r.user.id !== cfg.OWNER_TELEGRAM_ID) return { ok: false, code: 403, error: 'forbidden' };
  const now = new Date().toISOString();
  const userId = withTx(db, () => {
    db.prepare(
      `INSERT INTO users (telegram_id, first_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET first_name=excluded.first_name, last_seen_at=excluded.last_seen_at`
    ).run(r.user.id, r.user.first_name ?? null, now, now);
    return (db.prepare('SELECT id FROM users WHERE telegram_id=?').get(r.user.id) as { id: number }).id;
  });
  return { ok: true, userId };
}

/**
 * Применить операцию один раз. Проверка op_id и запись результата — в одной
 * транзакции; повтор того же op_id возвращает сохранённый результат.
 */
export function idempotent<T>(db: DB, userId: number, opId: string, kind: string, fn: () => T): T & { replay: boolean } {
  return withTx(db, () => {
    const prev = db.prepare('SELECT result, user_id FROM operations WHERE op_id=?').get(opId) as { result: string; user_id: number } | undefined;
    if (prev) {
      if (prev.user_id !== userId) throw new Error('op_id принадлежит другому пользователю');
      return { ...(JSON.parse(prev.result) as T), replay: true };
    }
    const result = fn();
    db.prepare('INSERT INTO operations (op_id, user_id, kind, result, created_at) VALUES (?, ?, ?, ?, ?)').run(
      opId,
      userId,
      kind,
      JSON.stringify(result),
      new Date().toISOString()
    );
    return { ...result, replay: false };
  });
}
