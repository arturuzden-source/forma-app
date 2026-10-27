import type { DB } from '../db/index.js';
import { withTx } from '../db/index.js';
import { goalSchema, mergeProfile, missingRequired, type Profile, type ProfileField } from './schema.js';

export type ProfileRow = { data: Profile; unknown: string[]; status: 'draft' | 'confirmed'; version: number; confirmedAt: string | null; updatedAt: string };

export function getProfile(db: DB, userId: number): ProfileRow {
  const r = db.prepare('SELECT data, unknown, status, version, confirmed_at, updated_at FROM profiles WHERE user_id=?').get(userId) as
    | { data: string; unknown: string; status: 'draft' | 'confirmed'; version: number; confirmed_at: string | null; updated_at: string }
    | undefined;
  if (!r) {
    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO profiles (user_id, updated_at) VALUES (?, ?)').run(userId, now);
    return { data: {}, unknown: [], status: 'draft', version: 1, confirmedAt: null, updatedAt: now };
  }
  return { data: JSON.parse(r.data), unknown: JSON.parse(r.unknown), status: r.status, version: r.version, confirmedAt: r.confirmed_at, updatedAt: r.updated_at };
}

export class VersionConflict extends Error {
  constructor() {
    super('Профиль изменился в другом окне. Обновите данные и повторите.');
  }
}

/**
 * Применить изменения профиля. Внутри транзакции: проверка версии (если передана),
 * проверка схемы, запись истории. Значения, не прошедшие схему, не сохраняются.
 */
export function patchProfile(
  db: DB,
  userId: number,
  patch: Record<string, unknown>,
  opts: { source: 'chat' | 'edit' | 'system'; expectedVersion?: number; markUnknown?: string[]; clearUnknown?: string[] }
) {
  return withTx(db, () => {
    const cur = getProfile(db, userId);
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== cur.version) throw new VersionConflict();
    const { next, changed, rejected } = mergeProfile(cur.data, patch);
    let unknown = cur.unknown.filter((f) => !changed.includes(f as ProfileField) && !(opts.clearUnknown ?? []).includes(f));
    for (const f of opts.markUnknown ?? []) if (!unknown.includes(f) && next[f as ProfileField] === undefined) unknown.push(f);
    const unknownChanged = JSON.stringify(unknown) !== JSON.stringify(cur.unknown);
    if (changed.length === 0 && !unknownChanged) return { profile: cur, changed, rejected };

    const now = new Date().toISOString();
    const log = db.prepare('INSERT INTO profile_changes (user_id, at, source, field, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)');
    for (const f of changed) log.run(userId, now, opts.source, f, JSON.stringify(cur.data[f] ?? null), JSON.stringify(next[f] ?? null));
    db.prepare('UPDATE profiles SET data=?, unknown=?, version=version+1, updated_at=? WHERE user_id=?').run(JSON.stringify(next), JSON.stringify(unknown), now, userId);
    return { profile: getProfile(db, userId), changed, rejected };
  });
}

/**
 * Подтверждение профиля: проверка обязательных полей и создание целей.
 * Повторное подтверждение пересоздаёт активные цели из профиля, история значений сохраняется.
 */
export function confirmProfile(db: DB, userId: number, expectedVersion: number) {
  return withTx(db, () => {
    const cur = getProfile(db, userId);
    if (cur.version !== expectedVersion) throw new VersionConflict();
    const missing = missingRequired(cur.data, cur.unknown);
    if (missing.length) return { ok: false as const, missing };
    const now = new Date().toISOString();
    db.prepare("UPDATE goals SET status='dropped', updated_at=? WHERE user_id=? AND status='active'").run(now, userId);
    const ins = db.prepare(
      `INSERT INTO goals (user_id, kind, title, metric, unit, baseline, target, deadline, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const raw of cur.data.goals ?? []) {
      const g = goalSchema.parse(raw);
      ins.run(userId, g.kind, g.title, g.metric, g.unit, g.baseline, g.target, g.deadline, g.priority, now, now);
    }
    db.prepare("UPDATE profiles SET status='confirmed', confirmed_at=?, version=version+1, updated_at=? WHERE user_id=?").run(now, now, userId);
    return { ok: true as const, profile: getProfile(db, userId) };
  });
}

export function activeGoals(db: DB, userId: number) {
  return db
    .prepare("SELECT id, kind, title, metric, unit, baseline, target, deadline, priority FROM goals WHERE user_id=? AND status='active' ORDER BY priority, id")
    .all(userId);
}
