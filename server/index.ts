import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { loadConfig, describeConfig } from './config.js';
import { openDb } from './db/index.js';
import { buildApp } from './http/app.js';
import { buildAdmin } from './http/admin.js';
import { Scheduler, enqueue } from './jobs/scheduler.js';
import { createBackup, pruneBackups, restoreFromBackup } from './backup/backup.js';
import { createBot, type BotHandle } from './bot/bot.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const version = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.npm_package_version ?? 'dev';

async function main() {
  const cfg = loadConfig();
  fs.mkdirSync(cfg.DATA_DIR, { recursive: true });

  // Восстановление из копии — до открытия базы, один раз на значение RESTORE_FROM.
  const restoreFrom = process.env.RESTORE_FROM;
  const marker = path.join(cfg.DATA_DIR, `.restored-${restoreFrom}`);
  if (restoreFrom && !fs.existsSync(marker)) {
    const r = restoreFromBackup(cfg.DATA_DIR, restoreFrom);
    fs.writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), ...r }));
    console.log(JSON.stringify({ msg: 'восстановлено из копии', restoredFrom: r.restoredFrom, previousSavedTo: r.previousSavedTo }));
  }

  const db = openDb(cfg.DATA_DIR);
  const webDir = path.resolve(here, '../web');
  const app = buildApp({ cfg, db, version, webDir, startedAt: new Date() });
  const log = app.log;
  log.info({ config: describeConfig(cfg), version }, 'запуск');

  let bot: BotHandle | null = null;
  if (cfg.botEnabled) bot = createBot(cfg, db, log, version);
  else log.warn({}, 'бот выключен: не заданы TELEGRAM_BOT_TOKEN и OWNER_TELEGRAM_ID');

  const scheduler = new Scheduler(db, {
    log,
    // Ежедневная копия может опоздать на сутки; напоминания — не больше чем на 30 минут.
    maxLatenessMs: (kind) => (kind === 'backup' ? 24 * 3600_000 : 30 * 60_000)
  });
  scheduler.on('backup', async () => {
    const r = await createBackup(db, cfg.DATA_DIR);
    const removed = pruneBackups(cfg.DATA_DIR, cfg.BACKUP_RETENTION_DAYS);
    log.info({ dir: path.basename(r.dir), sizeBytes: r.sizeBytes, verified: r.verified, removed }, 'резервная копия создана');
    if (!r.verified && bot) await bot.notifyOwner('Резервная копия не прошла проверку. Посмотрите журнал сервиса.');
    scheduleNextBackup();
  });
  scheduler.on('notify', async (_job, payload) => {
    if (!bot) throw new Error('бот выключен');
    await bot.notifyOwner(String((payload as { text?: string }).text ?? ''));
  });

  function scheduleNextBackup() {
    const [h, m] = cfg.BACKUP_TIME_UTC.split(':').map(Number) as [number, number];
    const now = new Date();
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m));
    if (at <= now) at.setUTCDate(at.getUTCDate() + 1);
    enqueue(db, 'backup', `backup:${at.toISOString().slice(0, 10)}`, at);
  }
  scheduleNextBackup();
  // Если копии за сегодня ещё нет (первый запуск) — сделать её сразу.
  enqueue(db, 'backup', `backup:${new Date().toISOString().slice(0, 10)}`, new Date());

  await app.listen({ host: '0.0.0.0', port: cfg.PORT });
  const admin = buildAdmin(cfg, db, version);
  await admin.listen({ host: '127.0.0.1', port: cfg.ADMIN_PORT });
  scheduler.start();
  bot?.start();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'остановка');
    const hard = setTimeout(() => process.exit(1), 20_000);
    try {
      await bot?.stop();
      await scheduler.stop();
      await app.close();
      await admin.close();
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } finally {
      clearTimeout(hard);
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  console.error(JSON.stringify({ msg: 'не удалось запустить', error: (e as Error).message }));
  process.exit(1);
});
