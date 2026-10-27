import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.js';
import { dbPath } from '../db/index.js';

export type BackupResult = { dir: string; dbFile: string; sizeBytes: number; verified: boolean; tables: Record<string, number> };

export function backupsDir(dataDir: string) {
  return path.join(dataDir, 'backups');
}
export function filesDir(dataDir: string) {
  return path.join(dataDir, 'files');
}

const TABLES = ['users', 'operations', 'pilot_notes', 'jobs', 'ai_usage', 'backups'];

function countTables(db: DB) {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    if (exists) out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  }
  return out;
}

/**
 * Согласованная копия: штатный онлайн-бэкап SQLite (не копирование работающего файла)
 * плюс копия пользовательских файлов. После создания копия открывается и проверяется.
 */
export async function createBackup(db: DB, dataDir: string, label = new Date().toISOString().slice(0, 10)): Promise<BackupResult> {
  const dir = path.join(backupsDir(dataDir), label);
  const tmp = `${dir}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  const dbFile = path.join(tmp, 'forma.db');
  await db.backup(dbFile);

  const src = filesDir(dataDir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, 'files'), { recursive: true });

  const check = verifyBackupDb(dbFile);
  fs.writeFileSync(
    path.join(tmp, 'manifest.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), tables: check.tables, integrity: check.integrity }, null, 2)
  );

  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  const finalDb = path.join(dir, 'forma.db');
  const sizeBytes = fs.statSync(finalDb).size;
  db.prepare('INSERT INTO backups (created_at, file, size_bytes, verified, note) VALUES (?, ?, ?, ?, ?)').run(
    new Date().toISOString(),
    path.relative(dataDir, finalDb),
    sizeBytes,
    check.integrity === 'ok' ? 1 : 0,
    check.integrity === 'ok' ? null : check.integrity
  );
  return { dir, dbFile: finalDb, sizeBytes, verified: check.integrity === 'ok', tables: check.tables };
}

export function verifyBackupDb(file: string) {
  const b = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = (b.pragma('integrity_check', { simple: true }) as string) ?? 'unknown';
    return { integrity, tables: countTables(b) };
  } finally {
    b.close();
  }
}

/** Удалить копии старше срока хранения. Возвращает имена удалённых. */
export function pruneBackups(dataDir: string, retentionDays: number, now = new Date()): string[] {
  const root = backupsDir(dataDir);
  if (!fs.existsSync(root)) return [];
  const cutoff = now.getTime() - retentionDays * 86400_000;
  const removed: string[] = [];
  for (const name of fs.readdirSync(root)) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(name)) continue;
    const t = Date.parse(name.slice(0, 10) + 'T00:00:00Z');
    if (Number.isFinite(t) && t < cutoff) {
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed;
}

export function listBackups(dataDir: string) {
  const root = backupsDir(dataDir);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((n) => /^\d{4}-\d{2}-\d{2}/.test(n) && !n.endsWith('.tmp'))
    .sort();
}

/**
 * Восстановление из копии. Вызывается при старте, ДО открытия базы, когда задана
 * переменная RESTORE_FROM. Текущая база сохраняется рядом с отметкой времени.
 */
export function restoreFromBackup(dataDir: string, label: string) {
  const src = path.join(backupsDir(dataDir), label);
  const srcDb = path.join(src, 'forma.db');
  if (!fs.existsSync(srcDb)) throw new Error(`Копия ${label} не найдена`);
  const check = verifyBackupDb(srcDb);
  if (check.integrity !== 'ok') throw new Error(`Копия ${label} повреждена: ${check.integrity}`);

  const live = dbPath(dataDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const aside = path.join(dataDir, `before-restore-${stamp}`);
  fs.mkdirSync(aside, { recursive: true });
  for (const f of [live, `${live}-wal`, `${live}-shm`]) {
    if (fs.existsSync(f)) fs.renameSync(f, path.join(aside, path.basename(f)));
  }
  if (fs.existsSync(filesDir(dataDir))) fs.renameSync(filesDir(dataDir), path.join(aside, 'files'));

  fs.copyFileSync(srcDb, live);
  if (fs.existsSync(path.join(src, 'files'))) fs.cpSync(path.join(src, 'files'), filesDir(dataDir), { recursive: true });
  return { restoredFrom: label, previousSavedTo: aside, tables: check.tables };
}
