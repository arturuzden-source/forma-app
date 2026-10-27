import type { DB } from '../db/index.js';
import { withTx } from '../db/index.js';

export type Job = { id: number; kind: string; dedupe_key: string; run_at: string; attempts: number; payload: string };
export type JobHandler = (job: Job, payload: unknown) => Promise<void>;
export type Logger = { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void; error: (o: object, m?: string) => void };

const MAX_ATTEMPTS = 3;
const LOCK_MS = 5 * 60_000;

/**
 * Поставить задачу. Повторная постановка с тем же dedupe_key ничего не меняет,
 * поэтому перезапуск или повтор не создаёт дублей.
 */
export function enqueue(db: DB, kind: string, dedupeKey: string, runAt: Date, payload: unknown = {}): boolean {
  const r = db
    .prepare(
      `INSERT INTO jobs (kind, dedupe_key, run_at, payload, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(dedupe_key) DO NOTHING`
    )
    .run(kind, dedupeKey, runAt.toISOString(), JSON.stringify(payload), new Date().toISOString());
  return r.changes === 1;
}

/** Забрать готовые задачи атомарно: одна задача исполняется одним процессом. */
export function claimDue(db: DB, now = new Date(), limit = 10): Job[] {
  return withTx(db, () => {
    const nowIso = now.toISOString();
    const rows = db
      .prepare(
        `SELECT id, kind, dedupe_key, run_at, attempts, payload FROM jobs
         WHERE run_at <= ? AND (status = 'pending' OR (status = 'running' AND locked_until < ?))
         ORDER BY run_at LIMIT ?`
      )
      .all(nowIso, nowIso, limit) as Job[];
    const lock = db.prepare(`UPDATE jobs SET status='running', attempts=attempts+1, locked_until=?, updated_at=? WHERE id=?`);
    const lockedUntil = new Date(now.getTime() + LOCK_MS).toISOString();
    for (const j of rows) lock.run(lockedUntil, nowIso, j.id);
    return rows.map((j) => ({ ...j, attempts: j.attempts + 1 }));
  });
}

export function finish(db: DB, id: number, status: 'done' | 'skipped' | 'failed' | 'pending', error?: string) {
  db.prepare(`UPDATE jobs SET status=?, locked_until=NULL, last_error=?, updated_at=? WHERE id=?`).run(
    status,
    error ?? null,
    new Date().toISOString(),
    id
  );
}

export type SchedulerOptions = {
  intervalMs?: number;
  /** Насколько задача может опоздать. Старше — помечается skipped, а не отправляется пачкой. */
  maxLatenessMs?: (kind: string) => number;
  log: Logger;
};

export class Scheduler {
  private handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(private db: DB, private opts: SchedulerOptions) {}

  on(kind: string, h: JobHandler) {
    this.handlers.set(kind, h);
    return this;
  }

  start() {
    const interval = this.opts.intervalMs ?? 30_000;
    const loop = () => {
      if (this.stopped) return;
      this.running = this.tick().finally(() => {
        this.running = null;
        if (!this.stopped) this.timer = setTimeout(loop, interval);
      });
    };
    loop();
  }

  async tick(now = new Date()) {
    const jobs = claimDue(this.db, now);
    for (const job of jobs) {
      if (this.stopped) {
        finish(this.db, job.id, 'pending');
        continue;
      }
      const lateness = now.getTime() - Date.parse(job.run_at);
      const maxLate = this.opts.maxLatenessMs?.(job.kind) ?? Infinity;
      if (lateness > maxLate) {
        finish(this.db, job.id, 'skipped', `опоздание ${Math.round(lateness / 60000)} мин`);
        this.opts.log.info({ job: job.dedupe_key }, 'задача пропущена: устарела');
        continue;
      }
      const h = this.handlers.get(job.kind);
      if (!h) {
        finish(this.db, job.id, 'failed', 'нет обработчика');
        continue;
      }
      try {
        await h(job, JSON.parse(job.payload));
        finish(this.db, job.id, 'done');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        finish(this.db, job.id, job.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', msg.slice(0, 500));
        this.opts.log.warn({ job: job.dedupe_key, attempts: job.attempts }, 'ошибка задачи');
      }
    }
  }

  /** Корректная остановка: дождаться текущего прохода, новые не начинать. */
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.running) await this.running;
  }
}
