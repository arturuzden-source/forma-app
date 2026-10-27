import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import { describeConfig } from '../config.js';
import type { DB } from '../db/index.js';
import { schemaVersion } from '../db/index.js';
import { createBackup, listBackups } from '../backup/backup.js';
import { spentThisMonth } from '../ai/openai.js';

/**
 * Служебный сервер: слушает только 127.0.0.1 внутри контейнера и не публикуется наружу.
 * Доступ — через `railway ssh` и curl http://127.0.0.1:$ADMIN_PORT/...
 */
export function buildAdmin(cfg: Config, db: DB, version: string): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/status', async () => ({
    version,
    schema: schemaVersion(db),
    config: describeConfig(cfg),
    backups: listBackups(cfg.DATA_DIR),
    jobs: db.prepare('SELECT kind, status, COUNT(*) AS n FROM jobs GROUP BY kind, status').all(),
    aiSpentThisMonthUsd: spentThisMonth(db),
    memory: process.memoryUsage()
  }));
  app.post('/backup', async () => {
    const r = await createBackup(db, cfg.DATA_DIR, `${new Date().toISOString().slice(0, 10)}-manual-${Date.now()}`);
    return { dir: r.dir, sizeBytes: r.sizeBytes, verified: r.verified, tables: r.tables };
  });
  return app;
}
