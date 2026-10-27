import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { migrations } from './migrations.js';

export type DB = Database.Database;

export function dbPath(dataDir: string) {
  return path.join(dataDir, 'forma.db');
}

export function openDb(dataDir: string): DB {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(dbPath(dataDir));
  configure(db);
  migrate(db);
  return db;
}

export function configure(db: DB) {
  // WAL: читатели не блокируют писателя. Блокировки всё равно возможны,
  // поэтому busy_timeout + короткие транзакции + ограниченные повторы.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

export function migrate(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => (r as { version: number }).version)
  );
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    const run = db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString()
      );
    });
    run();
  }
}

export function schemaVersion(db: DB): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return row.v ?? 0;
}

const BUSY = new Set(['SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_BUSY_SNAPSHOT']);

/**
 * Выполнить короткую транзакцию с ограниченными повторами при занятой базе.
 * IMMEDIATE берёт блокировку записи сразу, чтобы не получить BUSY посреди транзакции.
 */
export function withTx<T>(db: DB, fn: () => T, attempts = 3): T {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return db.transaction(fn).immediate();
    } catch (e) {
      lastErr = e;
      const code = (e as { code?: string }).code;
      if (!code || !BUSY.has(code)) throw e;
      sleepSync(50 * (i + 1));
    }
  }
  throw lastErr;
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
